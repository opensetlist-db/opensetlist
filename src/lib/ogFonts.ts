import { readFile } from "node:fs/promises";
import path from "node:path";

export type OgFont = {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 700;
  readonly style: "normal";
};

// The @fontsource "japanese" pre-bundle omits CJK symbols commonly used in
// anime/K-POP/J-POP event titles (～ ／ ★ ☆ ♡ ♥ ♪ ♫ ♬ ❀ ✿ …), so they render
// as tofu in OG images. @fontsource also ships ~130 fine-grained numbered
// subsets split by unicode-range. Satori does its font resolution by
// family-name match: each extra subset gets a distinct name and is appended
// to OG_FONT_STACK so satori falls through when a glyph is missing upstream.
// Ranges verified in node_modules/@fontsource/noto-sans-jp/700.css.
const SYMBOL_SUBSETS = [
  { suffix: "Sym56", subset: 56 }, // U+2660 U+2662-2668 U+266D-266E (suits), U+273D ❀, U+2740 ✿, U+2756
  { suffix: "Sym69", subset: 69 }, // U+266C ♬
  { suffix: "Sym70", subset: 70 }, // U+266B ♫
  { suffix: "Sym86", subset: 86 }, // U+2665 ♥
  { suffix: "Sym97", subset: 97 }, // U+2661 ♡, U+25C6 ◆
  { suffix: "Sym108", subset: 108 }, // U+2605-2606 ★☆, U+301C ～ (wave dash)
  { suffix: "Sym109", subset: 109 }, // U+266A ♪, U+FF0F-FF10 ／
  { suffix: "Sym115", subset: 115 }, // U+FF5E ～ (fullwidth tilde — the char actually used in Hasunosora titles)
] as const;

export const OG_FONT_STACK = [
  '"DMSans"',
  '"NotoSansKR"',
  '"NotoSansJP"',
  ...SYMBOL_SUBSETS.map((s) => `"NotoJP${s.suffix}"`),
  "sans-serif",
].join(", ");

// Single source of truth for the WOFFs the OG renderer pulls off disk.
// Both `loadOgFonts()` (runtime readFile) and `next.config.ts`
// (build-time outputFileTracingIncludes) read this list — previously each
// location had its own hardcoded copy, so a one-sided edit could drop a
// font from the Vercel function bundle and reproduce the launch-day /500.
export const OG_FONTS = [
  {
    name: "DMSans",
    file: "@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff",
  },
  {
    name: "NotoSansKR",
    file: "@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff",
  },
  {
    name: "NotoSansJP",
    file: "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
  },
  ...SYMBOL_SUBSETS.map(({ suffix, subset }) => ({
    name: `NotoJP${suffix}`,
    file: `@fontsource/noto-sans-jp/files/noto-sans-jp-${subset}-700-normal.woff`,
  })),
] as const;

let cachedFonts: readonly OgFont[] | null = null;
// Share an in-flight read across concurrent callers so a cold-start burst of OG
// requests doesn't re-read the configured WOFFs from disk once per request.
let inflight: Promise<readonly OgFont[]> | null = null;

// Public return type is a mutable array because `@vercel/og`'s `ImageResponse`
// types its `fonts` option as `FontOptions[]`. We return a fresh shallow copy
// so callers can't mutate the shared cache.
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cachedFonts) return [...cachedFonts];
  if (!inflight) {
    inflight = (async () => {
      const toArrayBuffer = (b: Buffer): ArrayBuffer =>
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const buffers = await Promise.all(
        OG_FONTS.map(({ file }) =>
          readFile(path.join(process.cwd(), "node_modules", file))
        )
      );
      const fonts: readonly OgFont[] = OG_FONTS.map(({ name }, i) => ({
        name,
        data: toArrayBuffer(buffers[i]),
        weight: 700,
        style: "normal",
      }));
      cachedFonts = fonts;
      return fonts;
    })().finally(() => {
      inflight = null;
    });
  }
  const fonts = await inflight;
  return [...fonts];
}

// CJK/Hangul/Hiragana/Katakana and Fullwidth Forms render at roughly 2× the
// advance width of Latin at the same em size, so raw character count misjudges
// how much horizontal room a title needs. Weight those codepoints as 2.
const CJK_WIDE = /\p{sc=Han}|\p{sc=Hiragana}|\p{sc=Katakana}|\p{sc=Hangul}|[\u3000-\u303F\uFF00-\uFFEF]/u;

function scoreWeightedLength(text: string): number {
  let score = 0;
  for (const ch of text) {
    score += CJK_WIDE.test(ch) ? 2 : 1;
  }
  return score;
}

// OG title area is ~604 px wide × ~200 px tall (700 px card − 96 px padding,
// minus the pill + subtitle + metadata rows). Shrink the title so a 2-line
// clamp always fits without mid-word clipping. `base` matches the route's
// existing starting size: 60 for event, 72 for artist/song. Subtitle clamp
// drops to 1 line when the title goes large-to-medium so the metadata row
// still has room below.
const TITLE_SIZE_TIERS = [
  { maxScore: 20, large: 72, normal: 60, clamp: 2 },
  { maxScore: 35, large: 64, normal: 56, clamp: 2 },
  { maxScore: 55, large: 54, normal: 48, clamp: 2 },
  { maxScore: 80, large: 44, normal: 40, clamp: 1 },
  { maxScore: 110, large: 36, normal: 34, clamp: 1 },
] as const;
const FALLBACK_TIER = { large: 32, normal: 30, clamp: 1 } as const;

export function titleFontSize(
  text: string,
  base: 60 | 72 = 60
): { fontSize: number; subtitleClamp: 1 | 2 } {
  const score = scoreWeightedLength(text);
  const tier = TITLE_SIZE_TIERS.find((t) => score <= t.maxScore) ?? FALLBACK_TIER;
  return {
    fontSize: base === 72 ? tier.large : tier.normal,
    subtitleClamp: tier.clamp,
  };
}

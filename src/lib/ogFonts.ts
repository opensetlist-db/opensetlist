import { readFile } from "node:fs/promises";
import path from "node:path";
import * as Sentry from "@sentry/nextjs";

export type OgFont = {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 700;
  readonly style: "normal";
};

// Per-readFile timeout. Cold-start I/O on Vercel lambdas can hang if the
// function bundle hasn't finished paging in; without a timeout, a single
// stuck readFile blocks the entire Promise.all and the route eventually
// 5xxes. 5s is well above warm-state read latency (single-digit ms) but
// short enough that the request still has time to render fallback fonts
// before the platform-level timeout.
const FONT_READ_TIMEOUT_MS = 5_000;

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

// Read a single font file with a hard timeout. Always resolves — never
// rejects. A `null` return signals "this font failed to load" so the
// caller can skip it and continue building the rest of the font set.
//
// Why never-throw: a single Promise.all rejection over the 11 WOFFs
// would tear down the entire OG render and surface as a 5xx. Twitter
// negative-caches scrape failures against the URL for ~7 days, so one
// cold-start I/O blip translates to a week of broken share previews
// for that event. The cost-benefit is asymmetric: rendering with 10/11
// fonts (or even 0/11, falling back to the `Geist-Regular.ttf` that
// ships inside `node_modules/next/dist/compiled/@vercel/og/` — Turbopack
// rewrites @vercel/og imports to Next's compiled copy, which bundles
// Geist alongside the JS) is always better than a no-image card. F15
// retro: this exact failure mode took out the launch-day and Day-2
// tweets on 2026-05-02 / 2026-05-03.
async function readFontWithTimeout(
  filePath: string
): Promise<Buffer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readFile(filePath),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), FONT_READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // ENOENT / EACCES / other I/O errors. Treat the same as a timeout:
    // skip this font, let the render continue with whatever loaded.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Public return type is a mutable array because `@vercel/og`'s `ImageResponse`
// types its `fonts` option as `FontOptions[]`. We return a fresh shallow copy
// so callers can't mutate the shared cache.
//
// Never throws. On full success returns all 11 fonts; on partial failure
// returns the subset that loaded and emits a Sentry message so we can
// see in production whether a specific font keeps timing out. On total
// failure returns `[]` and `@vercel/og` falls back to the
// `Geist-Regular.ttf` Next bundles inside its compiled @vercel/og copy
// (see the readFontWithTimeout comment above) — Latin-only render, but
// the bare OPENSETLIST card still produces a valid PNG response.
export async function loadOgFonts(): Promise<OgFont[]> {
  if (cachedFonts) return [...cachedFonts];
  if (!inflight) {
    inflight = (async () => {
      const buffers = await Promise.all(
        OG_FONTS.map(({ file }) =>
          readFontWithTimeout(path.join(process.cwd(), "node_modules", file))
        )
      );
      const toArrayBuffer = (b: Buffer): ArrayBuffer =>
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const fonts: readonly OgFont[] = OG_FONTS.flatMap(({ name }, i) => {
        const buf = buffers[i];
        if (!buf) return [];
        return [
          {
            name,
            data: toArrayBuffer(buf),
            weight: 700,
            style: "normal",
          } satisfies OgFont,
        ];
      });

      if (fonts.length < OG_FONTS.length) {
        const missing = OG_FONTS
          .filter((_, i) => !buffers[i])
          .map((f) => f.name);
        // Cache-partial-result trade-off: caching a degraded set means
        // warm requests on this lambda continue serving the same
        // partial render until the process recycles, but it avoids
        // re-reading the missing files on every request. Across the
        // fleet, the next process boot retries from a warm filesystem
        // and almost always gets all 11. The Sentry message is the
        // signal that tells us if a font keeps failing across many
        // lambdas (real bug) vs. transient cold-start I/O (expected,
        // self-heals on recycle).
        Sentry.captureMessage("og.fonts.partial_load", {
          level: "warning",
          extra: {
            loaded: fonts.length,
            expected: OG_FONTS.length,
            missing,
          },
        });
      }

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

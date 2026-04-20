import { readFile } from "node:fs/promises";
import path from "node:path";

export type OgFont = {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 700;
  readonly style: "normal";
};

export const OG_FONT_STACK = '"DMSans", "NotoSansKR", "NotoSansJP", sans-serif';

// Single source of truth for the three WOFFs the OG renderer pulls off disk.
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
] as const;

let cachedFonts: readonly OgFont[] | null = null;
// Share an in-flight read across concurrent callers so a cold-start burst of OG
// requests doesn't re-read the same three WOFFs from disk once per request.
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

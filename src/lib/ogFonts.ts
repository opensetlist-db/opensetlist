import { readFile } from "node:fs/promises";
import path from "node:path";

export type OgFont = {
  readonly name: string;
  readonly data: ArrayBuffer;
  readonly weight: 700;
  readonly style: "normal";
};

export const OG_FONT_STACK = '"DMSans", "NotoSansKR", "NotoSansJP", sans-serif';

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
      const read = (rel: string) =>
        readFile(path.join(process.cwd(), "node_modules", rel));
      const [dmSans, notoKr, notoJp] = await Promise.all([
        read("@fontsource/dm-sans/files/dm-sans-latin-700-normal.woff"),
        read("@fontsource/noto-sans-kr/files/noto-sans-kr-korean-700-normal.woff"),
        read("@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff"),
      ]);
      const toArrayBuffer = (b: Buffer): ArrayBuffer =>
        b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      const fonts: readonly OgFont[] = [
        { name: "DMSans", data: toArrayBuffer(dmSans), weight: 700, style: "normal" },
        { name: "NotoSansKR", data: toArrayBuffer(notoKr), weight: 700, style: "normal" },
        { name: "NotoSansJP", data: toArrayBuffer(notoJp), weight: 700, style: "normal" },
      ];
      cachedFonts = fonts;
      return fonts;
    })().finally(() => {
      inflight = null;
    });
  }
  const fonts = await inflight;
  return [...fonts];
}

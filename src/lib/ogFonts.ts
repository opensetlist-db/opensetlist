import { readFile } from "node:fs/promises";
import path from "node:path";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 700;
  style: "normal";
};

export const OG_FONT_STACK = '"DMSans", "NotoSansKR", "NotoSansJP", sans-serif';

let cachedFonts: OgFont[] | null = null;
// Share an in-flight read across concurrent callers so a cold-start burst of OG
// requests doesn't re-read the same three WOFFs from disk once per request.
let inflight: Promise<OgFont[]> | null = null;

export async function loadOgFonts(): Promise<OgFont[]> {
  if (cachedFonts) return cachedFonts;
  if (inflight) return inflight;

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
    cachedFonts = [
      { name: "DMSans", data: toArrayBuffer(dmSans), weight: 700, style: "normal" },
      { name: "NotoSansKR", data: toArrayBuffer(notoKr), weight: 700, style: "normal" },
      { name: "NotoSansJP", data: toArrayBuffer(notoJp), weight: 700, style: "normal" },
    ];
    return cachedFonts;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

import { createElement as h, type CSSProperties } from "react";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import satori, { type Font } from "satori";
import { ImageResponse } from "@vercel/og";
import { OG_FONTS, OG_FONT_STACK } from "../ogFonts";
import type { CardContent, CardMode } from "./content";

export const TEMPLATE = {
  id: "event-setlist-paper-v1",
  width: 1200, height: 630,
  textWidth: 712,
  title: { min: 40, max: 60, lines: 4, height: 208, lineHeight: 1.18 },
  performance: { min: 28, max: 32, lines: 2, height: 78, lineHeight: 1.18 },
  context: { min: 24, max: 24, lines: 1, height: 30, lineHeight: 1.18 },
  venue: { min: 28, max: 28, lines: 2, height: 68, lineHeight: 1.18 },
} as const;
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ACCENTS = { prediction: "#bc2869", live: "#176bb1", setlist: "#7042b4" };
const box = (style: CSSProperties, ...children: React.ReactNode[]) => h("div", { style: { display: "flex", ...style } }, ...children);

export async function loadCardResources(root: string) {
  // Legacy OG deliberately tolerates font failures. Reviewed event cards cannot:
  // every declared file must exist, and Satori must resolve every actual glyph.
  const fonts = await Promise.all(OG_FONTS.map(async ({ name, file }) => {
    const data = await readFile(path.join(root, "node_modules", file));
    return { name, data, weight: 700 as const, style: "normal" as const, file, sha256: sha256(data) };
  }));
  const logo = await readFile(path.join(root, "public/images/opensetlist-symbol-40.svg"));
  const brand = await readFile(path.join(root, "node_modules/@fontsource/josefin-sans/files/josefin-sans-latin-400-normal.woff"));
  // The site pairs this symbol with a Josefin wordmark. Embed it as outlines rather
  // than allowing Resvg to silently substitute an OS sans-serif face.
  const wordmark = await satori(h("div", { style: { fontFamily: "Josefin", fontSize: 18, color: "#1a1a1a" } }, "OPENSETLIST"), {
    width: 220, height: 48, fonts: [{ name: "Josefin", data: brand, weight: 400 }],
  });
  return {
    fonts,
    fontIdentity: [...fonts.map(({ name, file, sha256 }) => ({ name, file, sha256, weight: 700 })),
      { name: "Josefin", file: "@fontsource/josefin-sans/files/josefin-sans-latin-400-normal.woff", sha256: sha256(brand), weight: 400 }],
    logo: `data:image/svg+xml;base64,${logo.toString("base64")}`,
    wordmark: `data:image/svg+xml;base64,${Buffer.from(wordmark).toString("base64")}`,
    logoHash: sha256(logo),
  };
}
export type CardResources = Awaited<ReturnType<typeof loadCardResources>>;

type Layout = { fontSize: number; height: number; lines: number };
export class CardLayoutError extends Error {}
export class CardFontError extends Error {}
async function fit(text: string, area: { min: number; max: number; lines: number; height: number; lineHeight: number }, fonts: Font[]): Promise<Layout> {
  if (!text) return { fontSize: area.max, height: 0, lines: 0 };
  if (/[\u0000-\u001f\u007f]/u.test(text)) throw new CardLayoutError("제어 문자가 포함된 표시 내용입니다.");
  for (let size = area.max; size >= area.min; size -= 2) {
    let measured = 0;
    await satori(box({ width: TEMPLATE.textWidth, flexDirection: "column", fontFamily: OG_FONT_STACK, fontWeight: 700 },
      h("div", { "data-measure": true, style: { fontSize: size, lineHeight: area.lineHeight, wordBreak: "break-word" } }, text)), {
      width: TEMPLATE.textWidth, fonts,
      loadAdditionalAsset: async (_code, segment) => { throw new CardFontError(`필수 글리프 누락: ${segment}`); },
      onNodeDetected: (node) => { if (node.props["data-measure"]) measured = node.height; },
    });
    const lines = Math.round(measured / (size * area.lineHeight));
    if (measured > 0 && measured <= area.height && lines <= area.lines) return { fontSize: size, height: measured, lines };
  }
  throw new CardLayoutError(`읽기 가능한 배치 실패 (${area.min}px / ${area.lines}줄): ${text}`);
}

export async function renderCard(content: CardContent, mode: CardMode, label: string, resources: CardResources) {
  const { fonts } = resources;
  const layout = {
    title: await fit(content.title, { ...TEMPLATE.title, height: content.context ? 203 : TEMPLATE.title.height }, fonts),
    performance: await fit(content.performance, TEMPLATE.performance, fonts),
    context: await fit(content.context, TEMPLATE.context, fonts),
    venue: await fit(content.venue, TEMPLATE.venue, fonts),
    date: await fit(content.date, { min: 34, max: 34, lines: 1, height: 43, lineHeight: 1.18 }, fonts),
    label: await fit(label, { min: 30, max: 30, lines: 1, height: 38, lineHeight: 1.18 }, fonts),
  };
  const accent = ACCENTS[mode];
  const text = (value: string, top: number, size: number, color = "#172542") => box({ position: "absolute", left: 54, top, width: TEMPLATE.textWidth, fontSize: size, lineHeight: 1.18, wordBreak: "break-word", color }, value);
  const sheet = box({ position: "absolute", left: 830, top: 154, width: 310, height: 412, borderRadius: 24, background: "#ffffff", border: "2px solid #d5e0f3", transform: "rotate(7deg)", flexDirection: "column", padding: "34px 24px", boxShadow: "0 14px 28px #c9d7ee" },
    box({ width: 80, height: 7, borderRadius: 4, background: accent, marginBottom: 34 }),
    ...Array.from({ length: 6 }, (_, i) => box({ alignItems: "center", marginBottom: 24, gap: 14 },
      box({ fontSize: 23, color: "#7d8dab" }, String(i + 1).padStart(2, "0")),
      box({ width: [164, 134, 153, 118, 142, 109][i], height: 14, borderRadius: 7, background: i % 2 ? "#dce9f8" : "#e7dcf5", borderLeft: `5px solid ${accent}` }),
    )),
  );
  const tree = box({ width: 1200, height: 630, position: "relative", fontFamily: OG_FONT_STACK, fontWeight: 700, background: "linear-gradient(115deg, #f5faff 0%, #edf4ff 58%, #eeeafa 100%)", color: "#172542" },
    box({ position: "absolute", left: 915, top: -130, width: 500, height: 800, borderRadius: 250, border: "2px solid #ffffff", transform: "rotate(32deg)" }),
    h("img", { src: resources.logo, width: 40, height: 40, alt: "", style: { position: "absolute", left: 54, top: 38 } }),
    h("img", { src: resources.wordmark, width: 220, height: 48, alt: "", style: { position: "absolute", left: 106, top: 49 } }),
    box({ position: "absolute", left: 54, top: 101, padding: "7px 16px", borderLeft: `5px solid ${accent}`, background: "#ffffff", color: accent, fontSize: 30, lineHeight: 1.18 }, label),
    text(content.context, 159, layout.context.fontSize, "#596a87"),
    text(content.title, content.context ? 195 : 163, layout.title.fontSize),
    text(content.performance, 405, layout.performance.fontSize, "#334968"),
    text(content.date, 492, layout.date.fontSize),
    text(content.venue, 543, layout.venue.fontSize, "#445976"),
    sheet,
    // Small mode motif; positions and sheet geometry stay constant.
    box({ position: "absolute", left: 1080, top: 93, width: 34, height: 34, borderRadius: mode === "live" ? 17 : 6, border: `3px solid ${accent}`, transform: "rotate(12deg)", background: mode === "setlist" ? accent : "transparent" }),
  );
  // Both passes use the same Satori/fonts. Validate the whole composition too:
  // fitting each string alone must not hide collisions with adjacent regions.
  if (layout.title.height + (content.context ? 195 : 163) > 398) throw new CardLayoutError("제목과 회차 영역이 겹칩니다.");
  const png = Buffer.from(await new ImageResponse(tree, { width: 1200, height: 630, fonts }).arrayBuffer());
  return { png, layout };
}

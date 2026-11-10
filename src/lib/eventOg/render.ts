import { createElement as h, type CSSProperties } from "react";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import satori, { type Font } from "satori";
import { ImageResponse } from "@vercel/og";
import { OG_FONTS, OG_FONT_STACK } from "../ogFonts";
import type { CardContent, CardMode } from "./content";

export const TEMPLATE = {
  id: "event-setlist-paper-v2",
  width: 1200, height: 630,
  textWidth: 865,
  title: { min: 40, max: 60, lines: 4, height: 224, lineHeight: 1.18 },
  performance: { min: 28, max: 34, lines: 2, height: 82, lineHeight: 1.18 },
  context: { min: 22, max: 24, lines: 1, height: 52, lineHeight: 1.18 },
  venue: { min: 28, max: 28, lines: 2, height: 96, lineHeight: 1.18 },
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

type TextLayout = { fontSize: number; height: number; lines: number };
type Layout = TextLayout & { sub: TextLayout | null };
type LayoutField = "title" | "performance" | "context" | "venue" | "date" | "label";
export class CardLayoutError extends Error {
  readonly field: LayoutField;
  constructor(message: string, field: LayoutField) {
    super(message);
    this.field = field;
  }
}
export class CardFontError extends Error {}
async function fit(
  field: LayoutField, text: string, sub: string | null,
  area: { min: number; max: number; lines: number; height: number; lineHeight: number },
  fonts: Font[],
): Promise<Layout> {
  if (!text && !sub) return { fontSize: area.max, height: 0, lines: 0, sub: null };
  if (/[\u0000-\u001f\u007f]/u.test(text) || (sub && /[\u0000-\u001f\u007f]/u.test(sub))) {
    throw new Error("제어 문자가 포함된 표시 내용입니다.");
  }
  for (let size = area.max; size >= area.min; size -= 2) {
    const subSize = Math.round(size * 0.76);
    let height = 0;
    let subHeight = 0;
    const measure = (value: string, fontSize: number, part: string) => h("div", {
      "data-measure": part, style: { fontSize, lineHeight: area.lineHeight, wordBreak: "break-word" },
    }, value);
    await satori(box({ width: TEMPLATE.textWidth, flexDirection: "column", fontFamily: OG_FONT_STACK, fontWeight: 700 },
      text ? measure(text, size, "main") : null, sub ? measure(sub, subSize, "sub") : null), {
      width: TEMPLATE.textWidth, fonts,
      loadAdditionalAsset: async (_code, segment) => { throw new CardFontError(`필수 글리프 누락: ${segment}`); },
      onNodeDetected: (node) => {
        if (node.props["data-measure"] === "main") height = node.height;
        if (node.props["data-measure"] === "sub") subHeight = node.height;
      },
    });
    const lines = Math.round(height / (size * area.lineHeight));
    const subLines = Math.round(subHeight / (subSize * area.lineHeight));
    if ((!text || height > 0) && (!sub || subHeight > 0)
      && height + subHeight <= area.height && lines <= area.lines && subLines <= area.lines) {
      return { fontSize: size, height, lines, sub: sub ? { fontSize: subSize, height: subHeight, lines: subLines } : null };
    }
  }
  throw new CardLayoutError(`읽기 가능한 배치 실패 (${area.min}px / ${area.lines}줄): ${text}`, field);
}

export async function renderCard(content: CardContent, mode: CardMode, label: string, resources: CardResources) {
  const { fonts } = resources;
  const performance = await fit("performance", content.performance, content.performanceSub, TEMPLATE.performance, fonts);
  const context = await fit("context", content.context, content.contextSub, TEMPLATE.context, fonts);
  const venue = await fit("venue", content.venue, content.venueSub, TEMPLATE.venue, fonts);
  const date = await fit("date", content.date, null, { min: 30, max: 30, lines: 1, height: 39, lineHeight: 1.18 }, fonts);
  const labelLayout = await fit("label", label, null, { min: 30, max: 30, lines: 1, height: 38, lineHeight: 1.18 }, fonts);
  const totalHeight = (part: Layout) => part.height + (part.sub?.height ?? 0);
  const gap = 6;
  let top = 154;
  const supportingHeight = [performance, context, venue, date].reduce((height, part) =>
    totalHeight(part) ? height + totalHeight(part) + gap : height, 0);
  const titleHeight = Math.min(TEMPLATE.title.height, TEMPLATE.height - top - supportingHeight - gap - 8);
  const title = await fit("title", content.title, content.titleSub, { ...TEMPLATE.title, height: titleHeight }, fonts);
  const layout = { title, performance, context, venue, date, label: labelLayout };
  const accent = ACCENTS[mode];
  const text = (value: string, sub: string | null, measured: Layout, color = "#172542") => {
    if (!value && !sub) return null;
    const line = (value: string, fontSize: number, color: string) =>
      box({ fontSize, lineHeight: 1.18, wordBreak: "break-word", color }, value);
    const group = box({ position: "absolute", left: 54, top, width: TEMPLATE.textWidth, flexDirection: "column" },
      value ? line(value, measured.fontSize, color) : null,
      sub && measured.sub ? line(sub, measured.sub.fontSize, "#445976") : null);
    top += totalHeight(measured) + gap;
    return group;
  };
  const sheet = box({ position: "absolute", left: 949, top: 154, width: 193, height: 412, borderRadius: 24, background: "#ffffff", border: "2px solid #d5e0f3", transform: "rotate(7deg)", flexDirection: "column", padding: "34px 24px", boxShadow: "0 14px 28px #c9d7ee" },
    box({ width: 80, height: 7, borderRadius: 4, background: accent, marginBottom: 34 }),
    ...Array.from({ length: 6 }, (_, i) => box({ alignItems: "center", marginBottom: 24, gap: 14 },
      box({ fontSize: 23, color: "#7d8dab" }, String(i + 1).padStart(2, "0")),
      box({ width: [103, 88, 94, 70, 96, 80][i], height: 14, borderRadius: 7, background: i % 2 ? "#dce9f8" : "#e7dcf5", borderLeft: `5px solid ${accent}` }),
    )),
  );
  const tree = box({ width: 1200, height: 630, position: "relative", fontFamily: OG_FONT_STACK, fontWeight: 700, background: "linear-gradient(115deg, #f5faff 0%, #edf4ff 58%, #eeeafa 100%)", color: "#172542" },
    box({ position: "absolute", left: 915, top: -130, width: 500, height: 800, borderRadius: 250, border: "2px solid #ffffff", transform: "rotate(32deg)" }),
    h("img", { src: resources.logo, width: 40, height: 40, alt: "", style: { position: "absolute", left: 54, top: 38 } }),
    h("img", { src: resources.wordmark, width: 220, height: 48, alt: "", style: { position: "absolute", left: 106, top: 49 } }),
    box({ position: "absolute", left: 54, top: 101, padding: "7px 16px", borderLeft: `5px solid ${accent}`, background: "#ffffff", color: accent, fontSize: 30, lineHeight: 1.18 }, label),
    text(content.context, content.contextSub, layout.context, "#596a87"),
    text(content.title, content.titleSub, layout.title),
    text(content.performance, content.performanceSub, layout.performance, "#334968"),
    text(content.date, null, layout.date),
    text(content.venue, content.venueSub, layout.venue, "#445976"),
    sheet,
    // Small mode motif; positions and sheet geometry stay constant.
    box({ position: "absolute", left: 1080, top: 93, width: 34, height: 34, borderRadius: mode === "live" ? 17 : 6, border: `3px solid ${accent}`, transform: "rotate(12deg)", background: mode === "setlist" ? accent : "transparent" }),
  );
  // Both passes use the same Satori/fonts. Validate the whole composition too:
  // fitting each string alone must not hide collisions with adjacent regions.
  if (top > TEMPLATE.height) throw new CardLayoutError("카드의 텍스트 영역을 벗어났습니다.", "venue");
  const png = Buffer.from(await new ImageResponse(tree, { width: 1200, height: 630, fonts }).arrayBuffer());
  return { png, layout };
}

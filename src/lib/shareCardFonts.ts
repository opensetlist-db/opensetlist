/** A settled fonts.ready promise also settles after network failures.
 * Resolve each rendered character to a declared, exact-weight self-hosted
 * face before capture; otherwise a fallback or synthetic bold can be saved
 * as a seemingly successful PNG. Browser/CDP evidence additionally verifies
 * the delivered font bytes and rendered glyphs against the font manifest.
 */
const SHARE_FAMILIES = new Set([
  "DM Sans", "Noto Sans JP", "Noto Sans KR", "Josefin Sans",
]);

function familyName(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function covers(range: string, point: number): boolean {
  return range.split(",").some((part) => {
    const bounds = part.trim().replace(/^U\+/i, "").split("-");
    const lower = parseInt(bounds[0].replace(/\?/g, "0"), 16);
    const upper = parseInt((bounds[1] ?? bounds[0]).replace(/\?/g, "F"), 16);
    return point >= lower && point <= upper;
  });
}

// A failed CSS-connected face's load promise stays rejected. On a later
// user retry, use its same-origin @font-face source to create a fresh face.
// Concurrent preview/share attempts share one retry, and failed attempts
// are removed so the next explicit attempt can recover after the network.
const retries = new WeakMap<FontFace, Promise<FontFace>>();

function retryFace(face: FontFace, doc: Document): Promise<FontFace> {
  const existing = retries.get(face);
  if (existing) return existing;
  const attempt = (async () => {
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of Array.from(rules)) {
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const style = (rule as CSSFontFaceRule).style;
        if (familyName(style.getPropertyValue("font-family")) !== familyName(face.family) ||
            style.getPropertyValue("font-weight") !== face.weight ||
            style.getPropertyValue("font-style") !== face.style ||
            style.getPropertyValue("unicode-range").replace(/\s/g, "").toUpperCase() !==
              face.unicodeRange.replace(/\s/g, "").toUpperCase()) continue;
        const source = style.getPropertyValue("src").replace(
          /url\(["']?([^"')]+)["']?\)/g,
          (_match, url: string) => {
            const resolved = new URL(url, sheet.href ?? doc.baseURI);
            if (resolved.origin !== new URL(doc.baseURI).origin) {
              throw new Error("Share font source must be self-hosted");
            }
            return `url("${resolved.href}")`;
          },
        );
        const replacement = new FontFace(face.family, source, {
          weight: face.weight, style: face.style, unicodeRange: face.unicodeRange,
        });
        await replacement.load();
        doc.fonts.add(replacement);
        return replacement;
      }
    }
    throw new Error("Share font unavailable");
  })();
  retries.set(face, attempt);
  void attempt.catch(() => retries.delete(face));
  return attempt;
}

export async function prepareShareCardFonts(card: HTMLElement): Promise<void> {
  const doc = card.ownerDocument;
  const view = doc.defaultView;
  if (!doc.fonts || !view) throw new Error("Share font loading unavailable");
  const faces = Array.from(doc.fonts);
  const required = new Set<FontFace>();
  const walker = doc.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? "";
    if (!text.trim() || !node.parentElement) continue;
    const style = view.getComputedStyle(node.parentElement);
    const families = style.fontFamily.split(",").map(familyName)
      .filter((family) => SHARE_FAMILIES.has(family));
    for (const char of new Set(text)) {
      if (/\s/u.test(char)) continue;
      const point = char.codePointAt(0)!;
      let match: FontFace | undefined;
      for (const family of families) {
        match = faces.find((face) => familyName(face.family) === family &&
          face.weight === style.fontWeight && face.style === style.fontStyle &&
          covers(face.unicodeRange, point));
        if (match) break;
      }
      if (!match) throw new Error("Share font glyph or weight unavailable");
      required.add(match);
    }
  }
  await Promise.all(Array.from(required, async (face) => {
    // The first failed load surfaces as a failure. A subsequent export
    // attempt can retry the identical declared face without a page reload.
    const loaded = face.status === "error" ? await retryFace(face, doc) : await face.load();
    if (loaded.status !== "loaded") throw new Error("Share font unavailable");
  }));
}

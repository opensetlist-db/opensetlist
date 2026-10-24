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

function parseRanges(range: string): [number, number][] {
  return range.split(",").map((part) => {
    const bounds = part.trim().replace(/^U\+/i, "").split("-");
    const lower = parseInt(bounds[0].replace(/\?/g, "0"), 16);
    const upper = parseInt((bounds[1] ?? bounds[0]).replace(/\?/g, "F"), 16);
    return [lower, upper];
  });
}

// A failed CSS-connected face's load promise stays rejected. On a later
// user retry, use its same-origin @font-face source to create a fresh face.
// Concurrent preview/share attempts share one retry, and failed attempts
// are removed so the next explicit attempt can recover after the network.
const retries = new WeakMap<FontFace, Promise<FontFace>>();
const RETRY_TIMEOUT_MS = 10_000;

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
        const Font = doc.defaultView?.FontFace;
        if (!Font) throw new Error("Share font loading unavailable");
        // CSS-connected families may include CSS quotes (WebKit). Passing
        // those quotes to the constructor makes them part of the family name.
        const replacement = new Font(familyName(face.family), source, {
          weight: face.weight, style: face.style, unicodeRange: face.unicodeRange,
        });
        // Some engines leave an aborted FontFace.load() pending. The outer
        // render deadline releases the UI, but must not leave this shared
        // retry promise cached forever or every later click would reuse it.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Share font unavailable")), RETRY_TIMEOUT_MS);
          replacement.load().then(() => resolve(), reject).finally(() => clearTimeout(timer));
        });
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
  // A locale stylesheet contains hundreds of subset faces. Index descriptors
  // and parse coverage once, rather than repeating string/regex work for every
  // character in every row (and again in html2canvas's cloned document).
  const faces = new Map<string, { face: FontFace; ranges: [number, number][] }[]>();
  for (const face of Array.from(doc.fonts)) {
    const family = familyName(face.family);
    if (!SHARE_FAMILIES.has(family)) continue;
    const key = `${family}:${face.weight}:${face.style}`;
    const entries = faces.get(key) ?? [];
    entries.push({ face, ranges: parseRanges(face.unicodeRange) });
    faces.set(key, entries);
  }
  const characters = new Map<string, Map<number, FontFace>>();
  const required = new Set<FontFace>();
  const walker = doc.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent ?? "";
    if (!text.trim() || !node.parentElement) continue;
    const style = view.getComputedStyle(node.parentElement);
    const families = style.fontFamily.split(",").map(familyName)
      .filter((family) => SHARE_FAMILIES.has(family));
    const candidates = families.map((family) =>
      faces.get(`${family}:${style.fontWeight}:${style.fontStyle}`) ?? []);
    const key = `${style.fontFamily}:${style.fontWeight}:${style.fontStyle}`;
    const matches = characters.get(key) ?? new Map<number, FontFace>();
    characters.set(key, matches);
    for (const char of new Set(text)) {
      if (/\s/u.test(char)) continue;
      const point = char.codePointAt(0)!;
      let match = matches.get(point);
      if (!match) for (const family of candidates) {
        const covers = ({ ranges }: { ranges: [number, number][] }) =>
          ranges.some(([lower, upper]) => point >= lower && point <= upper);
        // A successful replacement coexists with the original failed CSS
        // face. Reuse it within its family, preserving CSS family priority.
        match = family.find((entry) => entry.face.status === "loaded" && covers(entry))?.face ??
          family.find(covers)?.face;
        if (match) break;
      }
      if (!match) throw new Error("Share font glyph or weight unavailable");
      matches.set(point, match);
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

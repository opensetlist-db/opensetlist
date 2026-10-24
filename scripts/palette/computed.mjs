const properties = [
  "color", "background-color", "background-image", "border-top-color",
  "border-right-color", "border-bottom-color", "border-left-color",
  "border-image-source", "outline-color", "text-decoration-color",
  "caret-color", "fill", "stroke", "box-shadow", "text-shadow",
  "column-rule-color", "accent-color", "scrollbar-color", "mask-image",
  "filter", "backdrop-filter",
];

// Turbopack's generated CSS-module classes contain a six-character build
// hash between two literal "__" separators. Anchoring both sides avoids
// erasing local names (including underscores) or arbitrary user classes.
const moduleClass = /^([A-Za-z][A-Za-z0-9_-]*-module)__([A-Za-z0-9_-]{6})__([A-Za-z_][A-Za-z0-9_-]*)$/;
const moduleInText = /(?<![A-Za-z0-9_-])([A-Za-z][A-Za-z0-9_-]*-module)__([A-Za-z0-9_-]{6})__([A-Za-z_][A-Za-z0-9_-]*)(?![A-Za-z0-9_-])/g;

export function normalizeModuleHash(value) {
  if (typeof value !== "string") return value;
  return value.replace(moduleInText, "$1__<build-hash>__$3");
}

function normalizeClassList(value) {
  return String(value ?? "").split(/\s+/).filter(Boolean).map((token) => {
    const match = moduleClass.exec(token);
    return match ? `${match[1]}__<build-hash>__${match[3]}` : token;
  }).join(" ");
}

export async function captureComputed(page) {
  return page.evaluate((targetProperties) => {
    const excluded = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
    const elements = [document.documentElement, ...document.querySelectorAll("body, body *")]
      .filter((element) => !excluded.has(element.tagName));
    const styles = elements.map((element) => {
      const identity = [element.tagName.toLowerCase(), element.id, element.getAttribute("class") ?? "",
        element.getAttribute("role"), element.getAttribute("name")];
      const computed = [null, "::before", "::after"].map((pseudo) => {
        const css = getComputedStyle(element, pseudo);
        return [css.content, ...targetProperties.map((property) => css.getPropertyValue(property))];
      });
      return [identity, ...computed];
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const text = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("script, style, noscript, template")) continue;
      const value = node.textContent.replace(/\s+/g, " ").trim();
      if (value) text.push(value);
    }
    const images = [...document.images].map((image) => {
      const url = new URL(image.currentSrc || image.src, location.href);
      return { src: url.origin === location.origin ? url.pathname + url.search : url.href, complete: image.complete,
        naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    });
    return { properties: targetProperties, styles, text, images,
      fontsStatus: document.fonts.status, readyState: document.readyState,
      url: location.pathname + location.search };
  }, properties);
}

export function compareComputed(before, after) {
  const differences = [];
  const add = (kind, details) => differences.push({ kind, ...details });
  for (const field of ["properties", "url", "fontsStatus", "readyState", "images"]) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) {
      add(field, { before: before[field], after: after[field] });
    }
  }
  for (const field of ["text", "styles"]) {
    if (before[field].length !== after[field].length) add(`${field}-count`, { before: before[field].length, after: after[field].length });
  }
  for (let i = 0; i < Math.max(before.text.length, after.text.length); i++) {
    if (before.text[i] !== after.text[i]) add("text", { index: i, before: before.text[i], after: after.text[i] });
  }
  for (let i = 0; i < Math.max(before.styles.length, after.styles.length); i++) {
    const old = before.styles[i], next = after.styles[i];
    if (!old || !next) continue;
    const oldIdentity = [...old[0]], nextIdentity = [...next[0]];
    oldIdentity[2] = normalizeClassList(oldIdentity[2]);
    nextIdentity[2] = normalizeClassList(nextIdentity[2]);
    if (JSON.stringify(oldIdentity) !== JSON.stringify(nextIdentity)) {
      add("element-identity", { index: i, before: old[0], after: next[0] });
      // An insertion/reorder may shift ordinal indices. Its computed values
      // no longer have a trustworthy pair, so report identity first.
      continue;
    }
    for (let pseudo = 1; pseudo <= 3; pseudo++) {
      const a = old[pseudo] ?? [], b = next[pseudo] ?? [];
      if (a.length !== b.length) add("computed-count", { index: i, pseudo, before: a.length, after: b.length });
      for (let j = 0; j < Math.max(a.length, b.length); j++) {
        // Computed values are always compared byte-for-byte, even when a
        // value happens to resemble a generated class name.
        if (a[j] !== b[j]) add("computed", { index: i, identity: old[0],
          pseudo: pseudo === 1 ? null : pseudo === 2 ? "::before" : "::after",
          property: j === 0 ? "content" : before.properties[j - 1], before: a[j], after: b[j] });
      }
    }
  }
  return { equal: differences.length === 0, count: differences.length,
    byKind: Object.fromEntries([...new Set(differences.map((row) => row.kind))].map((kind) =>
      [kind, differences.filter((row) => row.kind === kind).length])), differences };
}

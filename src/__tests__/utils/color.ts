// jsdom returns inline style colors as `rgb(r, g, b)` regardless of input form.
// Convert hex → rgb so tests can assert against the same source-of-truth value
// the component renders, without duplicating jsdom-converted RGB literals.
export function hexToRgbString(hex: string): string {
  // Anchor the strip to a leading `#` only — `hex.replace("#", "")`
  // would have stripped a stray `#` mid-string too if it ever
  // appeared. Six-hex validation below catches the same garbage,
  // but the regex keeps the intent explicit.
  const h = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    // Throw rather than return `rgb(NaN, NaN, NaN)` — a stray bad hex
    // somewhere in tokens would silently turn assertions into no-ops.
    throw new TypeError(`Invalid hex color: ${hex}`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

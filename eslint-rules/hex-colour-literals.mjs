/**
 * `no-restricted-syntax` entries for hard-coded `#RGB` / `#RRGGBB` colours.
 *
 * Colour values come from `src/styles/tokens.ts` (`colors`,
 * `shareCardColors`, …). When the redesign swapped the palette
 * (primary #0277BD → #165DCC), three unit tests broke because they
 * compared rendered styles against literal hexes, and several
 * components kept rendering the old blue because they carried their own
 * copy of it. A token reference follows a palette change; a literal
 * silently stays behind. These entries surface the literals in lint so
 * a reviewer does not have to.
 *
 * Two shapes, because components and tests differ:
 *
 * - `hexColourLiteralRestrictions` — components: any string literal or
 *   template chunk that contains a hex colour, including inside a longer
 *   value (`"1px solid #e2e8f0"`, `` `0 0 0 2px #fff` ``).
 * - `hexColourAssertionRestrictions` — tests: only a hex used as the
 *   *expected* value — a direct argument of a matcher (`toBe("#…")`),
 *   anything inside `toHaveStyle(…)`, or `hexToRgbString("#…")`. A hex that is input data (an artist
 *   colour fed into a component, a fixture row) stays allowed: it is not
 *   a copy of the palette. A test that echoes its input back
 *   (`color: "#FF6B9D"` … `toBe(hexToRgbString("#FF6B9D"))`) names it
 *   once in a const and uses the const on both sides; a test that checks
 *   a palette colour imports it from tokens.
 *
 * The hex must not run on into more hex/word characters, so anchors such
 * as `#main` or `#add-song` and longer ids (`#1234567`) do not match.
 */
const HEX = "#(?:[0-9a-fA-F]{3}){1,2}(?![0-9a-zA-Z_-])";

const componentMessage =
  "Hard-coded hex colour: use a token from src/styles/tokens.ts (colors, shareCardColors, …) so a palette change reaches this code";

export const hexColourLiteralRestrictions = [
  {
    selector: `Literal[value=/${HEX}/]`,
    message: componentMessage,
  },
  {
    selector: `TemplateElement[value.raw=/${HEX}/]`,
    message: componentMessage,
  },
];

const assertionMessage =
  "Expected value is a hex literal: import the colour from src/styles/tokens.ts, or name the test's input colour in a const and reuse it — a literal here breaks on every palette change";

const FULL_HEX = `^${HEX}$`;

export const hexColourAssertionRestrictions = [
  {
    selector: `CallExpression[callee.property.name=/^(toBe|toEqual|toStrictEqual|toContain|toMatch|toHaveProperty)$/] > Literal.arguments[value=/${FULL_HEX}/]`,
    message: assertionMessage,
  },
  {
    // `toHaveStyle` takes a CSS string (`"color: #fff"`) or an object
    // (`{ color: "#fff" }`) and is only ever an expectation, so any hex
    // anywhere in its arguments counts.
    selector: `CallExpression[callee.property.name='toHaveStyle'] Literal[value=/${HEX}/]`,
    message: assertionMessage,
  },
  {
    selector: `CallExpression[callee.name='hexToRgbString'] > Literal.arguments[value=/${FULL_HEX}/]`,
    message: assertionMessage,
  },
];

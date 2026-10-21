// @vitest-environment node
//
// Colours come from src/styles/tokens.ts; eslint.config.mjs warns on hex
// literals in components and on hex expected values in tests with these
// `no-restricted-syntax` entries — pinned here so a selector typo (or an
// esquery regex quirk) can't silently turn the rule into a no-op.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import { builtinRules } from "eslint/use-at-your-own-risk";
import tsParser from "@typescript-eslint/parser";
import {
  hexColourAssertionRestrictions,
  hexColourLiteralRestrictions,
} from "../../../eslint-rules/hex-colour-literals.mjs";

const rule = builtinRules.get("no-restricted-syntax") as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const component = hexColourLiteralRestrictions;
const componentError = { message: component[0].message };

tester.run("hex colour literals (components)", rule, {
  valid: [
    // The token reference the rule points to.
    { code: "const s = { color: colors.primary };", options: component },
    // In-page anchors and ids that merely start with `#`.
    { code: 'const a = <a href="#main">skip</a>;', options: component },
    { code: 'const id = "#add-song";', options: component },
    // Seven hex digits is not a colour.
    { code: 'const n = "#1234567";', options: component },
    // Comments are not string literals.
    { code: "// primary was #0277BD\nconst x = 1;", options: component },
  ],
  invalid: [
    {
      code: 'const s = { color: "#0277BD" };',
      options: component,
      errors: [componentError],
    },
    {
      // Short form inside a longer CSS value.
      code: 'const s = { border: "1px solid #ccc" };',
      options: component,
      errors: [componentError],
    },
    {
      // Tailwind arbitrary value in a JSX attribute.
      code: 'const e = <span className="text-[#555] px-1" />;',
      options: component,
      errors: [componentError],
    },
    {
      code: "const s = `0 0 0 2px #fff, ${shadow}`;",
      options: component,
      errors: [componentError],
    },
  ],
});

const assertion = hexColourAssertionRestrictions;
const assertionError = { message: assertion[0].message };

tester.run("hex colour assertions (tests)", rule, {
  valid: [
    // Input data: a colour fed into the code under test.
    { code: 'render(<Avatar artist={{ color: "#FF6B9D" }} />);', options: assertion },
    // Echoed input named once and reused on both sides.
    {
      code: 'const C = "#FF6B9D"; expect(el.style.background).toBe(hexToRgbString(C));',
      options: assertion,
    },
    // Expected value from tokens.
    { code: "expect(link.style.color).toBe(hexToRgbString(colors.primary));", options: assertion },
    // Not a colour.
    { code: 'expect(href).toBe("#main");', options: assertion },
  ],
  invalid: [
    {
      code: 'expect(link.style.color).toBe(hexToRgbString("#0277BD"));',
      options: assertion,
      errors: [assertionError],
    },
    {
      code: 'expect(chip.color).toBe("#e91e8c");',
      options: assertion,
      errors: [assertionError],
    },
    {
      // Both toHaveStyle shapes: CSS string and style object.
      code: 'expect(el).toHaveStyle("color: #94a3b8");',
      options: assertion,
      errors: [assertionError],
    },
    {
      code: 'expect(el).toHaveStyle({ color: "#94a3b8" });',
      options: assertion,
      errors: [assertionError],
    },
  ],
});

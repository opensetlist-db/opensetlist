// @vitest-environment node
//
// Local ESLint rule `local/no-redundant-logical` (eslint-rules/): a
// logical expression one of its own operands absorbs (`X && Y || X`)
// always equals that operand, so a QA check written that way passes
// whatever the other condition says.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import ruleModule from "../../../eslint-rules/no-redundant-logical.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

// Positive controls: the operand-shape valid cases have invalid twins
// that differ only in the repeated operand, so a valid pass shows the
// rule tells them apart rather than reporting nothing at all.
tester.run("no-redundant-logical", rule, {
  valid: [
    // Real conditions: no operand repeats across the two levels.
    "ok = a && b || c;",
    "ok = (a || b) && c;",
    "ok = a && b && c || d;",
    "ok = a && b && a;", // same operator — redundant but not absorbing
    // Similar-looking but different operands.
    "ok = a.b && c || a?.b;",
    "ok = chips[0] && rest.every((c) => !c) || chips[1];",
    // `??` has no absorption law.
    "ok = a ?? (b && a);",
  ],
  invalid: [
    {
      // The shape that passed vacuously in a page-qa scenario.
      code: "h.check('only first chip on', albums.chips[0] && albums.chips.slice(1).every((c) => !c) || albums.chips[0]);",
      errors: [
        {
          messageId: "redundant",
          data: {
            whole:
              "albums.chips[0] && albums.chips.slice(1).every((c) => !c) || albums.chips[0]",
            operand: "albums.chips[0]",
          },
        },
      ],
    },
    {
      code: "ok = x || y && x;",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "x || y && x", operand: "x" },
        },
      ],
    },
    {
      code: "ok = (y && x) || x;",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "(y && x) || x", operand: "x" },
        },
      ],
    },
    {
      code: "ok = x && (x || y);",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "x && (x || y)", operand: "x" },
        },
      ],
    },
    {
      // Formatting does not hide the repeat.
      code: "ok = a[ 0 ] && b ||\n  a[0];",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "a[ 0 ] && b ||\n  a[0]", operand: "a[0]" },
        },
      ],
    },
    {
      // Chains of the inner operator are flattened.
      code: "ok = a && b && c || a;",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "a && b && c || a", operand: "a" },
        },
      ],
    },
    {
      // Chains of the outer operator too — reported once, at the top.
      code: "ok = a || b || (c && a);",
      errors: [
        {
          messageId: "redundant",
          data: { whole: "a || b || (c && a)", operand: "a" },
        },
      ],
    },
    {
      // A repeated call is reported: in a check it still tests nothing.
      code: "async function f() { return (await p.isVisible(s)) && y || (await p.isVisible(s)); }",
      errors: [
        {
          messageId: "redundant",
          data: {
            whole: "(await p.isVisible(s)) && y || (await p.isVisible(s))",
            operand: "await p.isVisible(s)",
          },
        },
      ],
    },
  ],
});

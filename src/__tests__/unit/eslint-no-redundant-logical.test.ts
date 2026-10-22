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

tester.run("no-redundant-logical", rule, {
  valid: [
    // Real conditions: no operand repeats across the two levels.
    "ok = a && b || c;",
    "ok = (a || b) && c;",
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
      errors: [{ messageId: "redundant" }],
    },
    {
      code: "ok = x || y && x;",
      errors: [
        { messageId: "redundant", data: { whole: "x || y && x", operand: "x" } },
      ],
    },
    {
      code: "ok = (y && x) || x;",
      errors: [{ messageId: "redundant" }],
    },
    {
      code: "ok = x && (x || y);",
      errors: [{ messageId: "redundant" }],
    },
    {
      // Formatting does not hide the repeat.
      code: "ok = a[ 0 ] && b ||\n  a[0];",
      errors: [{ messageId: "redundant" }],
    },
  ],
});

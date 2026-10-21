// @vitest-environment node
//
// Local ESLint rule `local/non-literal-regexp` (eslint-rules/): the
// pattern given to `new RegExp(…)` / `RegExp(…)` is a literal. CI Semgrep
// (detect-non-literal-regexp) blocks a pattern built from a value; pinned
// here so the rule can't silently stop matching the shape Semgrep fails on.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/non-literal-regexp.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

const error = { messageId: "nonLiteral" };

tester.run("non-literal-regexp", rule, {
  valid: [
    // Positive control: a regex literal is what the message points to.
    "const re = /^\\[liveWarm\\] start /;",
    // A string-literal pattern, with or without flags.
    'new RegExp("^[a-z]+$");',
    'new RegExp("^[a-z]+$", flags);',
    "RegExp('\\\\d+');",
    // A template literal without expressions is a plain string.
    "new RegExp(`^\\\\d+$`);",
    // A regex literal handed to the constructor (copying it).
    "new RegExp(/a+/, 'g');",
    // An empty pattern has nothing to steer.
    "new RegExp();",
    // Not the global RegExp.
    "new SafeRegExp(name);",
  ],
  invalid: [
    {
      // The shape that failed a PR in CI: a name from data as the pattern.
      code: "new RegExp(name);",
      errors: [error],
    },
    {
      // Called without `new`.
      code: "RegExp(name, 'i');",
      errors: [error],
    },
    {
      // A call's result — even an escaping helper: the rule cannot see
      // that it escapes, and neither can Semgrep.
      code: "new RegExp(escapeRegExp(source), 'g');",
      errors: [error],
    },
    {
      code: "new RegExp(`\\\\bfault=${mode}\\\\b`);",
      errors: [error],
    },
    {
      code: 'new RegExp("^" + prefix);',
      errors: [error],
    },
  ],
});

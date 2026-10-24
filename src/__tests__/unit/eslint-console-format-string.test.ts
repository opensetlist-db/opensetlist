// @vitest-environment node
//
// Local ESLint rule `local/console-format-string` (eslint-rules/): a
// console call's first argument is a format string, so it stays constant
// and values go in later arguments. CI Semgrep (unsafe-formatstring)
// blocks a `${…}` template there; pinned here so the rule can't silently
// stop matching the shape Semgrep fails on.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/console-format-string.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("console-format-string", rule, {
  valid: [
    // The constant-format form the message points to.
    'console.warn("[image-upload] %s", event, fields);',
    // A template literal without expressions is a plain string.
    "console.log(`[warm] started`);",
    // A template in a later argument is a value, not the format.
    'console.error("[liveWarm] failed %s", `event=${id}`);',
    // A variable as the first argument is how values are logged.
    "console.error(err);",
    // Not the console.
    "logger.warn(`[tag] ${event}`, fields);",
  ],
  invalid: [
    {
      // The call CI Semgrep blocked.
      code: "console.warn(`[image-upload] ${event}`, fields);",
      errors: [{ messageId: "formatString", data: { method: "warn" } }],
    },
    {
      // Flagged without a second argument too: the next edit that adds
      // one would otherwise turn it into a Semgrep finding.
      code: "console.log(`[txleak] xid=${xid}`);",
      errors: [{ messageId: "formatString", data: { method: "log" } }],
    },
    {
      code: "console.error(`[liveWarm] lookup-error err=${describe(e)}`, e);",
      errors: [{ messageId: "formatString", data: { method: "error" } }],
    },
    {
      // Computed access names the method it calls.
      code: 'console["warn"](`[tag] ${event}`);',
      errors: [{ messageId: "formatString", data: { method: "warn" } }],
    },
  ],
});

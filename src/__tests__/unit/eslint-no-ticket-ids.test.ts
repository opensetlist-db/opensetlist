// @vitest-environment node
//
// Local ESLint rule `local/no-ticket-ids` (eslint-rules/): comments
// carry the reason, not the ticket that introduced it. A ticket id
// (feature tag + ticket number) rots as soon as the ticket closes; the
// feature tag alone ("n15") names a lasting area of the product and
// stays allowed.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/no-ticket-ids.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tsParser } });

tester.run("no-ticket-ids", rule, {
  valid: [
    "// Fan board (n15): one block per group.",
    "/** Shared by the board read and the admin editor (n15). */ const a = 1;",
    // Not a ticket id: dates, versions, other number pairs.
    "// stored since 2026-10-18, v0.19-02 build, ratio n1-2",
    // Code and strings are out of scope — only comments are checked.
    'const key = "n15-03";',
    "const n15_03 = 1;",
  ],
  invalid: [
    {
      code: "// The caller's own picks (n15-03).",
      errors: [{ messageId: "ticketId", data: { id: "n15-03" } }],
    },
    {
      code: "/**\n * Board pick writes (n15-03), wishes (n15-08)\n * and the bridge (n15-09b).\n */\nconst a = 1;",
      errors: [
        { messageId: "ticketId", data: { id: "n15-03" }, line: 2 },
        { messageId: "ticketId", data: { id: "n15-08" }, line: 2 },
        { messageId: "ticketId", data: { id: "n15-09b" }, line: 3 },
      ],
    },
    {
      code: "const x = 1; // until n14-02 lands",
      errors: [{ messageId: "ticketId" }],
    },
    {
      code: "// split into N15-09c later",
      errors: [{ messageId: "ticketId", data: { id: "N15-09c" } }],
    },
  ],
});

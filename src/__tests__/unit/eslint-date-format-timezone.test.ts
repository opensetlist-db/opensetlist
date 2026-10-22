// @vitest-environment node
//
// Local ESLint rule `local/date-format-timezone` (eslint-rules/): date-format
// options that render a calendar day name their `timeZone`, because a
// date-only column stored at UTC midnight otherwise renders as the previous
// day in any zone west of UTC. Pinned here so the rule keeps flagging the
// zone-less forms and keeps passing the UTC-pinned fix its message asks for.
import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
import tsParser from "@typescript-eslint/parser";
import ruleModule from "../../../eslint-rules/date-format-timezone.mjs";

const rule = ruleModule as unknown as Rule.RuleModule;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tsParser },
});

tester.run("date-format-timezone", rule, {
  valid: [
    // Positive control: the fix the message points to.
    'const F: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };',
    'formatDate(event.date, locale, { month: "long", day: "numeric", timeZone: "UTC" });',
    // An explicit non-UTC zone is a deliberate choice, not a gap.
    'const F: Intl.DateTimeFormatOptions = { day: "numeric", timeZone: "Asia/Seoul" };',
    'new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: tz });',
    'd.toLocaleDateString("ko-KR", { day: "numeric", timeZone: "UTC" });',
    // formatDate without options uses its UTC default.
    "formatDate(event.date, locale);",
    "formatDate(album.releaseDate, locale, HISTORY_ROW_DATE_FORMAT);",
    // Time-only options render in the viewer's zone on purpose.
    'const T: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };',
    'formatTime(ev.startTime, locale, { hour: "2-digit", minute: "2-digit" });',
    // Output that names its zone is labelled, not silently shifted.
    'new Intl.DateTimeFormat(locale, { year: "numeric", day: "2-digit", hour: "2-digit", timeZoneName: "short" }).format(new Date());',
    // A spread may carry the zone.
    'const F: Intl.DateTimeFormatOptions = { ...BASE, day: "numeric" };',
    // Options passed by name are checked where they are declared.
    "d.toLocaleDateString(locale, options);",
    // Not typed as date-format options.
    'const range = { year: "numeric", month: 3 };',
    "n.toLocaleString();",
    'n.toLocaleString("en-US", { maximumFractionDigits: 1 });',
  ],
  invalid: [
    {
      code: 'const F: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'export const F = { month: "short" } satisfies Intl.DateTimeFormatOptions;',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'const F = { dateStyle: "medium" } as Intl.DateTimeFormatOptions;',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      // The pattern that showed 2023-03-29 as March 28 in Los Angeles,
      // once a caller replaces formatDate's UTC default with its own.
      code: 'formatDate(currentVa.startDate, locale, { year: "numeric", month: "long", day: "numeric" });',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'new Intl.DateTimeFormat("en-US", { month: "long" }).format(d);',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'd.toLocaleDateString("ja-JP", { weekday: "short" });',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'd.toLocaleString("en-US", { year: "numeric", hour: "2-digit" });',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: "event.date.toLocaleDateString();",
      errors: [{ messageId: "bareToLocaleDateString" }],
    },
    {
      code: 'release.toLocaleDateString("ko-KR");',
      errors: [{ messageId: "bareToLocaleDateString" }],
    },
  ],
});

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
    // Reads the zone, formats nothing.
    "const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;",
    "const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;",
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
      // A caller's own options replace formatDate's UTC default whole.
      // Read in Los Angeles, a stored 2023-03-29 then renders as March 28.
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
      code: 'export const F = { month: "short" } as const satisfies Intl.DateTimeFormatOptions;',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      // Annotated and asserted: one literal, one report.
      code: 'const F: Intl.DateTimeFormatOptions = { day: "numeric" } as Intl.DateTimeFormatOptions;',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'const F = <Intl.DateTimeFormatOptions>{ "day": "numeric" };',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: 'Intl.DateTimeFormat("en-US", { day: "numeric" }).format(d);',
      errors: [{ messageId: "missingTimeZone" }],
    },
    {
      code: "event.date.toLocaleDateString();",
      errors: [{ messageId: "noOptions" }],
    },
    {
      code: 'release.toLocaleDateString("ko-KR");',
      errors: [{ messageId: "noOptions" }],
    },
    {
      // An explicit `undefined` is the same as no options.
      code: "d.toLocaleDateString(locale, undefined);",
      errors: [{ messageId: "noOptions" }],
    },
    {
      code: "new Intl.DateTimeFormat(locale).format(event.date);",
      errors: [{ messageId: "noOptions" }],
    },
    {
      code: "Intl.DateTimeFormat(locale, undefined).format(d);",
      errors: [{ messageId: "noOptions" }],
    },
    {
      // Only an immediate `.resolvedOptions()` is exempt: a formatter
      // kept in a variable is there to format a day.
      code: "const f = new Intl.DateTimeFormat(locale); f.format(d);",
      errors: [{ messageId: "noOptions" }],
    },
  ],
});

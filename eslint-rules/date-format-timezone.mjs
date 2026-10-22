/**
 * `local/date-format-timezone` — date-format options that render a
 * calendar day name their `timeZone`.
 *
 * Every stored date is UTC (CLAUDE.md §"Date & Time"), and a date-only
 * column (`Event.date`, `Album.releaseDate`, `startDate`/`endDate`) is
 * stored as UTC midnight. Formatted without a `timeZone`, `Intl` reads
 * that instant in the process or browser zone, and anywhere west of UTC
 * the 29th renders as the 28th. Vercel and CI run in UTC, so the shift
 * never shows there — it surfaced on a member page viewed from a US-west
 * zone and in a local production build. `formatDate`'s default options
 * carry `timeZone: "UTC"`, but a caller passing its own options replaces
 * the default whole, and a raw `toLocaleDateString` never had one.
 *
 * Reported:
 *   - an object literal with a calendar-day field (`year`, `month`,
 *     `day`, `weekday`, `era`, `dateStyle`) and no `timeZone` key, when
 *     it is
 *       · declared or asserted as `Intl.DateTimeFormatOptions`
 *         (`const X: Intl.DateTimeFormatOptions = {…}`, `{…} satisfies
 *         Intl.DateTimeFormatOptions`, `{…} as Intl.DateTimeFormatOptions`),
 *       · the options argument of `formatDate(date, locale, {…})`,
 *       · the options argument of `x.toLocaleDateString(locale, {…})` or
 *         `x.toLocaleString(locale, {…})`,
 *       · the options argument of `new Intl.DateTimeFormat(locale, {…})`;
 *   - `x.toLocaleDateString()` / `x.toLocaleDateString(locale)` with no
 *     options at all — always the local zone.
 *
 * The zone itself is the caller's call: `"UTC"` for a stored date, an
 * explicit zone when the surface means one (admin timestamps pin
 * `"Asia/Seoul"`, venue times pass the venue's zone). The rule only asks
 * that the choice is written down.
 *
 * Not reported: time-only options (`hour`/`minute` with no date field —
 * `formatTime` deliberately renders in the viewer's zone); literals with
 * `timeZoneName`, whose output names the zone it was read in (a live
 * "captured at 14:02 PDT" stamp of the current moment), so a viewer-zone
 * day there is labelled rather than silently shifted; literals with
 * a spread (`{...BASE, day: "numeric"}`), which may carry the zone;
 * options passed as an identifier at the call site — the constant is
 * checked where it is declared, provided it is typed as
 * `Intl.DateTimeFormatOptions`.
 */

const DATE_FIELDS = new Set([
  "year",
  "month",
  "day",
  "weekday",
  "era",
  "dateStyle",
]);

function keyName(prop) {
  if (prop.type !== "Property" || prop.computed) return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal") return String(prop.key.value);
  return null;
}

// True when `obj` renders a calendar day and nothing pins (or may pin)
// its zone.
function lacksZone(obj) {
  if (obj?.type !== "ObjectExpression") return false;
  if (obj.properties.some((p) => p.type === "SpreadElement")) return false;
  const keys = obj.properties.map(keyName);
  if (keys.includes("timeZone") || keys.includes("timeZoneName")) {
    return false;
  }
  return keys.some((k) => k !== null && DATE_FIELDS.has(k));
}

// `Intl.DateTimeFormatOptions` as a TS type reference.
function isDateTimeFormatOptionsType(typeNode) {
  if (typeNode?.type !== "TSTypeReference") return false;
  const name = typeNode.typeName;
  return (
    name.type === "TSQualifiedName" &&
    name.left.type === "Identifier" &&
    name.left.name === "Intl" &&
    name.right.name === "DateTimeFormatOptions"
  );
}

function memberName(callee) {
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

function isIntlDateTimeFormat(callee) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Intl" &&
    callee.property.type === "Identifier" &&
    callee.property.name === "DateTimeFormat"
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an explicit timeZone in date-format options that render a calendar day",
    },
    schema: [],
    messages: {
      missingTimeZone:
        'Date-format options without `timeZone` render in the process/browser zone, so a stored UTC date (date-only columns are UTC midnight) shows the previous day west of UTC. Add `timeZone: "UTC"` for a stored date, or the zone the surface means.',
      bareToLocaleDateString:
        '`toLocaleDateString()` without options renders in the process/browser zone. Use `formatDate(date, locale)` (UTC by default) or pass options with `timeZone`.',
    },
  },
  create(context) {
    const report = (node) =>
      context.report({ node, messageId: "missingTimeZone" });

    return {
      VariableDeclarator(node) {
        if (
          isDateTimeFormatOptionsType(node.id.typeAnnotation?.typeAnnotation) &&
          lacksZone(node.init)
        ) {
          report(node.init);
        }
      },
      "TSSatisfiesExpression, TSAsExpression"(node) {
        if (
          isDateTimeFormatOptionsType(node.typeAnnotation) &&
          lacksZone(node.expression)
        ) {
          report(node.expression);
        }
      },
      CallExpression(node) {
        const { callee, arguments: args } = node;
        if (callee.type === "Identifier" && callee.name === "formatDate") {
          if (lacksZone(args[2])) report(args[2]);
          return;
        }
        const method = memberName(callee);
        if (method === "toLocaleDateString") {
          if (args.length < 2) {
            context.report({ node, messageId: "bareToLocaleDateString" });
          } else if (lacksZone(args[1])) {
            report(args[1]);
          }
          return;
        }
        if (method === "toLocaleString" && lacksZone(args[1])) {
          report(args[1]);
        }
      },
      NewExpression(node) {
        if (isIntlDateTimeFormat(node.callee) && lacksZone(node.arguments[1])) {
          report(node.arguments[1]);
        }
      },
    };
  },
};

export default rule;

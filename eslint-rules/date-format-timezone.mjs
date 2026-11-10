/**
 * `local/date-format-timezone` — date-format options that render a
 * calendar day name their `timeZone` and use compatible options.
 *
 * Every stored date is UTC (CLAUDE.md §"Date & Time"), and a date-only
 * column (`Event.date`, `Album.releaseDate`, `startDate`/`endDate`) is
 * stored as UTC midnight. Formatted without a `timeZone`, `Intl` reads
 * that instant in the process or browser zone, and anywhere west of UTC
 * the 29th renders as the 28th. Vercel and CI run in UTC, so the shift
 * never shows there — only on a viewer's machine. `formatDate`'s default options
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
 *       · the options argument of `[new] Intl.DateTimeFormat(locale, {…})`;
 *   - `x.toLocaleDateString()` and `[new] Intl.DateTimeFormat()` with no
 *     options (or a literal `undefined`) — both default to a numeric
 *     calendar day in the local zone. `Intl.DateTimeFormat()
 *     .resolvedOptions()` is exempt: it reads the zone, it formats
 *     nothing. `x.toLocaleString()` without options is left alone because
 *     the receiver is as often a number as a Date;
 *   - inline `timeStyle` passed to `formatDate` or `toLocaleDateString`.
 *     The latter rejects it at runtime, and `formatDate` delegates to it.
 *
 * The zone itself is the caller's call: `"UTC"` for a stored date, an
 * explicit zone when the surface means one (admin timestamps pin
 * `"Asia/Seoul"`, venue times pass the venue's zone).
 *
 * Time-zone check exclusions: time-only options (`hour`/`minute` with no date field —
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

// `{…} as const`, `{…} as const satisfies T`, `<T>{…}`: the literal
// under the type wrappers.
function unwrapTypeAssertions(node) {
  let n = node;
  while (
    n?.type === "TSAsExpression" ||
    n?.type === "TSSatisfiesExpression" ||
    n?.type === "TSTypeAssertion"
  ) {
    n = n.expression;
  }
  return n;
}

// True when `node` is an options literal that renders a calendar day and
// nothing pins (or may pin) its zone.
function needsExplicitZone(node) {
  const obj = unwrapTypeAssertions(node);
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

// No options argument, or a literal `undefined` in its place: Intl then
// uses its defaults, which include the local zone.
function isOmitted(arg) {
  return !arg || (arg.type === "Identifier" && arg.name === "undefined");
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
        "Check time zones and supported options in date formatting",
    },
    schema: [],
    messages: {
      missingTimeZone:
        'Date-format options without `timeZone` render in the process/browser zone, so a stored UTC date (date-only columns are UTC midnight) shows the previous day west of UTC. Add `timeZone: "UTC"` for a stored date, or the zone the surface means.',
      noOptions:
        'Date formatting without options renders a calendar day in the process/browser zone. Use `formatDate(date, locale)` (UTC by default) or pass options with `timeZone`.',
      unsupportedTimeStyle:
        "Date-only formatters reject `timeStyle`. Use explicit date and time fields such as `day` and `hour`, or use `formatTime` for time only.",
    },
  },
  create(context) {
    // One literal can match two selectors (`const F: T = {…} as T`);
    // report it once.
    const reported = new Set();
    const report = (node, messageId = "missingTimeZone") => {
      const obj = unwrapTypeAssertions(node);
      if (reported.has(obj)) return;
      reported.add(obj);
      context.report({ node: obj, messageId });
    };

    const checkDateOnlyOptions = (node) => {
      const options = unwrapTypeAssertions(node);
      if (
        options?.type === "ObjectExpression" &&
        options.properties.some((prop) => keyName(prop) === "timeStyle")
      ) {
        report(options, "unsupportedTimeStyle");
      } else if (needsExplicitZone(options)) {
        report(options);
      }
    };

    // `Intl.DateTimeFormat(...)` with or without `new`.
    const checkIntlDateTimeFormat = (node) => {
      if (!isIntlDateTimeFormat(node.callee)) return;
      const options = node.arguments[1];
      if (isOmitted(options)) {
        const parent = node.parent;
        const readsZoneOnly =
          parent?.type === "MemberExpression" &&
          parent.object === node &&
          memberName(parent) === "resolvedOptions";
        if (!readsZoneOnly) context.report({ node, messageId: "noOptions" });
      } else if (needsExplicitZone(options)) {
        report(options);
      }
    };

    return {
      VariableDeclarator(node) {
        if (
          isDateTimeFormatOptionsType(node.id.typeAnnotation?.typeAnnotation) &&
          needsExplicitZone(node.init)
        ) {
          report(node.init);
        }
      },
      "TSSatisfiesExpression, TSAsExpression, TSTypeAssertion"(node) {
        if (
          isDateTimeFormatOptionsType(node.typeAnnotation) &&
          needsExplicitZone(node.expression)
        ) {
          report(node.expression);
        }
      },
      CallExpression(node) {
        const { callee, arguments: args } = node;
        if (callee.type === "Identifier" && callee.name === "formatDate") {
          checkDateOnlyOptions(args[2]);
          return;
        }
        if (isIntlDateTimeFormat(callee)) {
          checkIntlDateTimeFormat(node);
          return;
        }
        const method = memberName(callee);
        if (method === "toLocaleDateString") {
          if (isOmitted(args[1])) {
            context.report({ node, messageId: "noOptions" });
          } else {
            checkDateOnlyOptions(args[1]);
          }
          return;
        }
        if (method === "toLocaleString" && needsExplicitZone(args[1])) {
          report(args[1]);
        }
      },
      NewExpression: checkIntlDateTimeFormat,
    };
  },
};

export default rule;

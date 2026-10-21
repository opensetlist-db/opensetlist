/**
 * `local/non-literal-regexp` — `new RegExp(…)` / `RegExp(…)` takes a
 * literal pattern.
 *
 * A pattern built from a value can be steered by that value: a crafted
 * string turns into a catastrophic-backtracking regex (ReDoS) or matches
 * things the code never meant to match. CI Semgrep
 * (`javascript.lang.security.audit.detect-non-literal-regexp`, part of
 * `p/default`) blocks the pattern, but Semgrep does not run locally and
 * the review hooks let it through — this rule catches it at lint time.
 *
 * Allowed first arguments: a string literal, a regex literal, and a
 * template literal without `${…}` (just a string). Anything else is
 * flagged — a variable, a call, a concatenation, a template with
 * expressions — even when the value is escaped first: the rule cannot
 * see that, and neither can Semgrep. The fixes, in order of preference:
 *
 *   - no regex at all: `includes` / `startsWith` / `endsWith` / `split`
 *     / `indexOf` cover most "find this name" cases;
 *   - a regex literal (`/\bfault=\w+\b/`) and compare the capture;
 *   - a pattern escaped by a vetted helper, with a comment saying why it
 *     is safe, a `// nosemgrep: <rule id>` line right above the call so
 *     CI agrees, and `// eslint-disable-line local/non-literal-regexp --
 *     <reason>` at the end of the call's line (a disable-next-line would
 *     land on the nosemgrep line). See applyGlossary in src/lib/glossary.ts.
 *
 * A custom rule rather than a `no-restricted-syntax` entry, for the same
 * reason as console-format-string: flat config gives a rule one severity
 * per file, and the hex-colour entries run `no-restricted-syntax` at
 * "warn" over components and tests, while Semgrep fails the build.
 */

function isLiteralPattern(arg) {
  if (arg.type === "Literal") {
    return typeof arg.value === "string" || arg.regex !== undefined;
  }
  return arg.type === "TemplateLiteral" && arg.expressions.length === 0;
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a non-literal pattern in new RegExp(…) / RegExp(…)",
    },
    schema: [],
    messages: {
      nonLiteral:
        "RegExp built from a non-literal pattern. Use string APIs (includes / startsWith / split) or a regex literal instead; if the pattern must be dynamic, escape it with a vetted helper and add an eslint-disable + nosemgrep comment saying why it is safe. CI Semgrep (detect-non-literal-regexp) blocks this form.",
    },
  },
  create(context) {
    function check(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "RegExp") {
        return;
      }
      const first = node.arguments[0];
      // `new RegExp()` is an empty pattern — nothing to steer.
      if (!first || isLiteralPattern(first)) return;
      context.report({ node: first, messageId: "nonLiteral" });
    }
    return { NewExpression: check, CallExpression: check };
  },
};

export default rule;

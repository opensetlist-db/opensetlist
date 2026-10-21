/**
 * `local/console-format-string` — the first argument of a console call is
 * not a template literal with `${…}` in it.
 *
 * Node's console methods treat the first argument as a printf-style
 * format string (`%s`, `%d`, `%o`, …). When it is built from a value, a
 * `%` inside that value consumes or rewrites the arguments that follow,
 * so the log line no longer says what the code meant. CI Semgrep
 * (`javascript.lang.security.audit.unsafe-formatstring`, part of
 * `p/default`) blocks the pattern, but Semgrep does not run locally and
 * the review hooks let it through — this rule catches it at lint time.
 *
 * The fix keeps the format constant and passes the value as an argument:
 *
 *   console.warn(`[image-upload] ${event}`, fields)   // flagged
 *   console.warn("[image-upload] %s", event, fields)  // fine
 *
 * A template literal without expressions is just a string and stays
 * allowed, as does a template literal in any later argument. Semgrep's
 * rule also matches a `+` concatenation (`"[tag] " + event`); this rule
 * does not yet, because src/ still holds a few dozen structured log
 * lines built that way, whose shapes tests and log tooling parse.
 *
 * A custom rule rather than a `no-restricted-syntax` entry: flat config
 * gives a rule one severity per file, and the hex-colour entries already
 * run `no-restricted-syntax` at "warn" over components and tests — an
 * entry merged into those blocks would only warn there, while Semgrep
 * fails the build.
 */

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a template literal with expressions as the format string (first argument) of a console call",
    },
    schema: [],
    messages: {
      formatString:
        'console.{{method}}: the first argument is a format string — keep it constant and pass values as arguments, e.g. console.{{method}}("[tag] %s", value). CI Semgrep (unsafe-formatstring) blocks the template-literal form.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.object.name !== "console"
        ) {
          return;
        }
        const first = node.arguments[0];
        if (first?.type !== "TemplateLiteral" || first.expressions.length === 0) {
          return;
        }
        // `console.warn` and `console["warn"]` alike; any other computed
        // key has no name to show.
        const prop = callee.property;
        const method =
          !callee.computed && prop.type === "Identifier"
            ? prop.name
            : prop.type === "Literal" && typeof prop.value === "string"
              ? prop.value
              : "log";
        context.report({ node: first, messageId: "formatString", data: { method } });
      },
    };
  },
};

export default rule;

/**
 * `local/no-redundant-logical` — a logical expression that one of its
 * own operands absorbs. By the absorption laws `X || (X && Y)` and
 * `X && (X || Y)` both equal X (in truthiness), so Y never changes the
 * outcome. Precedence makes the unparenthesised forms read like a real
 * condition: `X && Y || X` passes whenever X does, whatever Y says.
 *
 * Aimed at browser-QA scenario checks (`h.check(label, cond)`), where
 * such a condition passes vacuously and reads like a real assertion —
 * `chips[0] && rest.every(off) || chips[0]` stays green with the rest
 * check failing. A vacuous condition is mechanical, so it is a lint
 * error rather than a review item.
 *
 * Same-operator chains are flattened first, so `a && b && c || a` and
 * `a || b || (c && a)` are caught too, in any operand order. Operands
 * compare by token text: whitespace and comments do not hide a repeat,
 * while `a.b` and `a?.b` stay different. Spellings that differ in
 * tokens (`'x'` vs `"x"`, `(a).b` vs `a.b`) are not matched.
 *
 * A repeated call (`f() && y || f()`) is reported too, though the two
 * calls could in principle return different values: in a QA check that
 * is still a condition that does not test what it reads as.
 */

/** @param {import("eslint").SourceCode} sourceCode */
function tokenText(sourceCode, node) {
  return sourceCode
    .getTokens(node)
    .map((t) => t.value)
    .join(" ");
}

/** The operands of a chain of one operator: `a && b && c` → [a, b, c]. */
function flatten(node, operator) {
  if (node.type === "LogicalExpression" && node.operator === operator) {
    return [...flatten(node.left, operator), ...flatten(node.right, operator)];
  }
  return [node];
}

// The operator that, nested under the key, makes absorption possible.
const DUAL_OPERATOR = { "||": "&&", "&&": "||" };

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow logical expressions absorbed by a repeated operand (X && Y || X)",
    },
    schema: [],
    messages: {
      redundant:
        "'{{whole}}' is decided by '{{operand}}' alone: it repeats inside the other operand, so the remaining conditions never change the result.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      LogicalExpression(node) {
        const dual = DUAL_OPERATOR[node.operator];
        if (!dual) return; // `??` has no absorption law
        // Inspect each chain once, from its outermost node.
        const parent = node.parent;
        if (
          parent.type === "LogicalExpression" &&
          parent.operator === node.operator
        ) {
          return;
        }
        const terms = flatten(node, node.operator);
        for (const compound of terms) {
          if (
            compound.type !== "LogicalExpression" ||
            compound.operator !== dual
          ) {
            continue;
          }
          const inner = new Set(
            flatten(compound, dual).map((n) => tokenText(sourceCode, n)),
          );
          const single = terms.find(
            (t) => t !== compound && inner.has(tokenText(sourceCode, t)),
          );
          if (single) {
            context.report({
              node,
              messageId: "redundant",
              data: {
                whole: sourceCode.getText(node),
                operand: sourceCode.getText(single),
              },
            });
            return;
          }
        }
      },
    };
  },
};

export default rule;

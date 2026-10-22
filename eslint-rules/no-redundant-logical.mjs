/**
 * `local/no-redundant-logical` — a logical expression that one of its
 * own operands absorbs. By the absorption laws `X || (X && Y)` and
 * `X && (X || Y)` both equal X (in truthiness), so Y never changes the
 * outcome. Precedence makes the unparenthesised forms read like a real
 * condition: `X && Y || X` passes whenever X does, whatever Y says.
 *
 * Aimed at browser-QA scenario checks (`h.check(label, cond)`), where
 * such a condition silently passes: a page-qa assertion of the form
 * `chips[0] && rest.every(off) || chips[0]` stayed green with the rest
 * check failing, and two local reviewers read past it. A vacuous
 * condition is mechanical, so it is a lint error rather than a review
 * item.
 *
 * Operands are compared by token text, so formatting and parentheses
 * do not hide a repeat, while `a.b` and `a?.b` stay different. Every
 * order of the inner operands is covered (`Y && X || X` absorbs too).
 */

/** @param {import("eslint").SourceCode} sourceCode */
function tokenText(sourceCode, node) {
  return sourceCode
    .getTokens(node)
    .map((t) => t.value)
    .join(" ");
}

const INNER = { "||": "&&", "&&": "||" };

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
        "'{{whole}}' always equals '{{operand}}': the repeated operand absorbs the rest, so the other condition never changes the result.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      LogicalExpression(node) {
        const inner = INNER[node.operator];
        if (!inner) return; // `??` has no absorption law
        // One side is the inner operator, the other side the candidate
        // X that must reappear as one of the inner operands.
        for (const [compound, single] of [
          [node.left, node.right],
          [node.right, node.left],
        ]) {
          if (
            compound.type !== "LogicalExpression" ||
            compound.operator !== inner
          ) {
            continue;
          }
          const x = tokenText(sourceCode, single);
          if (
            tokenText(sourceCode, compound.left) === x ||
            tokenText(sourceCode, compound.right) === x
          ) {
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

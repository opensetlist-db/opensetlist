/**
 * `local/no-ticket-ids` — comments carry the reason, not the ticket that
 * introduced it. A ticket id (`n15-03`, `n15-09b`) rots once the ticket
 * closes and belongs in the PR description; CLAUDE.md ("Code Comments")
 * says so, but the commit-time review let ids through repeatedly, so it
 * is a lint error now.
 *
 * The feature tag alone (`n15`) is allowed: it names a lasting area of
 * the product, not a unit of work. Only comments are checked — strings
 * and identifiers are code, not prose.
 */

const TICKET_ID = /\bn\d{2}-\d{2}[a-z]?\b/gi;

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Disallow ticket ids (e.g. n15-03) in comments",
    },
    schema: [],
    messages: {
      ticketId:
        "Ticket id '{{id}}' in a comment — keep the reason, drop the ticket (it belongs in the PR description). A feature tag like 'n15' is fine.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          // `comment.range[0]` is the start of the delimiter (`//` or
          // `/*`); the value starts two characters later.
          const valueStart = comment.range[0] + 2;
          for (const m of comment.value.matchAll(TICKET_ID)) {
            const start = valueStart + m.index;
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(start),
                end: sourceCode.getLocFromIndex(start + m[0].length),
              },
              messageId: "ticketId",
              data: { id: m[0] },
            });
          }
        }
      },
    };
  },
};

export default rule;

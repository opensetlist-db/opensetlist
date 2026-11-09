#!/usr/bin/env bash
# `prisma db push` for the migrate workflows (migrate-dev.yml,
# migrate-prod.yml), against $DATABASE_URL.
#
#   scripts/schema-push.sh <accept_data_loss: true|false>
#
#   true  → the operator chose `--accept-data-loss` on manual dispatch.
#   false → diff the database against the schema first.
#           1. A diff that DROPs a column, a table, or an index of a table
#              that stays (scripts/schema-diff-additive.mjs --drops) stops
#              the job with exit 1. `db push` itself warns only when the
#              dropped object holds rows, so an EMPTY column — a feature
#              branch's column on the dev DB before that branch merges —
#              used to vanish silently when another PR's push ran first.
#           2. When the generated SQL is additive only the push runs with
#              `--accept-data-loss`, because Prisma flags every new unique
#              constraint as possible data loss even on a brand-new
#              all-NULL column (v0.20: the dev push failed on exactly
#              that). Anything else gets the plain push, which stops on a
#              real data-loss warning as before.
set -euo pipefail

if [ "${1:-false}" = "true" ]; then
  echo "Running with --accept-data-loss (manual dispatch)"
  npx prisma db push --accept-data-loss
  exit 0
fi

diff_file="$(mktemp)"
trap 'rm -f "$diff_file"' EXIT
npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --script --output "$diff_file"
echo "── pending schema diff ──"
cat "$diff_file"
echo "─────────────────────────"

# Exit 4 = drops found; any other non-zero is the checker failing, which
# must stop the push too but not be reported as a drop.
drops_status=0
node scripts/schema-diff-additive.mjs --drops "$diff_file" || drops_status=$?
if [ "$drops_status" -eq 4 ]; then
  echo "::error::Refusing to push: the schema diff drops the statements above."
  echo "Hint: a branch-only column from an unmerged PR? re-run migrate-dev --ref <that branch> after this; or dispatch with accept_data_loss=true"
  exit 1
elif [ "$drops_status" -ne 0 ]; then
  echo "::error::The drop check failed (exit $drops_status); not pushing."
  exit "$drops_status"
fi

if node scripts/schema-diff-additive.mjs "$diff_file"; then
  echo "Additive only → db push --accept-data-loss"
  npx prisma db push --accept-data-loss
else
  echo "Not additive only → plain db push (stops on a data-loss warning)"
  npx prisma db push
fi

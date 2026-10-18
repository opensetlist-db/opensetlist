#!/usr/bin/env bash
# `prisma db push` for the migrate workflows (migrate-dev.yml,
# migrate-prod.yml), against $DATABASE_URL.
#
#   scripts/schema-push.sh <accept_data_loss: true|false>
#
#   true  → the operator chose `--accept-data-loss` on manual dispatch.
#   false → diff the database against the schema first. When the
#           generated SQL is additive only (scripts/schema-diff-additive.mjs)
#           the push runs with `--accept-data-loss`, because Prisma flags
#           every new unique constraint as possible data loss even on a
#           brand-new all-NULL column (v0.20 / n15-08: the dev push failed
#           on exactly that). Anything else gets the plain push, which
#           stops on a real data-loss warning as before.
set -euo pipefail

if [ "${1:-false}" = "true" ]; then
  echo "Running with --accept-data-loss (manual dispatch)"
  npx prisma db push --accept-data-loss
  exit 0
fi

diff_file="$(mktemp)"
npx prisma migrate diff --from-config-datasource \
  --to-schema prisma/schema.prisma --script --output "$diff_file"
echo "── pending schema diff ──"
cat "$diff_file"
echo "─────────────────────────"

if node scripts/schema-diff-additive.mjs "$diff_file"; then
  echo "Additive only → db push --accept-data-loss"
  npx prisma db push --accept-data-loss
else
  echo "Not additive only → plain db push (stops on a data-loss warning)"
  npx prisma db push
fi

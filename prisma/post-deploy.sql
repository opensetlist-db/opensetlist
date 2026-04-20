-- Post-deploy SQL — run AFTER `prisma db push` against any database.
-- All statements are idempotent (IF NOT EXISTS) so re-running is safe.
--
-- Apply: `npx prisma db execute --file prisma/post-deploy.sql`
--
-- Why this file exists: Prisma's schema language can't declare partial
-- indexes (CREATE INDEX ... WHERE ...). Anything below is invariant
-- enforcement that has to live in SQL, not in schema.prisma.

-- Enforce one current row per impression chain.
-- The PUT /api/impressions/[chainId] supersede flow already prevents
-- this at the application layer via `updateMany ... WHERE supersededAt IS NULL`
-- + count-check, but a partial unique index makes the invariant a hard
-- DB-level guarantee: future code paths, admin scripts, or a regression
-- in the supersede transaction can't accidentally produce two head rows.
CREATE UNIQUE INDEX IF NOT EXISTS event_impression_chain_head_unique
  ON "EventImpression" ("rootImpressionId")
  WHERE "supersededAt" IS NULL;

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

-- ─────────────────────────────────────────────────────────────────────
-- original* / originalLanguage backfill for translation-backed entities.
--
-- Every UPDATE below is guarded by `"originalName" IS NULL` (or, for Album,
-- `"originalLanguage" = 'jp'`) so re-running this file after an admin has
-- hand-edited a record will not stomp their value. The orphan guard at the
-- bottom is informational only — it raises a WARNING, never an error, so a
-- tag-push deploy still completes.

-- One-time normalization of legacy "jp" values on Album (CSV imports used
-- "jp" while AlbumTranslation rows use the canonical "ja"; without this
-- patch, strict-locale lookup misses the translation row).
UPDATE "Album"
  SET "originalLanguage" = 'ja'
  WHERE "originalLanguage" = 'jp';

UPDATE "Artist" a SET
  "originalName"      = t.name,
  "originalShortName" = t."shortName",
  "originalBio"       = t.bio
FROM "ArtistTranslation" t
WHERE t."artistId" = a.id
  AND t.locale = a."originalLanguage"
  AND a."originalName" IS NULL;

UPDATE "Group" g SET
  "originalName"        = t.name,
  "originalShortName"   = t."shortName",
  "originalDescription" = t.description
FROM "GroupTranslation" t
WHERE t."groupId" = g.id
  AND t.locale = g."originalLanguage"
  AND g."originalName" IS NULL;

UPDATE "EventSeries" es SET
  "originalName"        = t.name,
  "originalShortName"   = t."shortName",
  "originalDescription" = t.description
FROM "EventSeriesTranslation" t
WHERE t."eventSeriesId" = es.id
  AND t.locale = es."originalLanguage"
  AND es."originalName" IS NULL;

UPDATE "Event" e SET
  "originalName"      = t.name,
  "originalShortName" = t."shortName",
  "originalCity"      = t.city,
  "originalVenue"     = t.venue
FROM "EventTranslation" t
WHERE t."eventId" = e.id
  AND t.locale = e."originalLanguage"
  AND e."originalName" IS NULL;

UPDATE "StageIdentity" si SET
  "originalName"      = t.name,
  "originalShortName" = t."shortName"
FROM "StageIdentityTranslation" t
WHERE t."stageIdentityId" = si.id
  AND t.locale = si."originalLanguage"
  AND si."originalName" IS NULL;

UPDATE "RealPerson" rp SET
  "originalName"      = t.name,
  "originalStageName" = t."stageName"
FROM "RealPersonTranslation" t
WHERE t."realPersonId" = rp.id
  AND t.locale = rp."originalLanguage"
  AND rp."originalName" IS NULL;

-- Orphan guard — warn (don't fail) if any parent row is still missing its
-- originalName after backfill. PR B's NOT NULL tightening must wait until
-- this count is zero on prod.
DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT SUM(cnt) INTO orphan_count FROM (
              SELECT COUNT(*) AS cnt FROM "Artist"        WHERE "originalName" IS NULL
    UNION ALL SELECT COUNT(*)        FROM "Group"         WHERE "originalName" IS NULL
    UNION ALL SELECT COUNT(*)        FROM "EventSeries"   WHERE "originalName" IS NULL
    UNION ALL SELECT COUNT(*)        FROM "Event"         WHERE "originalName" IS NULL
    UNION ALL SELECT COUNT(*)        FROM "StageIdentity" WHERE "originalName" IS NULL
    UNION ALL SELECT COUNT(*)        FROM "RealPerson"    WHERE "originalName" IS NULL
  ) s;
  IF orphan_count > 0 THEN
    RAISE WARNING 'original* backfill left % parent rows without originalName — PR B NOT NULL tightening must wait', orphan_count;
  END IF;
END $$;

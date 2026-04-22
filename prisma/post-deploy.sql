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
-- COALESCE keeps any admin-edited values intact while still filling auxiliary
-- columns that are independently NULL — a row whose `originalName` was hand-set
-- but whose `originalShortName`/`originalCity`/etc are still empty will get
-- those columns backfilled on re-run. The broad `WHERE ... IS NULL OR ... IS
-- NULL` predicate ensures we don't pull rows that have nothing left to fill.
-- The orphan guard at the bottom is informational only — it raises a WARNING,
-- never an error, so a tag-push deploy still completes.

-- One-time normalization of legacy "jp" values on Album (CSV imports used
-- "jp" while AlbumTranslation rows use the canonical "ja"; without this
-- patch, strict-locale lookup misses the translation row).
UPDATE "Album"
  SET "originalLanguage" = 'ja'
  WHERE "originalLanguage" = 'jp';

UPDATE "Album" a SET
  "originalTitle" = COALESCE(a."originalTitle", t.title)
FROM "AlbumTranslation" t
WHERE t."albumId" = a.id
  AND t.locale = a."originalLanguage"
  AND a."originalTitle" IS NULL;

UPDATE "Artist" a SET
  "originalName"      = COALESCE(a."originalName",      t.name),
  "originalShortName" = COALESCE(a."originalShortName", t."shortName"),
  "originalBio"       = COALESCE(a."originalBio",       t.bio)
FROM "ArtistTranslation" t
WHERE t."artistId" = a.id
  AND t.locale = a."originalLanguage"
  AND (
    a."originalName" IS NULL OR
    a."originalShortName" IS NULL OR
    a."originalBio" IS NULL
  );

UPDATE "Group" g SET
  "originalName"        = COALESCE(g."originalName",        t.name),
  "originalShortName"   = COALESCE(g."originalShortName",   t."shortName"),
  "originalDescription" = COALESCE(g."originalDescription", t.description)
FROM "GroupTranslation" t
WHERE t."groupId" = g.id
  AND t.locale = g."originalLanguage"
  AND (
    g."originalName" IS NULL OR
    g."originalShortName" IS NULL OR
    g."originalDescription" IS NULL
  );

UPDATE "EventSeries" es SET
  "originalName"        = COALESCE(es."originalName",        t.name),
  "originalShortName"   = COALESCE(es."originalShortName",   t."shortName"),
  "originalDescription" = COALESCE(es."originalDescription", t.description)
FROM "EventSeriesTranslation" t
WHERE t."eventSeriesId" = es.id
  AND t.locale = es."originalLanguage"
  AND (
    es."originalName" IS NULL OR
    es."originalShortName" IS NULL OR
    es."originalDescription" IS NULL
  );

UPDATE "Event" e SET
  "originalName"      = COALESCE(e."originalName",      t.name),
  "originalShortName" = COALESCE(e."originalShortName", t."shortName"),
  "originalCity"      = COALESCE(e."originalCity",      t.city),
  "originalVenue"     = COALESCE(e."originalVenue",     t.venue)
FROM "EventTranslation" t
WHERE t."eventId" = e.id
  AND t.locale = e."originalLanguage"
  AND (
    e."originalName" IS NULL OR
    e."originalShortName" IS NULL OR
    e."originalCity" IS NULL OR
    e."originalVenue" IS NULL
  );

UPDATE "StageIdentity" si SET
  "originalName"      = COALESCE(si."originalName",      t.name),
  "originalShortName" = COALESCE(si."originalShortName", t."shortName")
FROM "StageIdentityTranslation" t
WHERE t."stageIdentityId" = si.id
  AND t.locale = si."originalLanguage"
  AND (
    si."originalName" IS NULL OR
    si."originalShortName" IS NULL
  );

UPDATE "RealPerson" rp SET
  "originalName"      = COALESCE(rp."originalName",      t.name),
  "originalShortName" = COALESCE(rp."originalShortName", t."shortName"),
  "originalStageName" = COALESCE(rp."originalStageName", t."stageName")
FROM "RealPersonTranslation" t
WHERE t."realPersonId" = rp.id
  AND t.locale = rp."originalLanguage"
  AND (
    rp."originalName" IS NULL OR
    rp."originalShortName" IS NULL OR
    rp."originalStageName" IS NULL
  );

-- Orphan guard — warn (don't fail) if any parent row is still missing its
-- identity original* column (Album uses originalTitle; everyone else uses
-- originalName). Any future NOT NULL tightening must wait until this is zero.
DO $$
DECLARE
  orphan_count BIGINT;
BEGIN
  SELECT SUM(cnt) INTO orphan_count FROM (
              SELECT COUNT(*) AS cnt FROM "Artist"        WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "Group"         WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "EventSeries"   WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "Event"         WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "StageIdentity" WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "RealPerson"    WHERE "originalName"  IS NULL
    UNION ALL SELECT COUNT(*)        FROM "Album"         WHERE "originalTitle" IS NULL
  ) s;
  IF orphan_count > 0 THEN
    RAISE WARNING 'original* backfill left % parent rows with NULL identity — NOT NULL tightening must wait until orphan count is zero', orphan_count;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Per-browser anon-id dedup for contribution tables.
-- The partial WHERE clauses skip legacy NULL rows (anyone created before
-- this column existed) so the new index doesn't retroactively block them.

-- Per-browser reaction idempotency: at most one row per
-- (setlistItemId, reactionType, anonId) when anonId is set. The reactions
-- POST handler catches the resulting P2002 and re-selects the existing row.
CREATE UNIQUE INDEX IF NOT EXISTS setlist_item_reaction_anon_unique
  ON "SetlistItemReaction" ("setlistItemId", "reactionType", "anonId")
  WHERE "anonId" IS NOT NULL;

-- Per-browser impression chain ownership: at most one HEAD row per
-- (rootImpressionId, anonId). The `supersededAt IS NULL` clause is
-- load-bearing — without it, the PUT supersede+create transaction would
-- fail P2002 because the old row (now superseded but still anon-keyed)
-- collides with the new head row. With the clause, only head rows are
-- indexed, so historical chain rows can repeat (rootImpressionId, anonId)
-- safely. DROP+CREATE ensures the predicate update lands on environments
-- that may have already created an earlier version of this index.
DROP INDEX IF EXISTS event_impression_anon_unique;
CREATE UNIQUE INDEX IF NOT EXISTS event_impression_anon_unique
  ON "EventImpression" ("rootImpressionId", "anonId")
  WHERE "anonId" IS NOT NULL AND "supersededAt" IS NULL;

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

-- ─────────────────────────────────────────────────────────────────────
-- SetlistItem position uniqueness, soft-delete aware (F3 from 5/2 rehearsal).
-- The schema previously had @@unique([eventId, position]) which Prisma
-- compiled to a non-partial unique index. Soft-deleted rows then held
-- their position slot forever, so any insert at a previously-used slot
-- failed P2002 with no recovery path in the admin UI. Switching to a
-- partial unique lets a fresh active row coexist with a soft-deleted
-- row at the same position. `prisma db push` normally drops the legacy
-- "SetlistItem_eventId_position_key" once the @@unique leaves the schema,
-- but we DROP defensively so re-running post-deploy in any order (or on
-- a DB that briefly holds both indexes) converges to the right state.
DROP INDEX IF EXISTS "SetlistItem_eventId_position_key";
CREATE UNIQUE INDEX IF NOT EXISTS setlist_item_event_position_active_unique
  ON "SetlistItem" ("eventId", "position")
  WHERE "isDeleted" = false;

-- ─────────────────────────────────────────────────────────────────────
-- Supabase Realtime publication — Phase 1C R1 (SetlistItem only).
--
-- The Supabase project's `supabase_realtime` publication selects which
-- tables emit logical-replication events to subscribed clients. R1
-- adds SetlistItem so the live event page's `useRealtimeEventChannel`
-- hook receives INSERT/UPDATE/DELETE pushes filtered by `eventId`.
--
-- Idempotency: pg_publication_tables guards against re-adding (the
-- raw `ALTER PUBLICATION ... ADD TABLE` errors if the table is
-- already a member). Both `migrate-dev.yml` and `migrate-prod.yml`
-- replay this file on every deploy, so the guard must hold.
--
-- R2 will extend the publication to SetlistItemReaction +
-- EventImpression + SongWish; SetlistItemConfirm is added when
-- `LAUNCH_FLAGS.confirmDbEnabled` flips on at 5/30. Each addition
-- gets its own DO block here so failed/partial deploys converge
-- cleanly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'SetlistItem'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "SetlistItem"';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Realtime R2: SetlistItemReaction.eventId backfill.
--
-- The R2 schema change added `eventId BigInt?` to SetlistItemReaction
-- (denormalized from SetlistItem.eventId). This backfill fills the
-- column for any pre-R2 rows. Idempotent — the WHERE clause skips
-- already-populated rows on re-run.
--
-- The application-side write path (POST /api/reactions) populates
-- eventId on every new INSERT, so once this runs once and the
-- workflow deploys the new app code, the column converges to
-- always-populated. A follow-up migration after that point can
-- tighten this to NOT NULL safely.
UPDATE "SetlistItemReaction" r
   SET "eventId" = i."eventId"
  FROM "SetlistItem" i
 WHERE r."setlistItemId" = i.id
   AND r."eventId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- Realtime R2: extend supabase_realtime publication.
--
-- Adds the three remaining R2 tables (SetlistItemReaction,
-- EventImpression, SongWish) to the publication. Each table gets its
-- own DO block so a partial-failure deploy converges cleanly: if
-- SetlistItemReaction succeeds and the deploy crashes before
-- EventImpression, the next replay skips SetlistItemReaction (already
-- in the publication) and adds EventImpression.
--
-- SetlistItemConfirm is intentionally NOT added here — it lands when
-- LAUNCH_FLAGS.confirmDbEnabled flips on at 5/30, alongside its own
-- eventId denormalization.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'SetlistItemReaction'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "SetlistItemReaction"';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'EventImpression'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "EventImpression"';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'SongWish'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE "SongWish"';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- Realtime R2: REPLICA IDENTITY FULL for diff-merge tables.
--
-- Postgres logical replication ships only the primary key in DELETE
-- WAL events by default. Supabase Realtime exposes that as
-- `payload.old = { id }` — which is enough for SetlistItem (Path B
-- refetch on push) and SongWish (Path B refetch top3) but NOT for
-- the per-row diff merge (Path A) the realtime hook does for
-- SetlistItemReaction and EventImpression:
--
--   - SetlistItemReaction DELETE → need (setlistItemId, reactionType)
--     to decrement the right reactionCounts cell. Without FULL we
--     only get the row's UUID.
--   - EventImpression UPDATE (supersede) → need (rootImpressionId,
--     supersededAt, isHidden, isDeleted) on the OLD row to know
--     whether the row was previously visible. INSERT carries `new`
--     fully regardless; the gap is only on UPDATE/DELETE.
--
-- REPLICA IDENTITY FULL widens those payloads to the full row at
-- the cost of extra WAL bytes per change. Trivial at our table
-- sizes (reactions ≤ ~10⁵ rows/year, impressions ≤ ~10⁴) and the
-- bytes only ship for changes, not on idle.
--
-- These are idempotent: ALTER TABLE ... REPLICA IDENTITY FULL is
-- safe to re-run, no IF NOT EXISTS guard needed.
ALTER TABLE "SetlistItemReaction" REPLICA IDENTITY FULL;
ALTER TABLE "EventImpression" REPLICA IDENTITY FULL;

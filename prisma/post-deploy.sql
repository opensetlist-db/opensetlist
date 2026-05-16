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
--
-- Conflict-handling extension (Phase 1C, 2026-05-14): the partial is
-- further narrowed to apply only to `status != 'rumoured'` rows.
-- Multiple `rumoured` rows at the same (eventId, position) are now
-- permitted — that's the conflict-sibling representation. Rule:
--   * confirmed/live (status != 'rumoured') → uniquely position-
--     constrained (operator/promoted rows own their slot)
--   * rumoured → unconstrained on position (siblings allowed; the
--     vote-driven promotion in /api/setlist-items/[id]/confirm
--     auto-hides losers when a winner crosses
--     CONFLICT_CONFIRMATION_THRESHOLD)
--
-- The old `setlist_item_event_position_active_unique` is dropped
-- explicitly and replaced with a new name (`_finalized_unique`) so
-- subsequent post-deploy runs are idempotent — DROP IF EXISTS on the
-- old name becomes a no-op once it's gone, and CREATE IF NOT EXISTS
-- on the new name becomes a no-op once it's present.
DROP INDEX IF EXISTS "SetlistItem_eventId_position_key";
DROP INDEX IF EXISTS setlist_item_event_position_active_unique;
CREATE UNIQUE INDEX IF NOT EXISTS setlist_item_event_position_finalized_unique
  ON "SetlistItem" ("eventId", "position")
  WHERE "isDeleted" = false AND "status" != 'rumoured';

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
-- Realtime R2: REPLICA IDENTITY FULL for every published table.
--
-- The original assumption here was "only diff-merge tables (Path A)
-- need FULL; refetch-on-push tables (Path B) can stay at DEFAULT
-- because the handler doesn't read the WAL payload." That was
-- wrong, and the SongWish realtime outage on 2026-05-16 was the
-- forcing function.
--
-- Two distinct reasons every published table needs FULL:
--
--   1. Path A diff-merge needs the full OLD row to decrement the
--      right cell on DELETE / detect supersede on UPDATE.
--        - SetlistItemReaction DELETE → need
--          (setlistItemId, reactionType) to decrement reactionCounts.
--        - EventImpression UPDATE (supersede) → need
--          (rootImpressionId, supersededAt, isHidden, isDeleted) on
--          OLD to know whether the row was previously visible.
--
--   2. Supabase Realtime's `realtime.check_filters` function
--      validates filtered subscriptions at subscribe-time against
--      a per-table cache of "filterable columns." On the prod
--      Supabase project, that cache only marks a column as
--      filterable when REPLICA IDENTITY FULL is set on the table —
--      even for filters used only on INSERT events (where the
--      `new` payload would carry the column anyway). A subscription
--      with a filter on a non-FULL-covered column is rejected with
--        P0001 "invalid column for filter <col>"
--      and the channel never reaches SUBSCRIBED.
--
--      SongWish + SetlistItem were left at REPLICA IDENTITY DEFAULT
--      under the (wrong) Path B assumption, so prod subscriptions
--      using filter `eventId=eq.X` on those tables were silently
--      rejected. Dev had REPLICA IDENTITY FULL on those tables from
--      ad-hoc manual SQL during R1/R2 dev work, masking the issue
--      until prod traffic exposed it.
--
-- Resolution at the SQL layer: set REPLICA IDENTITY FULL on every
-- table in `supabase_realtime`. Idempotent (re-runs no-op), and the
-- WAL overhead is trivial at our table sizes (≤ ~10⁵ rows/year).
--
-- Resolution at the code layer (see
-- src/hooks/useRealtimeEventChannel.ts:417-446, 470-499): drop the
-- per-event `filter:` from the SongWish + SetlistItem subscriptions
-- — both are Path B refetch consumers that don't need the filter to
-- be correct, only to be efficient. Even with FULL applied here,
-- the Realtime service's filter-validation cache had additional
-- state that resisted refresh (publication kick + project restart
-- did not clear it). Removing the filter sidesteps that
-- still-mysterious cache entirely; we re-add the filter once
-- traffic grows enough that the wasted refetches matter AND we've
-- verified Supabase Realtime accepts it again (test by re-adding
-- on a Preview deploy and watching WS frames).
ALTER TABLE "SetlistItem" REPLICA IDENTITY FULL;
ALTER TABLE "SetlistItemReaction" REPLICA IDENTITY FULL;
ALTER TABLE "EventImpression" REPLICA IDENTITY FULL;
ALTER TABLE "SongWish" REPLICA IDENTITY FULL;

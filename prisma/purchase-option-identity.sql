-- Replace edition uniqueness with choice uniqueness without changing any
-- listing, bonus, URL or foreign key. Create both replacements before
-- dropping the old restrictions so the legacy importer keeps its identity.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public."AlbumStoreListing"
  ADD COLUMN IF NOT EXISTS "optionKey" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "storeKey" TEXT,
  ADD COLUMN IF NOT EXISTS "officialOrder" INTEGER,
  ADD COLUMN IF NOT EXISTS "selectionGuide" TEXT,
  ADD COLUMN IF NOT EXISTS "includesPerformanceVideo" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "isBonusOption" BOOLEAN;

ALTER TABLE public."AlbumStoreBonus"
  ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "AlbumStoreListing_option_key"
  ON public."AlbumStoreListing" ("albumId", "originalStoreName", "originalEditionLabel", "optionKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AlbumStoreListing_null_edition_option_key"
  ON public."AlbumStoreListing" ("albumId", "originalStoreName", "optionKey")
  WHERE "originalEditionLabel" IS NULL;

DROP INDEX IF EXISTS public."AlbumStoreListing_albumId_originalStoreName_originalEdition_key";
DROP INDEX IF EXISTS public."AlbumStoreListing_album_store_null_edition_key";

COMMIT;

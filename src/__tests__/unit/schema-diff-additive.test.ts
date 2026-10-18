// The migrate workflows pass `--accept-data-loss` only when this says the
// generated SQL is additive. A false "additive" would let a destructive
// change through unattended, so the destructive cases are the ones
// pinned hardest here.
import { describe, it, expect } from "vitest";
import { classifySchemaDiff } from "../../../scripts/schema-diff-additive.mjs";

// The real n15-08 diff (`prisma migrate diff --script`), which `db push`
// refused as "data loss" over the new unique index.
const N15_08 = `-- AlterTable
ALTER TABLE "SongWish" ADD COLUMN     "anonId" VARCHAR(64),
ADD COLUMN     "groupArtistId" BIGINT;

-- CreateIndex
CREATE INDEX "SongWish_eventId_anonId_idx" ON "SongWish"("eventId", "anonId");

-- CreateIndex
CREATE UNIQUE INDEX "SongWish_eventId_anonId_songId_key" ON "SongWish"("eventId", "anonId", "songId");

-- AddForeignKey
ALTER TABLE "SongWish" ADD CONSTRAINT "SongWish_groupArtistId_fkey" FOREIGN KEY ("groupArtistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
`;

describe("classifySchemaDiff", () => {
  it("n15-08: new nullable columns + index + unique index + FK → additive", () => {
    expect(classifySchemaDiff(N15_08)).toEqual({ additive: true, offending: null });
  });

  it("empty migration → additive (nothing to do)", () => {
    expect(classifySchemaDiff("-- This is an empty migration.\n").additive).toBe(true);
  });

  it("a new GIN index (`USING gin`) → additive", () => {
    const sql = `CREATE INDEX "Comment_rollupSongIds_idx" ON "Comment" USING GIN ("rollupSongIds");`;
    expect(classifySchemaDiff(sql).additive).toBe(true);
  });

  it("new table, new enum, new enum value → additive", () => {
    const sql = `CREATE TYPE "Kind" AS ENUM ('a', 'b');
ALTER TYPE "EventType" ADD VALUE 'showcase';
CREATE TABLE "BoardPick" ("id" TEXT NOT NULL, CONSTRAINT "BoardPick_pkey" PRIMARY KEY ("id"));`;
    expect(classifySchemaDiff(sql).additive).toBe(true);
  });

  it.each([
    ["drop column", `ALTER TABLE "Event" DROP COLUMN "legacy";`],
    ["add + drop in one ALTER", `ALTER TABLE "Event" ADD COLUMN "a" INT, DROP COLUMN "b";`],
    ["retype", `ALTER TABLE "Event" ALTER COLUMN "x" SET DATA TYPE BIGINT USING "x"::bigint;`],
    ["set not null", `ALTER TABLE "Event" ALTER COLUMN "x" SET NOT NULL;`],
    ["drop table", `DROP TABLE "Old";`],
    ["drop index", `DROP INDEX "Event_slug_key";`],
    ["rename", `ALTER TABLE "Event" RENAME COLUMN "a" TO "b";`],
    ["enum recreate", `ALTER TYPE "Kind" RENAME TO "Kind_old";`],
    ["data rewrite", `UPDATE "Event" SET "x" = 1;`],
    ["unknown statement", `COMMENT ON TABLE "Event" IS 'x';`],
  ])("%s → not additive, statement reported", (_name, sql) => {
    const result = classifySchemaDiff(N15_08 + "\n" + sql);
    expect(result.additive).toBe(false);
    expect(result.offending).toBeTruthy();
  });
});

// The migrate workflows pass `--accept-data-loss` only when this says the
// generated SQL is additive. A false "additive" would let a destructive
// change through unattended, so the destructive cases are the ones
// pinned hardest here.
import { describe, it, expect } from "vitest";
import {
  classifySchemaDiff,
  findDropStatements,
} from "../../../scripts/schema-diff-additive.mjs";

// The real per-group wishes diff (`prisma migrate diff --script`), which `db push`
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
    ["add + short-form retype", `ALTER TABLE "Event" ADD COLUMN "a" INT, ALTER "b" TYPE BIGINT;`],
    ["add + short-form set not null", `ALTER TABLE "Event" ADD COLUMN "a" INT, ALTER "b" SET NOT NULL;`],
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

// The migrate workflows stop on any statement this returns, unless the
// operator dispatched with accept_data_loss. `db push` drops an EMPTY
// column without a warning, and on the dev DB an empty column is usually
// an unmerged branch's — so a missed DROP here is the silent case, and a
// false DROP only costs a manual dispatch.
describe("findDropStatements", () => {
  it("additive diff → nothing to refuse", () => {
    expect(findDropStatements(N15_08)).toEqual([]);
  });

  it("empty diff → nothing to refuse", () => {
    expect(findDropStatements("-- This is an empty migration.\n")).toEqual([]);
  });

  it("a branch-only column being reverted → refused, statement reported", () => {
    const sql = `-- AlterTable
ALTER TABLE "StageIdentity" DROP COLUMN "sortOrder";`;
    expect(findDropStatements(sql)).toEqual([
      'ALTER TABLE "StageIdentity" DROP COLUMN "sortOrder"',
    ]);
  });

  it.each([
    ["add + drop in one ALTER", `ALTER TABLE "Event" ADD COLUMN "a" INT,
DROP COLUMN "b";`],
    ["short form without COLUMN", `ALTER TABLE "Event" DROP "b";`],
    ["IF EXISTS", `ALTER TABLE "Event" DROP COLUMN IF EXISTS "b";`],
    ["drop table", `DROP TABLE "BoardPick";`],
    ["drop index of a kept table", `DROP INDEX "Event_slug_key";`],
  ])("%s → refused", (_name, sql) => {
    expect(findDropStatements(N15_08 + "\n" + sql)).toHaveLength(1);
  });

  it("a dropped table's own indexes are not reported twice", () => {
    const sql = `DROP INDEX "BoardPick_eventId_idx";
DROP TABLE "BoardPick";`;
    expect(findDropStatements(sql)).toEqual(['DROP TABLE "BoardPick"']);
  });

  it.each([
    ["drop a constraint", `ALTER TABLE "SongWish" DROP CONSTRAINT "SongWish_groupArtistId_fkey";`],
    ["drop a default", `ALTER TABLE "Event" ALTER COLUMN "x" DROP DEFAULT;`],
    ["drop not null", `ALTER TABLE "Event" ALTER COLUMN "x" DROP NOT NULL;`],
    ["FK with ON DELETE", `ALTER TABLE "A" ADD CONSTRAINT "f" FOREIGN KEY ("b") REFERENCES "B"("id") ON DELETE CASCADE;`],
  ])("%s → no column lost, not refused here", (_name, sql) => {
    expect(findDropStatements(sql)).toEqual([]);
  });
});

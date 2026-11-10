import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { config } from "dotenv";
import { checkoutRoot, pointsAtDevProject } from "./dev-db-guard.mjs";
import { referencingKeys } from "./db-fixture-rm.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** @typedef {{ tag: string, songLinkId: string, listingIds: string[], bonusIds: string[] }} Fixture */

/** @param {Fixture} fixture */
function validate({ tag, songLinkId, listingIds, bonusIds }) {
  if (typeof tag !== "string" || !tag.startsWith("home-bd-e2e-") || !UUID.test(tag.slice(12)) ||
      !Array.isArray(listingIds) || listingIds.length !== 3 ||
      !Array.isArray(bonusIds) || bonusIds.length !== 2 ||
      new Set([songLinkId, ...listingIds, ...bonusIds]).size !== 6 ||
      ![songLinkId, ...listingIds, ...bonusIds].every((id) => typeof id === "string" && UUID.test(id))) {
    throw new Error("Expected the exact home BD fixture receipt");
  }
}

/** @param {Client} db @param {Fixture} fixture */
async function removeHomeBdFixture(db, fixture) {
  validate(fixture);
  const { tag, songLinkId, listingIds, bonusIds } = fixture;
  const eventSlug = `${tag}-event`;
  const songSlug = `${tag}-song`;
  const quote = (name) => db.escapeIdentifier(name);
  const lockIds = async (sql, params) => {
    const { rows } = await db.query(sql, params);
    return rows.map(({ id }) => String(id));
  };

  // Delete the recorded children first, then refuse any incoming reference
  // that could cascade or detach a row the test did not create.
  const remove = async (table, ids) => {
    if (!ids.length) return;
    const parents = quote(table);
    const keys = await referencingKeys(db, table);
    if (keys.length) {
      const refs = keys.map(({ child, col, pcol }) =>
        `SELECT 1 FROM ${quote(child)} child JOIN ${parents} parent ON child.${quote(col)} = parent.${quote(pcol)}
         WHERE parent.id::text = ANY($1)`);
      const { rowCount } = await db.query(`${refs.join(" UNION ALL ")} LIMIT 1`, [ids]);
      if (rowCount) throw new Error(`Unexpected reference to fixture ${table}`);
    }
    const { rowCount } = await db.query(`DELETE FROM ${parents} WHERE id::text = ANY($1)`, [ids]);
    if (rowCount !== ids.length) throw new Error(`Fixture ${table} changed during cleanup`);
  };

  await db.query("BEGIN");
  try {
    const album = await lockIds('SELECT id FROM "Album" WHERE slug = $1 AND "originalTitle" = $1 FOR UPDATE', [tag]);
    const event = await lockIds('SELECT id FROM "Event" WHERE slug = $1 AND "originalName" = $1 FOR UPDATE', [eventSlug]);
    const song = await lockIds('SELECT id FROM "Song" WHERE slug = $1 AND "originalTitle" = $1 FOR UPDATE', [songSlug]);
    const item = await lockIds(
      `SELECT item.id FROM "SetlistItem" item JOIN "SetlistItemSong" link ON link."setlistItemId" = item.id
       WHERE link.id = $1 AND item."eventId" = ANY($2) AND link."songId" = ANY($3) FOR UPDATE OF item, link`,
      [songLinkId, event, song],
    );
    const listing = await lockIds('SELECT id FROM "AlbumStoreListing" WHERE id = ANY($1) AND "albumId" = ANY($2) FOR UPDATE', [listingIds, album]);
    const bonus = await lockIds('SELECT id FROM "AlbumStoreBonus" WHERE id = ANY($1) AND "listingId" = ANY($2) FOR UPDATE', [bonusIds, listing]);
    const comments = await db.query(
      `SELECT 1 FROM "Comment" WHERE "setlistItemId" = ANY($1)
         OR "eventId" = ANY($2) OR "taggedEventId" = ANY($2) OR "rollupEventIds" && $2::text[]
         OR "songId" = ANY($3) OR "taggedSongId" = ANY($3) OR "mentionedSongId" = ANY($3) OR "rollupSongIds" && $3::text[] LIMIT 1`,
      [item, event, song],
    );
    if (comments.rowCount) throw new Error("Unexpected comment reference to the fixture");
    await remove("SetlistItemSong", item.length ? [songLinkId] : []);
    await remove("SetlistItem", item);
    await remove("Event", event);
    await remove("Song", song);
    await db.query(
      `DELETE FROM "AlbumStoreBonusLifecycleOperation" WHERE "bonusId" = ANY($1)
         AND (summary = $2 OR starts_with(summary, $2 || '-'))`,
      [bonus, tag],
    );
    await remove("AlbumStoreBonus", bonus);
    await remove("AlbumStoreListing", listing);
    await remove("Album", album);

    const { rows: [{ remaining }] } = await db.query(
      `SELECT EXISTS (
         SELECT 1 FROM "Album" WHERE slug = $1 UNION ALL
         SELECT 1 FROM "Event" WHERE slug = $2 UNION ALL
         SELECT 1 FROM "Song" WHERE slug = $3 UNION ALL
         SELECT 1 FROM "SetlistItem" WHERE id = ANY($4) UNION ALL
         SELECT 1 FROM "SetlistItemSong" WHERE id = $5 UNION ALL
         SELECT 1 FROM "AlbumStoreListing" WHERE id = ANY($6) UNION ALL
         SELECT 1 FROM "AlbumStoreBonus" WHERE id = ANY($7) UNION ALL
         SELECT 1 FROM "AlbumStoreBonusLifecycleOperation" WHERE "bonusId" = ANY($7)
       ) AS remaining`,
      [tag, eventSlug, songSlug, item, songLinkId, listingIds, bonusIds],
    );
    if (remaining) throw new Error(`Fixture rows remain for ${tag}. Cleanup rolled back.`);
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const receipt = process.argv[2];
  if (!receipt) throw new Error("Usage: node scripts/db-home-bd-fixture-rm.mjs <fixture-receipt.json>");
  const fixture = JSON.parse(readFileSync(receipt, "utf8"));
  validate(fixture);
  const root = checkoutRoot(join(import.meta.dirname, ".."));
  config({ path: [join(root, ".env.local"), join(root, ".env")], quiet: true });
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString || !pointsAtDevProject(connectionString) || (new URL(connectionString).port || "5432") !== "5432") {
    throw new Error("Requires the dev session DATABASE_URL_UNPOOLED");
  }
  const db = new Client({ connectionString });
  await db.connect();
  try {
    await removeHomeBdFixture(db, fixture);
    console.log(`${fixture.tag}: 0 fixture rows remain`);
  } finally {
    await db.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

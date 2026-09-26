// scripts/delete-album.ts
//
// Delete an Album row by slug, handling all FK cleanups in a single
// transaction. Use for one-off stale-row removal after admin-UI slug
// rename creates a duplicate (e.g. the prod row stayed at the old
// slug while a re-import added a fresh row under the new slug).
//
// Usage:
//   npx tsx scripts/delete-album.ts <slug>
//   npx tsx scripts/delete-album.ts fruits-punch
//
// Cascade behavior:
//   - AlbumStoreListing / AlbumStoreBonus + their translations: handled
//     by schema-level `onDelete: Cascade`
//   - AlbumTrack + AlbumTrackTranslation: NOT cascade in schema —
//     deleted explicitly here
//   - AlbumTranslation, AlbumArtist: NOT cascade — deleted explicitly
//   - Event.bdAlbumId: nullable FK pointing here, no cascade — set to
//     NULL on any Event that pointed at this album (preserves the
//     Event row itself; operator can re-link via admin UI if needed)
//
// Refuses to run without explicit confirmation prompt — paste the
// slug a second time when prompted.

import { prisma } from "../src/lib/prisma";
import * as readline from "node:readline/promises";

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npx tsx scripts/delete-album.ts <slug>");
  process.exit(2);
}

(async () => {
  const album = await prisma.album.findUnique({
    where: { slug },
    select: { id: true, originalTitle: true, type: true, releaseDate: true },
  });
  if (!album) {
    console.error(`Album with slug "${slug}" not found.`);
    process.exit(1);
  }

  // Pre-flight counts
  const [trackCount, translationCount, artistCount, listingCount, eventCount] =
    await Promise.all([
      prisma.albumTrack.count({ where: { albumId: album.id } }),
      prisma.albumTranslation.count({ where: { albumId: album.id } }),
      prisma.albumArtist.count({ where: { albumId: album.id } }),
      prisma.albumStoreListing.count({ where: { albumId: album.id } }),
      prisma.event.count({ where: { bdAlbumId: album.id } }),
    ]);

  console.error(`About to delete:`);
  console.error(`  Album: id=${album.id}  slug=${slug}  type=${album.type}  release=${album.releaseDate ?? "?"}`);
  console.error(`         originalTitle=${JSON.stringify(album.originalTitle)}`);
  console.error(`  + ${trackCount} AlbumTrack rows (+ any AlbumTrackTranslation children)`);
  console.error(`  + ${translationCount} AlbumTranslation rows`);
  console.error(`  + ${artistCount} AlbumArtist link rows`);
  console.error(`  + ${listingCount} AlbumStoreListing rows (and their bonuses) — cascade`);
  console.error(`  + ${eventCount} Event(s) — bdAlbumId will be set to NULL (event row preserved)`);
  console.error("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ans = await rl.question(`Type the slug again to confirm: `);
  rl.close();
  if (ans.trim() !== slug) {
    console.error(`Confirmation mismatch (${JSON.stringify(ans)} ≠ ${JSON.stringify(slug)}). Aborted.`);
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    // 1. AlbumTrackTranslation children (explicit — AlbumTrack delete won't cascade them at DB level)
    const trackIds = (
      await tx.albumTrack.findMany({ where: { albumId: album.id }, select: { id: true } })
    ).map((t) => t.id);
    if (trackIds.length > 0) {
      await tx.albumTrackTranslation.deleteMany({
        where: { albumTrackId: { in: trackIds } },
      });
      await tx.albumTrack.deleteMany({ where: { albumId: album.id } });
    }
    // 2. Translations + artists
    await tx.albumTranslation.deleteMany({ where: { albumId: album.id } });
    await tx.albumArtist.deleteMany({ where: { albumId: album.id } });
    // 3. Event back-refs: preserve event, null the FK
    await tx.event.updateMany({
      where: { bdAlbumId: album.id },
      data: { bdAlbumId: null },
    });
    // 4. Album itself (AlbumStoreListing + AlbumStoreBonus cascade via schema)
    await tx.album.delete({ where: { id: album.id } });
  });

  console.error(`✓ Deleted album "${slug}" (id=${album.id}) and all dependent rows.`);
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(`✗ Error:`, e);
  await prisma.$disconnect();
  process.exit(1);
});

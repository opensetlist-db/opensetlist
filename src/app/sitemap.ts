import { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { buildSitemap, type SitemapEntity } from "@/lib/seo/sitemap";

// Sitemap is computed on demand, not statically prerendered at build
// time. Background — the v0.13.16 deploy (the first v0.13.x release
// to touch the schema) revealed a race between Vercel's auto-deploy
// and `migrate-prod.yml`: both fire on the tag push, Vercel runs
// `next build` immediately, the build prerenders /sitemap.xml against
// prod, but `prisma.event.findMany()` issues `SELECT ..., "artistId", ...`
// against a DB that hasn't received the new column yet (because the
// schema-migration workflow is still queued). Result: build fails
// with P2022 ColumnNotFound, Vercel keeps serving the previous tag.
//
// `force-dynamic` decouples the sitemap from build-time DB state — it
// renders at request time, by which point the migration has long
// since landed. The runtime cost is negligible (sitemap is requested
// at low frequency by crawlers, not by users) and Next.js still
// caches via the standard HTTP layer.
//
// This guard doesn't cover every page that touches the DB at build
// time. If a future schema release breaks another statically-rendered
// route the right fix is the same `force-dynamic` opt-out there.
export const dynamic = "force-dynamic";

// Egress: this runs on every /sitemap.xml fetch against the pooler, so
// every query selects only the three columns the sitemap needs — the
// previous version pulled every column of every event/series/artist/song.
// No entity model has `updatedAt`; `createdAt` is the fallback, and events
// use their newest setlist row so a freshly-filled setlist is recrawled.
const ENTITY_SELECT = { id: true, slug: true, createdAt: true } as const;

type Row = { id: bigint | string; slug: string; createdAt: Date };
const toEntity = (r: Row): SitemapEntity => ({
  id: r.id,
  slug: r.slug,
  lastModified: r.createdAt,
});

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [events, setlistActivity, series, artists, songs, albums, members] =
    await Promise.all([
      prisma.event.findMany({
        where: { isDeleted: false },
        select: ENTITY_SELECT,
        orderBy: { date: "desc" },
      }),
      prisma.setlistItem.groupBy({
        by: ["eventId"],
        where: { isDeleted: false },
        _max: { createdAt: true },
      }),
      prisma.eventSeries.findMany({
        where: { isDeleted: false },
        select: ENTITY_SELECT,
      }),
      prisma.artist.findMany({
        where: { isDeleted: false },
        select: ENTITY_SELECT,
      }),
      prisma.song.findMany({
        where: { isDeleted: false },
        select: ENTITY_SELECT,
      }),
      // Album and StageIdentity have no soft-delete column.
      prisma.album.findMany({ select: ENTITY_SELECT }),
      prisma.stageIdentity.findMany({ select: ENTITY_SELECT }),
    ]);

  const lastSetlistAt = new Map(
    setlistActivity.map((g) => [String(g.eventId), g._max.createdAt]),
  );

  return buildSitemap({
    events: events.map((e) => {
      const setlistAt = lastSetlistAt.get(String(e.id));
      return {
        id: e.id,
        slug: e.slug,
        lastModified:
          setlistAt && setlistAt > e.createdAt ? setlistAt : e.createdAt,
      };
    }),
    series: series.map(toEntity),
    artists: artists.map(toEntity),
    songs: songs.map(toEntity),
    albums: albums.map(toEntity),
    members: members.map(toEntity),
  });
}

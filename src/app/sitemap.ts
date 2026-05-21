import { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { BASE_URL } from "@/lib/config";

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const locales = ["ko", "ja", "en"];

  const staticPages: MetadataRoute.Sitemap = locales.flatMap((locale) => [
    {
      url: `${BASE_URL}/${locale}`,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/${locale}/privacy`,
      lastModified: new Date("2026-04-15"),
      changeFrequency: "yearly" as const,
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/${locale}/terms`,
      lastModified: new Date("2026-04-15"),
      changeFrequency: "yearly" as const,
      priority: 0.3,
    },
  ]);

  const events = await prisma.event.findMany({
    where: { isDeleted: false },
    orderBy: { date: "desc" },
  });

  const eventPages: MetadataRoute.Sitemap = events.map((event) => ({
    url: `${BASE_URL}/ko/events/${event.id}/${event.slug}`,
    lastModified: event.createdAt,
    changeFrequency: "weekly" as const,
    priority: 0.9,
  }));

  const series = await prisma.eventSeries.findMany({
    where: { isDeleted: false },
  });

  const seriesPages: MetadataRoute.Sitemap = series.map((s) => ({
    url: `${BASE_URL}/ko/series/${s.id}/${s.slug}`,
    lastModified: s.createdAt,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const artists = await prisma.artist.findMany({
    where: { isDeleted: false },
  });

  const artistPages: MetadataRoute.Sitemap = artists.map((artist) => ({
    url: `${BASE_URL}/ko/artists/${artist.id}/${artist.slug}`,
    lastModified: artist.createdAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const songs = await prisma.song.findMany({
    where: { isDeleted: false },
  });

  const songPages: MetadataRoute.Sitemap = songs.map((song) => ({
    url: `${BASE_URL}/ko/songs/${song.id}/${song.slug}`,
    lastModified: song.createdAt,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
    ...staticPages,
    ...eventPages,
    ...seriesPages,
    ...artistPages,
    ...songPages,
  ];
}

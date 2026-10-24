import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { devPgClient } from "./devPg";

// Logo resolution against the DEV database: real LogoDisplayMode rows,
// the Restrict FKs and post-deploy CHECKs that only Postgres enforces,
// and the cache-invalidation duty of the existing series writer. The
// pure inheritance matrix lives in unit/logo-resolution.test.ts; this
// suite proves the same rules hold for rows read through the module's
// own selects, that the reads never fetch private asset columns, and
// that legacy posters / series images are not treated as logos.
//
// Fixtures (per-run TAG): one coloured artist, three series root ← mid ←
// leaf, two events on leaf, ImageAsset rows under `itest/<TAG>/`. No existing record is
// written. beforeEach resets the fixture state; afterAll resets logo
// references (FKs are Restrict) and hard-deletes by slug / key prefix.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

const revalidatePublicData = vi.fn();
const revalidateEventData = vi.fn();
vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidatePublicData: () => revalidatePublicData(),
  revalidateEventData: (id: unknown) => revalidateEventData(id),
  revalidateEventImpressions: vi.fn(),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { PUT as SERIES_PUT } from "@/app/api/admin/event-series/[id]/route";
import { PUT as EVENT_PUT } from "@/app/api/admin/events/[id]/route";
import { getLogoSeriesGraph, fetchLogoSeriesGraphRows } from "@/lib/logoSeriesGraph";
import {
  LOGO_EVENT_SELECT,
  decideEventLogo,
  resolveEventLogo,
  resolveSeriesLogo,
} from "@/lib/logoResolution";

const TAG = `logo-itest-${Date.now()}`;
const pg = devPgClient();
const START = new Date("2099-01-01T10:00:00.000Z");

let rootId: bigint;
let midId: bigint;
let leafId: bigint;
let eventId: bigint;
let otherEventId: bigint;
const ARTIST_COLOR = "#E50080";
let artistId: bigint;
const assets: { id: string; publicUrl: string }[] = [];

async function createAsset(n: number) {
  const a = await prisma.imageAsset.create({
    data: {
      objectKey: `itest/${TAG}/${n}.webp`,
      publicUrl: `https://example.com/itest/${TAG}/${n}.webp`,
      mimeType: "image/webp",
      byteSize: 1000 + n,
      width: 300 + n,
      height: 100,
      sourceUrl: `https://private.example/${TAG}/${n}`,
      usageNote: `${TAG} private note ${n}`,
    },
  });
  assets.push(a);
  return a;
}

async function createSeries(name: string, parentSeriesId: bigint | null) {
  const s = await prisma.eventSeries.create({
    data: {
      slug: `${TAG}-${name}`,
      type: "standalone",
      originalName: `${TAG} ${name}`,
      parentSeriesId,
      // Legacy generic series image: must never surface as a logo.
      imageUrl: `https://example.com/${TAG}/${name}-series.png`,
    },
  });
  return s.id;
}

async function createEvent(name: string, seriesId: bigint) {
  const e = await prisma.event.create({
    data: {
      slug: `${TAG}-${name}`,
      type: "concert",
      startTime: START,
      eventSeriesId: seriesId,
      originalName: `${TAG} ${name}`,
      posterUrl: `https://example.com/${TAG}/${name}-poster.png`,
    },
  });
  return e.id;
}

const setSeries = (id: bigint, logoMode: "inherit" | "custom" | "typography", logoAssetId: string | null = null) =>
  prisma.eventSeries.update({ where: { id }, data: { logoMode, logoAssetId } });
const setEvent = (id: bigint, logoMode: "inherit" | "custom" | "typography", logoAssetId: string | null = null) =>
  prisma.event.update({ where: { id }, data: { logoMode, logoAssetId } });

async function resolved(id = eventId) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id }, select: LOGO_EVENT_SELECT });
  const graph = await getLogoSeriesGraph();
  return { event, graph, logo: resolveEventLogo(event, graph) };
}

const req = (url: string, body: unknown) =>
  new NextRequest(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const idParams = (id: bigint) => ({ params: Promise.resolve({ id: id.toString() }) });

beforeAll(async () => {
  await pg.connect();
  rootId = await createSeries("root", null);
  midId = await createSeries("mid", rootId);
  leafId = await createSeries("leaf", midId);
  eventId = await createEvent("day1", leafId);
  otherEventId = await createEvent("day2", leafId);
  await createAsset(1);
  await createAsset(2);
  await createAsset(3);

  // Own artist with a known colour: the colour test must not depend on
  // whichever real artist happens to have a (well-formed) colour on dev.
  const artist = await prisma.artist.create({
    data: { slug: `${TAG}-artist`, type: "group", originalName: `${TAG} artist`, color: ARTIST_COLOR },
    select: { id: true },
  });
  artistId = artist.id;
});

// Every test starts from the same fixture state — root ← mid ← leaf, all
// inherit, nothing deleted, no artist — so tests don't depend on order
// (or on `-t` filtering).
beforeEach(async () => {
  await prisma.event.updateMany({
    where: { id: { in: [eventId, otherEventId] } },
    data: { logoMode: "inherit", logoAssetId: null },
  });
  await prisma.eventSeries.updateMany({
    where: { id: { in: [rootId, midId, leafId] } },
    data: { logoMode: "inherit", logoAssetId: null, isDeleted: false, artistId: null },
  });
  await prisma.eventSeries.update({ where: { id: rootId }, data: { parentSeriesId: null } });
  await prisma.eventSeries.update({ where: { id: midId }, data: { parentSeriesId: rootId } });
  await prisma.eventSeries.update({ where: { id: leafId }, data: { parentSeriesId: midId } });
});

afterAll(async () => {
  // By slug / key prefix, not by captured ids: a beforeAll that failed
  // halfway leaves rows whose ids were never captured.
  const slug = `${TAG}-%`;
  await pg.query(`UPDATE "Event" SET "logoMode" = 'inherit', "logoAssetId" = NULL WHERE slug LIKE $1`, [slug]);
  await pg.query(
    `DELETE FROM "EventTranslation" WHERE "eventId" IN (SELECT id FROM "Event" WHERE slug LIKE $1)`,
    [slug],
  );
  await pg.query(`DELETE FROM "Event" WHERE slug LIKE $1`, [slug]);
  await pg.query(
    `UPDATE "EventSeries" SET "logoMode" = 'inherit', "logoAssetId" = NULL, "parentSeriesId" = NULL WHERE slug LIKE $1`,
    [slug],
  );
  await pg.query(
    `DELETE FROM "EventSeriesTranslation" WHERE "eventSeriesId" IN (SELECT id FROM "EventSeries" WHERE slug LIKE $1)`,
    [slug],
  );
  await pg.query(`DELETE FROM "EventSeries" WHERE slug LIKE $1`, [slug]);
  // After the series that referenced it.
  await pg.query(`DELETE FROM "Artist" WHERE slug LIKE $1`, [slug]);
  await pg.query(`DELETE FROM "ImageAsset" WHERE "objectKey" LIKE $1`, [`itest/${TAG}/%`]);
  const left = await pg.query(
    `SELECT (SELECT count(*) FROM "ImageAsset" WHERE "objectKey" LIKE $1)
          + (SELECT count(*) FROM "EventSeries" WHERE slug LIKE $2)
          + (SELECT count(*) FROM "Event" WHERE slug LIKE $2)
          + (SELECT count(*) FROM "Artist" WHERE slug LIKE $2) AS n`,
    [`itest/${TAG}/%`, slug],
  );
  await pg.end();
  expect(Number(left.rows[0].n)).toBe(0);
});

describe("logo resolution on real rows", () => {
  it("defaults to typography; posters and series images are never logos", async () => {
    const { event, graph, logo } = await resolved();
    expect(event.logoMode).toBe("inherit");
    expect(decideEventLogo(event, graph)).toEqual({ kind: "typography", reason: "exhausted" });
    expect(logo.image).toBeNull();
    expect(resolveSeriesLogo(rootId, graph).image).toBeNull();
  });

  it("descendant events inherit an ancestor logo; an event override wins", async () => {
    await setSeries(rootId, "custom", assets[0].id);
    let r = await resolved();
    expect(r.logo.image).toEqual({ url: assets[0].publicUrl, width: 301, height: 100 });
    expect((await resolved(otherEventId)).logo.image?.url).toBe(assets[0].publicUrl);
    expect(resolveSeriesLogo(leafId, r.graph).image?.url).toBe(assets[0].publicUrl);

    await setEvent(eventId, "custom", assets[2].id);
    r = await resolved();
    expect(r.logo.image?.url).toBe(assets[2].publicUrl);
    // The sibling event still inherits.
    expect((await resolved(otherEventId)).logo.image?.url).toBe(assets[0].publicUrl);

    // Unlink (custom → inherit, asset cleared in the same write).
    await setEvent(eventId, "inherit");
    expect((await resolved()).logo.image?.url).toBe(assets[0].publicUrl);
  });

  it("a series typography stop wins over the ancestor; a nearer custom beats both", async () => {
    await setSeries(rootId, "custom", assets[0].id);
    await setSeries(midId, "typography");
    expect((await resolved()).logo.image).toBeNull();
    await setSeries(leafId, "custom", assets[1].id);
    expect((await resolved()).logo.image?.url).toBe(assets[1].publicUrl);
    // Unlinking the leaf returns to the stop, not to root's logo.
    await setSeries(leafId, "inherit");
    expect((await resolved()).logo.image).toBeNull();
  });

  it("the DB rejects custom without an asset, so a half-written unlink can't happen", async () => {
    await expect(
      pg.query(`UPDATE "Event" SET "logoMode" = 'custom', "logoAssetId" = NULL WHERE id = $1`, [eventId.toString()]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("deleted and cyclic relations terminate with typography", async () => {
    await setSeries(rootId, "custom", assets[0].id);
    await prisma.eventSeries.update({ where: { id: midId }, data: { isDeleted: true } });
    const deleted = await resolved();
    expect(decideEventLogo(deleted.event, deleted.graph)).toEqual({
      kind: "typography",
      reason: "broken-chain",
    });

    // root → leaf closes root ← mid ← leaf into a cycle.
    await prisma.eventSeries.update({ where: { id: midId }, data: { isDeleted: false } });
    await setSeries(rootId, "inherit");
    await prisma.eventSeries.update({ where: { id: rootId }, data: { parentSeriesId: leafId } });
    const r = await resolved();
    expect(decideEventLogo(r.event, r.graph)).toEqual({ kind: "typography", reason: "broken-chain" });
  });

  it("colours come from the series representative artist, never a performer", async () => {
    await prisma.eventSeries.update({ where: { id: rootId }, data: { artistId } });
    expect((await resolved()).logo.color).toBe(ARTIST_COLOR);
    await prisma.eventSeries.update({ where: { id: rootId }, data: { artistId: null } });
    expect((await resolved()).logo.color).toBeNull();
  });

  it("reads and projections never carry private asset columns", async () => {
    await setSeries(rootId, "custom", assets[0].id);
    await setEvent(eventId, "custom", assets[2].id);
    const rows = await fetchLogoSeriesGraphRows();
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: LOGO_EVENT_SELECT });
    const projected = (await resolved()).logo;
    expect(projected.image?.url).toBe(assets[2].publicUrl); // positive control
    for (const text of [
      JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      JSON.stringify(event, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      JSON.stringify(projected),
    ]) {
      expect(text).not.toContain("private.example");
      expect(text).not.toContain("private note");
      expect(text).not.toContain(`"itest/${TAG}`); // standalone objectKey
      expect(text).not.toContain("-poster.png");
      expect(text).not.toContain("-series.png");
    }
  });

  it("logo writes leave setlistRevision alone", async () => {
    const before = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).setlistRevision;
    await setEvent(eventId, "typography");
    await setEvent(eventId, "custom", assets[0].id);
    await setEvent(eventId, "inherit");
    const after = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).setlistRevision;
    expect(after).toBe(before);
  });

  it("the series writer expires the public cache that carries every descendant", async () => {
    await setSeries(rootId, "custom", assets[0].id);
    expect((await resolved()).logo.image?.url).toBe(assets[0].publicUrl);
    revalidatePublicData.mockClear();
    const res = await SERIES_PUT(
      req(`http://x/api/admin/event-series/${midId}`, {
        type: "standalone",
        originalName: `${TAG} mid v2`,
        originalLanguage: "ja",
        parentSeriesId: null, // re-parent: leaf's events lose root's logo
        translations: [{ locale: "ja", name: `${TAG} mid v2` }],
      }),
      idParams(midId),
    );
    expect(res.status).toBe(200);
    expect(revalidatePublicData).toHaveBeenCalled();
    expect((await resolved()).logo.image).toBeNull();
    expect((await resolved(otherEventId)).logo.image).toBeNull();
  });

  it("the event writer expires the public cache, not only the event tag", async () => {
    revalidatePublicData.mockClear();
    revalidateEventData.mockClear();
    const res = await EVENT_PUT(
      req(`http://x/api/admin/events/${eventId}`, {
        type: "concert",
        startTime: START.toISOString(), // unchanged: no live-field write
        eventSeriesId: midId.toString(), // re-home the event onto mid
        originalName: `${TAG} day1 v2`,
        originalLanguage: "ja",
        translations: [{ locale: "ja", name: `${TAG} day1 v2` }],
      }),
      idParams(eventId),
    );
    expect(res.status).toBe(200);
    expect(revalidatePublicData).toHaveBeenCalled();
    expect((await resolved()).event.eventSeriesId).toBe(midId);
  });

  it("every real series and event resolves without throwing", async () => {
    const graph = await getLogoSeriesGraph();
    const events = await prisma.event.findMany({ where: { isDeleted: false }, select: LOGO_EVENT_SELECT });
    for (const e of events) expect(() => resolveEventLogo(e, graph)).not.toThrow();
    for (const key of graph.keys()) expect(() => resolveSeriesLogo(BigInt(key), graph)).not.toThrow();
  });
});

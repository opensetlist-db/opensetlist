import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { devPgClient } from "./devPg";

// The redesign's managed-image prerequisite (ImageAsset + LogoDisplayMode
// on Event / EventSeries) against the DEV database, after `db push` and
// `prisma/post-deploy.sql`. Only real Postgres can prove what this
// change consists of: the CHECK constraints that live in post-deploy SQL
// (Prisma can't declare them), the Restrict FKs, the unique key/URL
// indexes, the grant/RLS boundary that keeps admin-only provenance out of
// the browser anon key's reach, and that the CURRENT admin writers —
// which know nothing about logos — still create, update and read rows.
//
// Fixtures: a throwaway series + event created through the admin
// handlers, an album created directly (the admin API has no album
// create), and ImageAsset rows under a per-run `itest/<tag>/` key prefix.
// afterAll resets the logo references and hard-deletes all of it.

vi.mock("@/lib/admin-auth", () => ({ verifyAdminAPI: vi.fn(async () => null) }));

vi.mock("@/lib/dataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/dataCache")>()),
  cachedQuery:
    <A extends unknown[], R>(_name: string, fn: (...args: A) => Promise<R>) =>
    (...args: A) =>
      fn(...args),
  revalidateEventData: vi.fn(),
  revalidatePublicData: vi.fn(),
  revalidateEventImpressions: vi.fn(),
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as SERIES_POST } from "@/app/api/admin/event-series/route";
import { PUT as SERIES_PUT } from "@/app/api/admin/event-series/[id]/route";
import { POST as EVENT_POST } from "@/app/api/admin/events/route";
import {
  GET as EVENT_GET,
  PUT as EVENT_PUT,
} from "@/app/api/admin/events/[id]/route";
import { PATCH as ALBUM_PATCH } from "@/app/api/admin/albums/[id]/route";

const TAG = `imgasset-itest-${Date.now()}`;
const pg = devPgClient();

let seriesId: bigint;
let eventId: bigint;
let albumId: bigint;
const assetIds: string[] = [];

// startTime well in the future and identical on every write, so the
// event PUT is never a live-field change (no lock / revision broadcast).
const START = "2099-01-01T10:00:00.000Z";
const POSTER = `https://example.com/${TAG}/poster.png`;
const SERIES_IMAGE = `https://example.com/${TAG}/series.png`;

function req(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const idParams = (id: bigint) => ({
  params: Promise.resolve({ id: id.toString() }),
});

const seriesBody = (name: string) => ({
  type: "standalone",
  originalName: name,
  originalLanguage: "ja",
  translations: [{ locale: "ja", name }],
});
const eventBody = (name: string) => ({
  type: "concert",
  startTime: START,
  eventSeriesId: seriesId.toString(),
  posterUrl: POSTER,
  originalName: name,
  originalLanguage: "ja",
  translations: [{ locale: "ja", name }],
});

let assetSeq = 0;
async function createAsset(overrides: Record<string, unknown> = {}) {
  assetSeq += 1;
  const asset = await prisma.imageAsset.create({
    data: {
      objectKey: `itest/${TAG}/${assetSeq}.webp`,
      publicUrl: `https://example.com/itest/${TAG}/${assetSeq}.webp`,
      mimeType: "image/webp",
      byteSize: 1234,
      width: 400,
      height: 200,
      ...overrides,
    },
  });
  assetIds.push(asset.id);
  return asset;
}

/** SQLSTATE of a raw statement that is expected to fail. */
async function sqlState(sql: string, params: unknown[] = []): Promise<string> {
  try {
    await pg.query(sql, params);
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
  return "succeeded";
}

/** Runs `sql` as `role` inside a rolled-back transaction (SET LOCAL —
 *  transaction-scoped, never a session setting) and returns the
 *  SQLSTATE, or "succeeded". */
async function asRole(role: string, sql: string): Promise<string> {
  await pg.query("BEGIN");
  try {
    await pg.query(`SET LOCAL ROLE ${role}`);
    await pg.query(sql);
    return "succeeded";
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  } finally {
    await pg.query("ROLLBACK");
  }
}

beforeAll(async () => {
  await pg.connect();

  const s = await SERIES_POST(req("http://x/api/admin/event-series", "POST", seriesBody(`${TAG} series`)));
  expect(s.status).toBe(201);
  seriesId = BigInt((await s.json()).id);
  await pg.query(`UPDATE "EventSeries" SET "imageUrl" = $1 WHERE id = $2`, [
    SERIES_IMAGE,
    seriesId.toString(),
  ]);

  const e = await EVENT_POST(req("http://x/api/admin/events", "POST", eventBody(`${TAG} event`)));
  expect(e.status).toBe(201);
  eventId = BigInt((await e.json()).id);

  const album = await prisma.album.create({
    data: { slug: TAG, type: "single", originalTitle: `${TAG} album` },
  });
  albumId = album.id;
});

afterAll(async () => {
  // Clear the references first: the FKs are Restrict.
  if (eventId) {
    await pg.query(
      `UPDATE "Event" SET "logoMode" = 'inherit', "logoAssetId" = NULL WHERE id = $1`,
      [eventId.toString()],
    );
    await pg.query(`DELETE FROM "EventTranslation" WHERE "eventId" = $1`, [eventId.toString()]);
    await pg.query(`DELETE FROM "Event" WHERE id = $1`, [eventId.toString()]);
  }
  if (seriesId) {
    await pg.query(`DELETE FROM "EventSeriesTranslation" WHERE "eventSeriesId" = $1`, [seriesId.toString()]);
    await pg.query(`DELETE FROM "EventSeries" WHERE id = $1`, [seriesId.toString()]);
  }
  if (albumId) await pg.query(`DELETE FROM "Album" WHERE id = $1`, [albumId.toString()]);
  await pg.query(`DELETE FROM "ImageAsset" WHERE "objectKey" LIKE $1`, [`itest/${TAG}/%`]);
  await pg.end();
});

describe("existing admin writers on the extended schema", () => {
  it("creates series and events as inherit/null without knowing the fields", async () => {
    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: seriesId } });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect([series.logoMode, series.logoAssetId]).toEqual(["inherit", null]);
    expect([event.logoMode, event.logoAssetId]).toEqual(["inherit", null]);
    expect(event.posterUrl).toBe(POSTER);
  });

  it("full-replace PUTs keep the logo state and the poster / series image", async () => {
    const asset = await createAsset();
    await prisma.eventSeries.update({
      where: { id: seriesId },
      data: { logoMode: "custom", logoAssetId: asset.id },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { logoMode: "typography" },
    });

    const s = await SERIES_PUT(
      req(`http://x/api/admin/event-series/${seriesId}`, "PUT", seriesBody(`${TAG} series v2`)),
      idParams(seriesId),
    );
    expect(s.status).toBe(200);
    const e = await EVENT_PUT(
      req(`http://x/api/admin/events/${eventId}`, "PUT", eventBody(`${TAG} event v2`)),
      idParams(eventId),
    );
    expect(e.status).toBe(200);

    const series = await prisma.eventSeries.findUniqueOrThrow({ where: { id: seriesId } });
    const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect([series.logoMode, series.logoAssetId, series.imageUrl]).toEqual([
      "custom",
      asset.id,
      SERIES_IMAGE,
    ]);
    expect([event.logoMode, event.logoAssetId, event.posterUrl]).toEqual([
      "typography",
      null,
      POSTER,
    ]);

    const g = await EVENT_GET(new NextRequest(`http://x/api/admin/events/${eventId}`), idParams(eventId));
    expect(g.status).toBe(200);
  });

  it("a URL-only album save stays the cover source; retained assets never override it", async () => {
    const asset = await createAsset();
    const patch = (imageUrl: string | null) =>
      ALBUM_PATCH(
        req(`http://x/api/admin/albums/${albumId}`, "PATCH", {
          slug: TAG,
          type: "single",
          originalTitle: `${TAG} album`,
          originalLanguage: "ja",
          imageUrl,
        }),
        idParams(albumId),
      );
    const cover = async () =>
      (await prisma.album.findUniqueOrThrow({ where: { id: albumId } })).imageUrl;

    expect((await patch(asset.publicUrl)).status).toBe(200);
    expect(await cover()).toBe(asset.publicUrl);

    const external = `https://example.com/${TAG}/external.jpg`;
    expect((await patch(external)).status).toBe(200);
    expect(await cover()).toBe(external);

    expect((await patch(null)).status).toBe(200);
    expect(await cover()).toBeNull();
    // The retained registry row is untouched and does not reappear.
    expect(await prisma.imageAsset.findUnique({ where: { id: asset.id } })).not.toBeNull();
  });
});

describe("mode / asset pairing (post-deploy CHECKs)", () => {
  for (const table of ["EventSeries", "Event"] as const) {
    it(`${table}: only custom+asset and inherit|typography+null are accepted`, async () => {
      const asset = await createAsset();
      const id = (table === "Event" ? eventId : seriesId).toString();
      const set = (mode: string, assetId: string | null) =>
        sqlState(`UPDATE "${table}" SET "logoMode" = $1, "logoAssetId" = $2 WHERE id = $3`, [
          mode,
          assetId,
          id,
        ]);

      expect(await set("custom", asset.id)).toBe("succeeded");
      expect(await set("typography", null)).toBe("succeeded");
      expect(await set("inherit", null)).toBe("succeeded");

      expect(await set("custom", null)).toBe("23514");
      expect(await set("inherit", asset.id)).toBe("23514");
      expect(await set("typography", asset.id)).toBe("23514");
      // A reference to a missing asset is a FK violation.
      expect(await set("custom", "00000000-0000-0000-0000-000000000000")).toBe("23503");
    });
  }

  it("a referenced asset cannot be deleted; an unlinked one can", async () => {
    const asset = await createAsset();
    await prisma.event.update({
      where: { id: eventId },
      data: { logoMode: "custom", logoAssetId: asset.id },
    });
    expect(await sqlState(`DELETE FROM "ImageAsset" WHERE id = $1`, [asset.id])).toBe("23503");

    await prisma.event.update({
      where: { id: eventId },
      data: { logoMode: "inherit", logoAssetId: null },
    });
    expect(await sqlState(`DELETE FROM "ImageAsset" WHERE id = $1`, [asset.id])).toBe("succeeded");
  });

  it("the same asset may back several rows (references are not unique)", async () => {
    const asset = await createAsset();
    await prisma.eventSeries.update({
      where: { id: seriesId },
      data: { logoMode: "custom", logoAssetId: asset.id },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { logoMode: "custom", logoAssetId: asset.id },
    });
    await prisma.event.update({
      where: { id: eventId },
      data: { logoMode: "inherit", logoAssetId: null },
    });
  });
});

describe("ImageAsset row invariants", () => {
  it("rejects a duplicate objectKey or publicUrl", async () => {
    const a = await createAsset();
    const insert = (key: string, url: string) =>
      sqlState(
        `INSERT INTO "ImageAsset" (id, "objectKey", "publicUrl", "mimeType", "byteSize", width, height)
         VALUES (gen_random_uuid()::text, $1, $2, 'image/webp', 1, 1, 1)`,
        [key, url],
      );
    expect(await insert(a.objectKey, `https://example.com/itest/${TAG}/other-url`)).toBe("23505");
    expect(await insert(`itest/${TAG}/other-key`, a.publicUrl)).toBe("23505");
  });

  it("rejects a non-positive byteSize, width or height", async () => {
    for (const [col, i] of [["byteSize", 0], ["width", 1], ["height", 2]] as const) {
      const vals = [10, 10, 10];
      vals[i] = 0;
      const state = await sqlState(
        `INSERT INTO "ImageAsset" (id, "objectKey", "publicUrl", "mimeType", "byteSize", width, height)
         VALUES (gen_random_uuid()::text, $1, $2, 'image/webp', $3, $4, $5)`,
        [`itest/${TAG}/bad-${col}`, `https://example.com/itest/${TAG}/bad-${col}`, ...vals],
      );
      expect(state, col).toBe("23514");
    }
  });
});

describe("server-only access boundary", () => {
  it("RLS is on with no policy, and the table is not in Realtime", async () => {
    const rls = await pg.query(
      `SELECT relrowsecurity FROM pg_class WHERE oid = '"ImageAsset"'::regclass`,
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);
    const policies = await pg.query(
      `SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ImageAsset'`,
    );
    expect(policies.rowCount).toBe(0);
    const realtime = await pg.query(
      `SELECT 1 FROM pg_publication_tables WHERE tablename = 'ImageAsset'`,
    );
    expect(realtime.rowCount).toBe(0);
  });

  it("anon, authenticated and PUBLIC hold no privilege on it", async () => {
    const grants = await pg.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = 'ImageAsset'
         AND grantee IN ('anon', 'authenticated', 'PUBLIC')`,
    );
    expect(grants.rows).toEqual([]);
  });

  it("anon and authenticated are refused at the DB", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await asRole(role, `SELECT * FROM "ImageAsset" LIMIT 1`), role).toBe("42501");
      expect(
        await asRole(
          role,
          `INSERT INTO "ImageAsset" (id, "objectKey", "publicUrl", "mimeType", "byteSize", width, height)
           VALUES ('x', 'x', 'x', 'x', 1, 1, 1)`,
        ),
        role,
      ).toBe("42501");
    }
  });

  it("server Prisma reads and writes it", async () => {
    const asset = await createAsset({ sourceUrl: "https://example.com/src", usageNote: "itest" });
    const read = await prisma.imageAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect([read.sourceUrl, read.usageNote]).toEqual(["https://example.com/src", "itest"]);
  });
});

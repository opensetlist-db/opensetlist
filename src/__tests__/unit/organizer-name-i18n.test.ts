import { describe, it, expect, vi, beforeEach } from "vitest";

// Organizer (主催) labels are localized through the translation tables
// (EventTranslation / EventSeriesTranslation `.organizerName`), with the
// parent `organizerName` column holding the original-language value.
// Covers resolution, the events-list group label, admin validation and
// the CSV importer's preserve-on-blank columns.

vi.mock("@/lib/admin-auth", () => ({
  verifyAdminAPI: vi.fn(),
}));

vi.mock("@/lib/dataCache", () => ({
  revalidatePublicData: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    eventSeries: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    eventSeriesTranslation: { upsert: vi.fn() },
    eventTranslation: { upsert: vi.fn() },
    artist: { findMany: vi.fn(), findUnique: vi.fn() },
    album: { findMany: vi.fn() },
    stageIdentity: { findMany: vi.fn() },
  },
}));

import { resolveLocalizedField } from "@/lib/display";
import { getEventsListGrouped } from "@/lib/events";
import { validateEventTranslations } from "@/app/api/admin/events/_validate";
import { parseEventSeriesTranslations } from "@/lib/admin-input";
import { POST as IMPORT_POST } from "@/app/api/admin/import/route";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { jsonRequest } from "../helpers/requestFactory";
import type { NextRequest } from "next/server";

const mocked = prisma as unknown as {
  event: Record<string, ReturnType<typeof vi.fn>>;
  eventSeries: Record<string, ReturnType<typeof vi.fn>>;
  eventSeriesTranslation: Record<string, ReturnType<typeof vi.fn>>;
  eventTranslation: Record<string, ReturnType<typeof vi.fn>>;
  artist: Record<string, ReturnType<typeof vi.fn>>;
  album: Record<string, ReturnType<typeof vi.fn>>;
  stageIdentity: Record<string, ReturnType<typeof vi.fn>>;
};

beforeEach(() => {
  vi.clearAllMocks();
  (verifyAdminAPI as ReturnType<typeof vi.fn>).mockResolvedValue(null);
});

describe("organizerName resolution", () => {
  const series = { organizerName: "ラブライブ！シリーズ" };
  const translations = [
    { locale: "ja", organizerName: "ラブライブ！シリーズ" },
    { locale: "ko", organizerName: "러브라이브! 시리즈" },
    { locale: "en", organizerName: null },
  ];

  it("uses the viewer-locale translation when present", () => {
    expect(
      resolveLocalizedField(series, translations, "ko", "organizerName", "organizerName")
    ).toBe("러브라이브! 시리즈");
  });

  it("falls back to the original-language parent when the locale row is empty", () => {
    expect(
      resolveLocalizedField(series, translations, "en", "organizerName", "organizerName")
    ).toBe("ラブライブ！シリーズ");
  });

  it("falls back to the parent when the locale has no row at all", () => {
    expect(
      resolveLocalizedField(series, [], "zh-CN", "organizerName", "organizerName")
    ).toBe("ラブライブ！シリーズ");
  });

  it("returns null when neither the row nor the parent has a value", () => {
    expect(
      resolveLocalizedField({ organizerName: null }, [], "ko", "organizerName", "organizerName")
    ).toBeNull();
  });
});

describe("getEventsListGrouped — organizer groups", () => {
  function standaloneEvent(id: number, organizerName: string, translations: unknown[]) {
    return {
      id: BigInt(id),
      slug: `ev-${id}`,
      eventSeriesId: null,
      artistId: null,
      organizerName,
      status: "scheduled",
      date: null,
      startTime: new Date(Date.UTC(2099, 0, id)),
      originalName: `Event ${id}`,
      originalShortName: null,
      originalLanguage: "ja",
      originalCity: null,
      originalVenue: null,
      translations,
      _count: { setlistItems: 0 },
    };
  }

  it("labels the group with the locale translation but keys it on the original", async () => {
    mocked.event.findMany.mockResolvedValue([
      standaloneEvent(1, "バンダイナムコ / ランティス", [
        { locale: "ko", name: "A", shortName: null, city: null, venue: null, organizerName: "반다이남코 / 란티스" },
      ]),
      // Second day without a ko row still lands in the same bucket —
      // the key is the original-language value, not the label.
      standaloneEvent(2, "バンダイナムコ / ランティス", []),
    ]);
    mocked.eventSeries.findMany.mockResolvedValue([]);

    const { activeGroups } = await getEventsListGrouped("ko", new Date(Date.UTC(2026, 9, 8)));
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0].kind).toBe("organizer");
    expect(activeGroups[0].id).toBe("org:バンダイナムコ / ランティス");
    expect(activeGroups[0].title).toBe("반다이남코 / 란티스");
    expect(activeGroups[0].events).toHaveLength(2);
  });

  it("falls back to the original organizer when the locale has no translation", async () => {
    mocked.event.findMany.mockResolvedValue([
      standaloneEvent(1, "  Bandai Namco / Lantis ", []),
    ]);
    mocked.eventSeries.findMany.mockResolvedValue([]);

    const { activeGroups } = await getEventsListGrouped("en", new Date(Date.UTC(2026, 9, 8)));
    expect(activeGroups[0].title).toBe("Bandai Namco / Lantis");
  });
});

describe("admin translation validation — organizerName", () => {
  it("event translations accept a string or empty organizerName", () => {
    const r = validateEventTranslations([
      { locale: "ko", name: "1일차", organizerName: "러브라이브! 시리즈" },
      { locale: "ja", name: "Day1", organizerName: "" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value[0].organizerName).toBe("러브라이브! 시리즈");
      expect(r.value[1].organizerName).toBeNull();
    }
  });

  it("event translations reject a non-string organizerName with 400", () => {
    const r = validateEventTranslations([{ locale: "ko", name: "1일차", organizerName: 42 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it("series translations carry organizerName alongside the shared fields", () => {
    const r = parseEventSeriesTranslations([
      { locale: "en", name: "Fes", shortName: null, description: null, organizerName: " Love Live! Series " },
      { locale: "ko", name: "페스" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual([
        { locale: "en", name: "Fes", shortName: null, description: null, organizerName: "Love Live! Series" },
        { locale: "ko", name: "페스", shortName: null, description: null, organizerName: null },
      ]);
    }
  });

  it("series translations reject a non-string organizerName", () => {
    const r = parseEventSeriesTranslations([{ locale: "ko", name: "페스", organizerName: ["x"] }]);
    expect(r.ok).toBe(false);
  });
});

describe("events.csv import — *_organizerName columns", () => {
  function importCsv(csv: string) {
    return IMPORT_POST(
      jsonRequest("http://localhost/api/admin/import", { type: "events", csv }) as unknown as NextRequest
    );
  }

  beforeEach(() => {
    mocked.eventSeries.findUnique.mockResolvedValue({ id: BigInt(26) });
    mocked.event.findUnique.mockResolvedValue({ id: BigInt(107), startTime: new Date("2026-11-14T07:30:00Z"), engagementOpensAt: null });
    mocked.album.findMany.mockResolvedValue([]);
    mocked.stageIdentity.findMany.mockResolvedValue([]);
  });

  it("writes series + event organizer translations when supplied", async () => {
    const res = await importCsv(
      [
        "series_slug,series_ja_name,series_ko_name,series_ko_organizerName,event_slug,ja_name,ko_name,en_organizerName",
        "lovelive-15th-fes,ラブライブ！フェス,러브라이브! 페스,러브라이브! 시리즈,lovelive-15th-fes-day1,Day1,1일차,Love Live! Series",
      ].join("\n")
    );
    expect(res.status).toBe(200);

    const seriesUpserts = mocked.eventSeriesTranslation.upsert.mock.calls.map((c) => c[0]);
    const koSeries = seriesUpserts.find((u) => u.create.locale === "ko");
    expect(koSeries.update.organizerName).toBe("러브라이브! 시리즈");

    // en row exists only because en_organizerName was supplied; its
    // NOT NULL name falls back to the event's ja name.
    const eventUpserts = mocked.eventTranslation.upsert.mock.calls.map((c) => c[0]);
    const enEvent = eventUpserts.find((u) => u.create.locale === "en");
    expect(enEvent.update.organizerName).toBe("Love Live! Series");
    expect(enEvent.create.name).toBe("Day1");
  });

  it("leaves organizer translations untouched when the column is blank or absent", async () => {
    const res = await importCsv(
      [
        "series_slug,series_ko_name,event_slug,ko_name,ko_organizerName",
        "lovelive-15th-fes,러브라이브! 페스,lovelive-15th-fes-day1,1일차,",
      ].join("\n")
    );
    expect(res.status).toBe(200);

    const seriesKo = mocked.eventSeriesTranslation.upsert.mock.calls[0][0];
    expect(seriesKo.update.organizerName).toBeUndefined();
    const eventKo = mocked.eventTranslation.upsert.mock.calls[0][0];
    expect(eventKo.update.organizerName).toBeUndefined();
  });
});

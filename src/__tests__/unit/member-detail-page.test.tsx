// @vitest-environment node
//
// Member detail page (approved packet 30-v1): the design contract's
// state rows that no real dev record shows — missing translations, no
// colour, no VA, no unit, VA activity periods, mixed event statuses —
// rendered through the real page with a mocked `stageIdentity` read.
// Real-record states (Ceras default, Umi empty, Shion white colour) are
// covered by the page captures in the ticket handoff.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const findFirst = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { stageIdentity: { findFirst: (...a: unknown[]) => findFirst(...a) } },
}));
vi.mock("@/lib/dataCache", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dataCache")>();
  return {
    ...actual,
    cachedQuery: (_name: string, fn: (...args: unknown[]) => unknown) => fn,
  };
});
// Keys echo back with their args so assertions can see both.
vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => {
    const t = (key: string, args?: Record<string, unknown>) =>
      args ? `${key}(${Object.values(args).join(",")})` : key;
    return Object.assign(t, { rich: t, raw: t, markup: t, has: () => true });
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

import MemberPage from "@/app/[locale]/members/[id]/[[...slug]]/page";

const MEMBER_ID = "00000000-0000-4000-8000-000000000031";
const NOW = new Date("2026-06-01T12:00:00Z");

const group = {
  id: 1,
  slug: "hasunosora",
  type: "group",
  color: null,
  originalName: "蓮ノ空女学院スクールアイドルクラブ",
  originalShortName: "蓮ノ空",
  originalLanguage: "ja",
  translations: [{ locale: "ko", name: "하스노소라", shortName: "하스노소라" }],
  parentArtist: null,
};
const unit = {
  id: 3,
  slug: "edel-note",
  type: "unit",
  color: "#6b4fbb",
  originalName: "Edel Note",
  originalShortName: null,
  originalLanguage: "ja",
  translations: [],
  parentArtist: group,
};

let eventSeq = 100;
function event(over: Record<string, unknown> = {}) {
  const id = eventSeq++;
  return {
    id,
    slug: `ev-${id}`,
    status: "completed",
    date: "2026-05-01T00:00:00.000Z",
    startTime: "2026-05-01T09:00:00.000Z",
    originalName: `公演${id}`,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [{ locale: "ko", name: `공연${id}`, shortName: null }],
    eventSeries: {
      id: 7,
      slug: "tour",
      originalName: "ツアー",
      originalShortName: null,
      originalLanguage: "ja",
      translations: [{ locale: "ko", name: "투어", shortName: null }],
    },
    ...over,
  };
}
function song(id: number, artist: unknown = unit) {
  return {
    id,
    slug: `song-${id}`,
    originalTitle: `曲${id}`,
    originalLanguage: "ja",
    variantLabel: null,
    translations: [],
    artists: artist ? [{ role: "primary", artist }] : [],
  };
}
function perf(ev: unknown, songs: unknown[]) {
  return { setlistItem: { event: ev, songs: songs.map((s) => ({ song: s })) } };
}

function member(over: Record<string, unknown> = {}) {
  return {
    id: MEMBER_ID,
    slug: "ceras-yanagida",
    type: "character",
    color: "#f56455",
    originalName: "セラス柳田リリエンフェルト",
    originalShortName: "セラス",
    originalLanguage: "ja",
    translations: [
      { locale: "ko", name: "세라스 야나기다 릴리엔펠트", shortName: "세라스" },
    ],
    artistLinks: [{ startDate: "2024-04-01", endDate: null, artist: unit }],
    voicedBy: [
      {
        startDate: null,
        endDate: null,
        realPerson: {
          originalName: "三宅美羽",
          originalLanguage: "ja",
          translations: [{ locale: "ko", name: "미야케 미우", shortName: null }],
        },
      },
    ],
    performances: [],
    eventPerformers: [],
    ...over,
  };
}

async function render(
  m: unknown,
  { locale = "ko", tab }: { locale?: string; tab?: string } = {},
) {
  findFirst.mockResolvedValue(m);
  const el = await MemberPage({
    params: Promise.resolve({
      locale,
      id: MEMBER_ID,
      slug: ["ceras-yanagida"],
    }),
    searchParams: Promise.resolve(tab ? { tab } : {}),
  });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  findFirst.mockReset();
});

describe("member detail page (30-v1)", () => {
  it("default: translated h1, original subtitle, canonical unit + breadcrumb links, VA without period", async () => {
    const html = await render(member());
    expect(html).toContain(">세라스 야나기다 릴리엔펠트</h1>");
    expect(html).toMatch(/lang="ja"[^>]*>セラス柳田リリエンフェルト</);
    expect(html).toContain('href="/ko/artists/3/edel-note"');
    expect(html).toContain('href="/ko/artists/1/hasunosora"');
    // Original-language short name initial.
    expect(html).toMatch(/aria-hidden="true">セ</);
    expect(html).toContain("voiceActor");
    // The VA block rendered (positive control for the period check
    // below) — all real VA dates are null, so it has no period line.
    expect(html).toMatch(/class="[^"]*voiceName[^"]*">미야케 미우</);
    expect(html).not.toMatch(/class="[^"]*period/);
    expect(html).toContain("--member-color:#f56455");
  });

  it("fallback: no translations shows the original name with lang and no subtitle", async () => {
    // Positive control: with translations the subtitle renders.
    expect(await render(member())).toMatch(/class="[^"]*subtitle/);
    const html = await render(
      member({
        translations: [],
        voicedBy: [
          {
            startDate: null,
            endDate: null,
            realPerson: {
              originalName: "三宅美羽",
              originalLanguage: "ja",
              translations: [],
            },
          },
        ],
      }),
    );
    expect(html).toMatch(/<h1[^>]*lang="ja"[^>]*>セラス柳田リリエンフェルト<\/h1>/);
    expect(html).not.toMatch(/class="[^"]*subtitle/);
    expect(html).toMatch(/lang="ja"[^>]*>三宅美羽</);
  });

  it("no colour, no VA, no unit: neutral rim, VA block and unit link omitted, breadcrumb without group", async () => {
    // Positive control: the same member with VA and unit shows both.
    const full = await render(member());
    expect(full).toContain("voiceActor");
    expect(full).toContain("/ko/artists/");
    const html = await render(
      member({ color: null, voicedBy: [], artistLinks: [] }),
    );
    expect(html).toContain("--member-color:#7C8BA3");
    expect(html).not.toContain("voiceActor");
    expect(html).not.toContain("/ko/artists/");
  });

  it("VA period: active shows start only, ended shows start ~ end", async () => {
    const va = (endDate: string | null) =>
      member({
        voicedBy: [
          {
            startDate: "2023-03-29",
            endDate,
            realPerson: {
              originalName: "三宅美羽",
              originalLanguage: "ja",
              translations: [],
            },
          },
        ],
      });
    const active = await render(va(null));
    expect(active).toMatch(/period[^>]*>2023[^<~]*29[^<~]*<\/p>/);
    const ended = await render(va("2026-03-31"));
    expect(ended).toMatch(/period[^>]*>2023[^<]*~ 2026[^<]*<\/p>/);
  });

  it("empty: zero metrics and the empty message in both overview panels", async () => {
    const html = await render(member());
    expect(html.match(/<dd>0<\/dd>/g)).toHaveLength(3);
    expect(html).toContain(">noSongs<");
    expect(html).toContain(">noEvents<");
    expect(html).not.toContain(">viewAll<");
    // Positive control: four songs bring the songs view-all back.
    const four = await render(
      member({
        performances: [perf(event(), [song(1), song(2), song(3), song(4)])],
      }),
    );
    expect(four).toContain(">viewAll<");
  });

  it("event union: specific + non-guest performer rows, guest-only excluded; statuses and LIVE on the group", async () => {
    const ongoing = event({ status: "ongoing", date: "2026-06-01T00:00:00.000Z" });
    const cancelled = event({ status: "cancelled", date: "2026-04-01T00:00:00.000Z" });
    const upcoming = event({
      status: "scheduled",
      date: "2026-09-01T00:00:00.000Z",
      startTime: "2026-09-01T09:00:00.000Z",
    });
    const standalone = event({ eventSeries: null, date: "2025-01-01T00:00:00.000Z" });
    const guestOnly = event();
    const html = await render(
      member({
        performances: [perf(ongoing, [song(1)]), perf(ongoing, [song(2)])],
        eventPerformers: [
          { isGuest: false, event: cancelled },
          { isGuest: false, event: upcoming },
          { isGuest: false, event: standalone },
          { isGuest: true, event: guestOnly },
        ],
      }),
      { tab: "history" },
    );
    expect(html).toContain("historyHeader(4)");
    for (const ev of [ongoing, cancelled, upcoming, standalone]) {
      expect(html).toContain(`/ko/events/${ev.id}/`);
    }
    expect(html).not.toContain(`/ko/events/${guestOnly.id}/`);
    for (const s of ["ongoing", "cancelled", "upcoming", "completed"]) {
      expect(html).toContain(`data-status="${s}"`);
    }
    // The series group holding the ongoing event comes first and
    // carries LIVE in its summary.
    const firstSummary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0] ?? "";
    expect(firstSummary).toContain("투어");
    expect(firstSummary).toContain('data-status="ongoing"');
    // Standalone events group under their own name.
    expect(html).toMatch(/<h3[^>]*>공연\d+<\/h3>/);
  });

  it("songs: song-row appearances counted (medley songs individually), top 3 with view-all above 3", async () => {
    const ev = event();
    const html = await render(
      member({
        performances: [
          perf(event(), [song(4, null), song(3)]),
          perf(ev, [song(1), song(2)]),
          perf(event(), [song(1)]),
        ],
      }),
    );
    // Count desc, equal counts by song id — not encounter order.
    const order = [...html.matchAll(/href="\/ko\/songs\/(\d+)\//g)].map(
      (m) => m[1],
    );
    expect(order).toEqual(["1", "2", "3"]);
    expect(html).toContain("songCountUnit(2)");
    expect(html.match(/class="[^"]*songRow/g)).toHaveLength(3);
    // One view-all (songs: 4 > 3); recent events: exactly 3, so none.
    expect(html.match(/>viewAll</g)).toHaveLength(1);
    expect(html).toMatch(/\?tab=songs"[^>]*>viewAll</);
  });

  it("events: same-day ties order by start time, then id, newest first", async () => {
    const day = "2026-01-22T00:00:00.000Z";
    const matinee = event({ date: day, startTime: "2026-01-22T02:30:00.000Z" });
    const evening = event({ date: day, startTime: "2026-01-22T10:00:00.000Z" });
    const eveningTwin = event({ date: day, startTime: "2026-01-22T10:00:00.000Z" });
    const html = await render(
      member({
        eventPerformers: [matinee, eveningTwin, evening].map((e) => ({
          isGuest: false,
          event: e,
        })),
      }),
      { tab: "history" },
    );
    const order = [...html.matchAll(/href="\/ko\/events\/(\d+)\//g)].map(
      (m) => Number(m[1]),
    );
    expect(order).toEqual([eveningTwin.id, evening.id, matinee.id]);
  });

  it("songs: a variant shows its label after the title; the base version none", async () => {
    const base = { ...song(1), originalTitle: "Dream Believers" };
    const variant = {
      ...song(98),
      originalTitle: "Dream Believers",
      variantLabel: "105期 Ver.",
    };
    const html = await render(
      member({ performances: [perf(event(), [base, variant])] }),
      { tab: "songs" },
    );
    // Row text with tags (and React's <!-- --> separators) stripped:
    // title, optional variant, then the unit tag.
    const rows = [...html.matchAll(/<a class="[^"]*songRow[^"]*"[\s\S]*?<\/a>/g)].map((m) =>
      m[0].replace(/<!-- -->/g, "").replace(/<[^>]+>/g, ""),
    );
    expect(rows[0]).toMatch(/^Dream BelieversEdel Note/);
    expect(rows[1]).toMatch(/^Dream Believers 105期 Ver\.Edel Note/);
  });

  it("songs tab: a song without artist credit falls back to the member's primary unit tag", async () => {
    const html = await render(
      member({ performances: [perf(event(), [song(9, null)])] }),
      { tab: "songs" },
    );
    expect(html).toContain("songsHeader(1)");
    expect(html).toMatch(/unitTag[^>]*>Edel Note</);
    expect(html).toContain('href="/ko/songs/9/song-9"');
  });
});

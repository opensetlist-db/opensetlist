import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement } from "react";

// Translators echo the key (plus vars) so assertions read the contract,
// not one locale's copy.
const echo = (ns?: string) => (key: string, vars?: Record<string, unknown>) => {
  const full = ns ? `${ns}.${key}` : key;
  return vars ? `${full}:${JSON.stringify(vars)}` : full;
};

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async (opts: { namespace?: string }) =>
    echo(opts?.namespace),
  ),
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => echo(ns),
}));
vi.mock("@/lib/analytics", () => ({ trackStoreClick: vi.fn(), trackAlbumClick: vi.fn() }));

import { AlbumEventsPanel } from "@/components/albums/detail/AlbumEventsPanel";
import { AlbumTracksPanel } from "@/components/albums/detail/AlbumTracksPanel";
import { AlbumPurchasePanel } from "@/components/albums/detail/AlbumPurchasePanel";
import { AlbumTabs } from "@/components/albums/detail/AlbumTabs";
import { AlbumCover } from "@/components/albums/detail/AlbumCover";
import { AlbumIdentity } from "@/components/albums/detail/AlbumIdentity";
import { trackStoreClick, trackAlbumClick } from "@/lib/analytics";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function event(over: Record<string, unknown>): Any {
  return {
    id: "1",
    slug: "ev",
    status: "scheduled",
    date: null,
    startTime: "2025-01-01T09:00:00.000Z",
    originalName: "Event",
    originalShortName: null,
    originalLanguage: "ja",
    originalVenue: null,
    translations: [],
    eventSeries: null,
    ...over,
  };
}

function series(id: string, name: string): Any {
  return {
    id,
    originalName: name,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
  };
}

describe("AlbumEventsPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("pins a series with an ongoing event first, others by newest event, ungrouped last", async () => {
    const el = await AlbumEventsPanel({
      locale: "ko",
      albumType: "album",
      events: [
        event({ id: "10", slug: "old", originalName: "Old", startTime: "2024-01-01T09:00:00Z", eventSeries: series("1", "Series Old") }),
        event({ id: "11", slug: "new", originalName: "New", startTime: "2026-05-01T09:00:00Z", eventSeries: series("2", "Series New") }),
        event({ id: "12", slug: "solo", originalName: "Standalone", startTime: "2026-09-01T09:00:00Z" }),
        // Started 3h ago → ongoing within the 12h window.
        event({ id: "13", slug: "live", originalName: "Live", startTime: "2026-10-21T09:00:00Z", eventSeries: series("3", "Series Live") }),
      ],
    });
    const { container } = render(el as ReactElement);
    const summaries = [...container.querySelectorAll("summary")].map((s) =>
      s.textContent?.replace(/\d+$/, "").trim(),
    );
    expect(summaries).toEqual([
      "Series Live",
      "Series New",
      "Series Old",
      "Event.ungrouped",
    ]);
    const live = screen.getByText("Live").closest("a")!;
    expect(live.getAttribute("href")).toBe("/ko/events/13/live");
    expect(live.querySelector("[data-status]")?.getAttribute("data-status")).toBe("ongoing");
    expect(container.querySelectorAll("details[open]")).toHaveLength(4);
  });

  it("orders events newest-first inside a series and shows the locale venue", async () => {
    const s = series("1", "S");
    const el = await AlbumEventsPanel({
      locale: "ko",
      albumType: "live_album",
      events: [
        event({ id: "1", slug: "d1", originalName: "Day1", startTime: "2025-12-06T09:00:00Z", eventSeries: s, originalVenue: "K-Arena", translations: [{ locale: "ko", name: "Day1", venue: "K-아레나" }] }),
        event({ id: "2", slug: "d2", originalName: "Day2", startTime: "2025-12-07T09:00:00Z", eventSeries: s }),
      ],
    });
    const { container } = render(el as ReactElement);
    const names = [...container.querySelectorAll("strong")].map((n) => n.textContent);
    expect(names).toEqual(["Day2", "Day1"]);
    expect(screen.getByText("K-아레나")).toBeTruthy();
    expect(screen.getByText("Album.events.subtitle.bd")).toBeTruthy();
  });

  it("renders the bare empty panel", async () => {
    const el = await AlbumEventsPanel({ locale: "ko", albumType: "album", events: [] });
    render(el as ReactElement);
    expect(screen.getByText("Album.events.empty")).toBeTruthy();
  });
});

function track(over: Record<string, unknown>): Any {
  return {
    id: "t",
    discNumber: 1,
    trackNumber: 1,
    songId: null,
    song: null,
    parentSongId: null,
    parentSong: null,
    variant: null,
    title: null,
    translations: [],
    ...over,
  };
}

describe("AlbumTracksPanel", () => {
  it("pairs titles from the linked song and from independent tracks in the requested language", async () => {
    const el = await AlbumTracksPanel({
      locale: "ko",
      tracks: [
        track({ id: "song", songId: "7", song: {
          id: "7", slug: "dream", originalTitle: "夢", originalLanguage: "ja",
          translations: [{ locale: "ko", title: "꿈" }],
        }, translations: [{ locale: "ko", title: "독립 번역" }] }),
        track({
          id: "drama", trackNumber: 2, variant: "drama", title: "夜", titleLanguage: "ja",
          translations: [{ locale: "ko", title: "밤" }],
        }),
      ],
    });
    render(el as ReactElement);
    expect(screen.getByText("夢")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("꿈")).toHaveAttribute("lang", "ko");
    expect(screen.getByText("꿈").closest("a")).toHaveAttribute("href", "/ko/songs/7/dream");
    expect(screen.getByText("夜")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("밤")).toHaveAttribute("lang", "ko");
    expect(screen.getByText("밤").closest("a")).toBeNull();
  });

  it("links only song-backed rows and omits disc headings for one disc", async () => {
    const el = await AlbumTracksPanel({
      locale: "ko",
      tracks: [
        track({ id: "a", trackNumber: 1, songId: "7", song: { id: "7", slug: "dream", originalTitle: "Dream", originalLanguage: "ja", translations: [] } }),
        track({ id: "b", trackNumber: 2, title: "Drama Track" }),
      ],
    });
    const { container } = render(el as ReactElement);
    const links = container.querySelectorAll("li a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/ko/songs/7/dream");
    expect(screen.getByText("Drama Track").closest("a")).toBeNull();
    // Both rows rendered, under no disc heading.
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("h3")).toBeNull();
  });

  it("adds disc headings for multi-disc releases", async () => {
    const el = await AlbumTracksPanel({
      locale: "ko",
      tracks: [
        track({ id: "a", discNumber: 1, title: "A" }),
        track({ id: "b", discNumber: 2, title: "B" }),
      ],
    });
    const { container } = render(el as ReactElement);
    expect([...container.querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      'Album.tracks.discN:{"disc":1}',
      'Album.tracks.discN:{"disc":2}',
    ]);
  });
});

function listing(over: Record<string, unknown>): Any {
  return {
    id: "l",
    status: "active",
    originalStoreName: "Store",
    originalEditionLabel: null,
    productUrl: "https://example.com/p",
    startsAt: null,
    endsAt: null,
    storeKey: null,
    officialOrder: null,
    includesPerformanceVideo: true,
    isBonusOption: true,
    translations: [],
    bonuses: [],
    ...over,
  };
}
const bonus = (id: string, type: string): Any => ({
  id,
  originalBonusType: type,
  startsAt: null,
  endsAt: null,
  endedAt: null,
  translations: [],
});

describe("AlbumPurchasePanel", () => {
  it("shows current bonuses and safe purchase links without an ended archive", async () => {
    const el = await AlbumPurchasePanel({
      locale: "ko",
      album: {
        id: "135",
        slug: "dream",
        listings: [
          listing({ id: "a", originalStoreName: "Amazon", bonuses: [bonus("1", "Sleeve")] }),
          listing({ id: "b", originalStoreName: "Bad URL", productUrl: "javascript:alert(1)", bonuses: [bonus("2", "Card")] }),
          listing({ id: "c", originalStoreName: "A-on STORE Powered by A!SMART", storeKey: "a-on store powered by a!smart", status: "sold_out", bonuses: [bonus("5", "Sticker")] }),
          listing({ id: "e", originalStoreName: "Basic", storeKey: "https://example.com/private?q=1", isBonusOption: false }),
          listing({ id: "d", originalStoreName: "Gone", status: "ended", bonuses: [bonus("3", "Poster"), bonus("4", "Badge")] }),
        ],
      } as Any,
    });
    const { container } = render(el as ReactElement);
    expect(screen.getByText("Sleeve")).toBeTruthy();
    expect(screen.getByText("Sticker")).toBeTruthy();
    expect(screen.queryByText("Poster")).toBeNull();
    expect(screen.queryByText("Card")).toBeNull();

    const buyLinks = container.querySelectorAll('a[target="_blank"]');
    // Two current bonus options and one basic option; unsafe and ended links are omitted.
    expect(buyLinks).toHaveLength(3);
    buyLinks.forEach((a) => {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a.getAttribute("href")).toBe("https://example.com/p");
    });

    expect(container.querySelector("details")).toBeNull();

    fireEvent.click(buyLinks[0]);
    expect(trackStoreClick).toHaveBeenCalledWith(
      expect.objectContaining({ albumId: "135", albumSlug: "dream", surface: "album_page", isAffiliate: false, purchaseOption: "with_bonus", storeKey: "amazon_jp" }),
    );
    fireEvent.click(screen.getByRole("link", { name: /A!SMART/ }));
    expect(trackStoreClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ storeKey: "a-on store powered by a!smart" }),
    );
    fireEvent.click(screen.getByRole("link", { name: /Basic/ }));
    expect(trackStoreClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ albumId: "135", purchaseOption: "without_bonus", storeKey: "other" }),
    );
  });

  it("shows the empty state when the album has no listings", async () => {
    const el = await AlbumPurchasePanel({ locale: "ko", album: { id: "1", listings: [] } as Any });
    render(el as ReactElement);
    expect(screen.getByText("Album.bonus.empty")).toBeTruthy();
  });
});

describe("AlbumTabs", () => {
  it("marks the active tab and keeps every tab a canonical ?tab= link", () => {
    render(
      <AlbumTabs
        albumId="1"
        albumSlug="dream-believers"
        basePath="/ko/albums/1/dream-believers"
        active="events"
        ariaLabel="tabs"
        indicatorLabel="bonus-dot"
        tabs={[
          { key: "tracks", label: "Tracks", count: 6 },
          { key: "events", label: "Events", count: 3 },
          { key: "bonus", label: "Buy", count: 0, indicator: true },
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/ko/albums/1/dream-believers?tab=tracks",
      "/ko/albums/1/dream-believers?tab=events",
      "/ko/albums/1/dream-believers?tab=bonus",
    ]);
    expect(links[1].getAttribute("aria-current")).toBe("page");
    expect(links[0].getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("img", { name: "bonus-dot" })).toBeTruthy();
    fireEvent.click(links[2]);
    expect(trackAlbumClick).toHaveBeenCalledWith(expect.objectContaining({ albumId: "1", albumSlug: "dream-believers", surface: "album_purchase_tab" }));
  });
});

describe("AlbumCover", () => {
  it("renders the fallback in the same slot when there is no URL", () => {
    render(<AlbumCover src={null} alt="Dream Believers" />);
    const slot = screen.getByTestId("album-cover");
    expect(slot.getAttribute("data-state")).toBe("fallback");
    expect(screen.getByText("SharedImage.noImage")).toBeTruthy();
  });

  it("keeps no-referrer and falls back on error without retrying", () => {
    render(<AlbumCover src="https://m.media-amazon.com/x.jpg" alt="Cover" />);
    const img = screen.getByRole("img", { name: "Cover" });
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(screen.getByTestId("album-cover").getAttribute("data-state")).toBe("fallback");
    expect(screen.queryByRole("img", { name: "Cover" })).toBeNull();
  });
});

describe("AlbumIdentity", () => {
  const artist = (id: string, name: string, ko?: string): Any => ({
    artist: {
      id,
      slug: `a${id}`,
      originalName: name,
      originalShortName: null,
      originalLanguage: "ja",
      translations: ko ? [{ locale: "ko", name: ko, shortName: null }] : [],
    },
  });

  it("links every credited artist and marks long titles", async () => {
    const title = "ラブライブ！蓮ノ空女学院スクールアイドルクラブ 5th Live Tour 〜4Pair Power Spread!!!!〜 Blu-ray Memorial BOX";
    const el = await AlbumIdentity({
      locale: "ko",
      album: {
        id: "135",
        type: "live_album",
        originalTitle: title,
        originalLanguage: "ja",
        releaseDate: "2026-07-29T00:00:00.000Z",
        imageUrl: null,
        translations: [{ locale: "ko", title: "러브라이브! 5th BD" }],
        artists: [artist("1", "蓮ノ空", "하스노소라"), artist("2", "Guest")],
      } as Any,
    });
    const { container } = render(el as ReactElement);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
    expect(screen.getByText("러브라이브! 5th BD")).toBeTruthy();
    const links = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual(["/ko/artists/1/a1", "/ko/artists/2/a2"]);
    expect(screen.getByText("蓮ノ空")).toHaveAttribute("lang", "ja");
    expect(screen.getByText("하스노소라")).toHaveAttribute("lang", "ko");
    expect(screen.getAllByRole("link")[0].textContent).toBe("蓮ノ空하스노소라");
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe("2026-07-29");
    // Stored as a UTC midnight: the rendered day must not slide back on a
    // host west of UTC.
    expect(container.querySelector("time")?.textContent).toMatch(/29/);
    expect(container.querySelector("section")?.className).toMatch(/longTitle/);
  });
});

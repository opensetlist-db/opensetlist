import { describe, it, expect, vi } from "vitest";
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

import { SongIdentity } from "@/components/songs/detail/SongIdentity";
import { SongAlbumPanel } from "@/components/songs/detail/SongAlbumPanel";
import { SongAlbumCover } from "@/components/songs/detail/SongAlbumCover";
import { SongTabs } from "@/components/songs/detail/SongTabs";
import { SongHistoryPanel } from "@/components/songs/detail/SongHistoryPanel";
import { SongVersionsPanel } from "@/components/songs/detail/SongVersionsPanel";
import {
  groupSongHistory,
  type SongHistoryRow,
} from "@/components/songs/detail/songHistory";
import { utcYear } from "@/components/songs/detail/songDate";
import type { SongAlbumRow } from "@/lib/songAlbums";
import { colors } from "@/styles/tokens";

const albumTypeLabels = {
  single: "single",
  album: "album",
  ep: "EP",
  live_album: "live",
  soundtrack: "OST",
};

function row(over: Partial<SongHistoryRow>): SongHistoryRow {
  return {
    id: "1",
    seriesId: null,
    seriesName: null,
    status: "completed",
    dateTime: "2026-05-24",
    formattedDate: "May 24, 2026",
    dateMs: Date.parse("2026-05-24T00:00:00Z"),
    name: "Event",
    href: "/ko/events/1/ev",
    isEncore: false,
    position: 1,
    ...over,
  };
}

describe("groupSongHistory", () => {
  it("pins an ongoing series first, others by newest event, ungrouped last", () => {
    const { groups, seriesCount } = groupSongHistory([
      row({ id: "a", seriesId: "1", seriesName: "Old", dateMs: 100 }),
      row({ id: "b", seriesId: "2", seriesName: "New", dateMs: 300 }),
      row({ id: "c", dateMs: 900 }),
      row({ id: "d", seriesId: "3", seriesName: "Live", dateMs: 50, status: "ongoing" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["3", "2", "1", "other"]);
    expect(groups[0].hasOngoing).toBe(true);
    expect(seriesCount).toBe(3);
  });

  it("keeps both appearances of a song played twice in one event", () => {
    const { groups } = groupSongHistory([
      row({ id: "11", seriesId: "1", seriesName: "S", dateMs: 200, position: 3 }),
      row({ id: "12", seriesId: "1", seriesName: "S", dateMs: 200, position: 29, isEncore: true }),
      row({ id: "13", seriesId: "1", seriesName: "S", dateMs: 300 }),
    ]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["13", "11", "12"]);
  });
});

describe("SongHistoryPanel", () => {
  it("renders open groups with LIVE in the summary and status per row", async () => {
    const { groups } = groupSongHistory([
      row({ id: "1", seriesId: "7", seriesName: "Tour", status: "ongoing", name: "Day 2", isEncore: true, position: 22 }),
      row({ id: "2", seriesId: "7", seriesName: "Tour", status: "cancelled", name: "Day 1", dateMs: 1 }),
      row({ id: "3", name: "Solo" }),
    ]);
    const el = await SongHistoryPanel({ groups, locale: "ko" });
    const { container } = render(el as ReactElement);
    const details = container.querySelectorAll("details[open]");
    expect(details).toHaveLength(2);
    const summary = details[0].querySelector("summary")!;
    expect(summary.textContent).toContain("Tour");
    expect(summary.querySelector('[data-status="ongoing"]')?.textContent).toBe("Event.live");
    expect(details[1].querySelector("summary")!.textContent).toContain("Event.ungrouped");

    const day2 = screen.getByText("Day 2").closest("a")!;
    expect(day2.getAttribute("href")).toBe("/ko/events/1/ev");
    expect(day2.textContent).toContain("Song.encoreBadge");
    expect(day2.textContent).toContain("#22");
    const day1 = screen.getByText("Day 1").closest("a")!;
    expect(day1.querySelector("[data-status]")?.getAttribute("data-status")).toBe("cancelled");
    expect(day1.querySelector("time")?.getAttribute("dateTime")).toBe("2026-05-24");
  });

  it("renders the empty panel with its own heading", async () => {
    const el = await SongHistoryPanel({ groups: [], locale: "ko" });
    render(el as ReactElement);
    expect(screen.getByRole("heading", { name: "Song.performanceHistory" })).toBeTruthy();
    expect(screen.getByText("Song.noPerformances")).toBeTruthy();
  });
});

describe("SongIdentity", () => {
  // Input colour, echoed back as the accent border.
  const ARTIST_COLOR = "#FB8A9B";
  const base = {
    locale: "ko",
    title: { main: "Dream Believers", sub: null, variant: null },
    artist: { id: 1, slug: "hasu", name: "蓮ノ空", color: ARTIST_COLOR },
    base: null,
    releaseYear: 2023,
    firstAlbum: { title: "Dream Believers", typeLabel: "EP" },
    performanceCount: 3,
    seriesCount: 1,
  };

  it("renders the artist link, meta and stats", async () => {
    const el = await SongIdentity(base);
    const { container } = render(el as ReactElement);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Dream Believers");
    expect(screen.getByRole("link").getAttribute("href")).toBe("/ko/artists/1/hasu");
    expect(container.querySelector("dl")!.textContent).toContain("2023");
    expect(container.querySelector("section")!.getAttribute("style")).toContain(ARTIST_COLOR);
    expect(screen.getByText("Song.statsPerformances")).toBeTruthy();
  });

  it("shows the variant pill and a direct link to the original song", async () => {
    const el = await SongIdentity({
      ...base,
      title: { main: "Dream Believers", sub: null, variant: "104期 Ver." },
      base: { id: 1, slug: "dream-believers", title: "Dream Believers" },
    });
    render(el as ReactElement);
    expect(screen.getByText("104期 Ver.")).toBeTruthy();
    const link = screen.getAllByRole("link").find((a) => a.textContent?.includes("Song.baseVersion"))!;
    expect(link.getAttribute("href")).toBe("/ko/songs/1/dream-believers");
  });

  it("falls back to a kind badge and neutral accent with no credit, and wraps long titles", async () => {
    const long = "【QA】" + "長い日本語の楽曲タイトル · A long multilingual song title ".repeat(4);
    const el = await SongIdentity({
      ...base,
      title: { main: long, sub: "번역 제목", variant: null },
      artist: null,
      releaseYear: null,
      firstAlbum: null,
    });
    const { container } = render(el as ReactElement);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Song.kindBadge")).toBeTruthy();
    expect(screen.getByText("번역 제목")).toBeTruthy();
    expect(container.querySelector("dl")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(long);
  });

  it("ignores a malformed artist colour", async () => {
    const el = await SongIdentity({ ...base, artist: { ...base.artist, color: "red;x" } });
    const { container } = render(el as ReactElement);
    const style = container.querySelector("section")!.getAttribute("style") ?? "";
    // Positive control: the accent variable is set — to the neutral border.
    expect(style).toContain(`--artist-color: ${colors.borderStrong}`);
    expect(style).not.toContain("red;x");
  });
});

function albumRow(over: Partial<SongAlbumRow["album"]>, extra: Partial<SongAlbumRow> = {}): SongAlbumRow {
  return {
    album: {
      id: "5",
      slug: "db",
      type: "ep",
      releaseDate: "2023-04-19T00:00:00.000Z",
      imageUrl: null,
      originalTitle: "Dream Believers",
      originalLanguage: "ja",
      translations: [],
      artists: [],
      listings: [],
      ...over,
    },
    discNumber: 1,
    trackNumber: 1,
    isCanonical: true,
    activeBonusCount: 0,
    ...extra,
  };
}

describe("SongAlbumPanel", () => {
  it("lists every album with original-recording chip, type · UTC year, disc/track and total", async () => {
    const el = await SongAlbumPanel({
      locale: "ko",
      albumTypeLabels,
      rows: [
        albumRow({ releaseDate: "2023-01-01T00:00:00.000Z" }),
        albumRow(
          { id: "6", slug: "second", originalTitle: "Second", translations: [{ locale: "ko", title: "두 번째" }] },
          { isCanonical: false, activeBonusCount: 2, discNumber: 2, trackNumber: 4 },
        ),
      ],
    });
    const { container } = render(el as ReactElement);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/ko/albums/5/db");
    expect(links[0].textContent).toContain("Song.albumOriginalRecording");
    expect(links[0].textContent).toContain("EP · 2023");
    expect(links[1].textContent).not.toContain("Song.albumOriginalRecording");
    expect(links[1].textContent).toContain("두 번째");
    expect(links[1].textContent).toContain("Album.stats.bonusSectionLabel 2");
    expect(links[1].textContent).toContain('Song.discN:{"disc":2}');
    expect(screen.getByText('Song.albumsTotalCount:{"count":2}')).toBeTruthy();
  });

  it("renders nothing without albums", async () => {
    expect(await SongAlbumPanel({ locale: "ko", albumTypeLabels, rows: [] })).toBeNull();
  });
});

describe("SongAlbumCover", () => {
  it("shows the fallback without a URL and after an image error", () => {
    const { container, rerender } = render(<SongAlbumCover src={null} alt="A" />);
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("fallback");
    expect(screen.getByText("SharedImage.noImage")).toBeTruthy();

    rerender(<SongAlbumCover src="https://example.test/a.jpg" alt="A" />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("fallback");
  });
});

describe("SongTabs", () => {
  it("links each tab to the canonical path and marks the active one", () => {
    render(
      <SongTabs
        tabs={[
          { key: "history", label: "History (3)" },
          { key: "variations", label: "Variations (11)" },
        ]}
        active="variations"
        basePath="/ko/songs/1/dream-believers"
        ariaLabel="tabs"
      />,
    );
    const v = screen.getByText("Variations (11)");
    expect(v.getAttribute("href")).toBe("/ko/songs/1/dream-believers?tab=variations");
    expect(v.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("History (3)").getAttribute("aria-current")).toBeNull();
  });
});

describe("SongVersionsPanel", () => {
  it("highlights the current version as a non-link and links others without a tab query", async () => {
    const el = await SongVersionsPanel({
      locale: "ko",
      versions: [
        { id: "1", slug: "db", title: "Dream Believers", sub: null, variantLabel: null, isBase: true, isCurrent: false, performanceCount: 3 },
        { id: "62", slug: "db-104", title: "Dream Believers", sub: "드림 비리버즈", variantLabel: "104期 Ver.", isBase: false, isCurrent: true, performanceCount: 0 },
      ],
    });
    const { container } = render(el as ReactElement);
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/ko/songs/1/db");
    expect(links[0].textContent).toContain("Song.baseVariant");
    const current = container.querySelector('[aria-current="page"]')!;
    expect(current.textContent).toContain("104期 Ver.");
    expect(current.textContent).toContain("Song.currentVariant");
    expect(current.textContent).toContain("드림 비리버즈");
  });
});

describe("utcYear", () => {
  it("reads the UTC year of a stored midnight", () => {
    expect(utcYear("2024-01-01T00:00:00.000Z")).toBe(2024);
    expect(utcYear(null)).toBeNull();
  });
});

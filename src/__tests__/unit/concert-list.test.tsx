import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";

/*
 * Concert list: the list data's display fields
 * (root series type, typography-art text, 07 logo projection) and the
 * approved list controls — filter links, group collapse, past
 * pagination. Grouping/ordering/active-vs-past rules are unchanged and
 * stay covered where they were.
 */

const graph = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/logoSeriesGraph", async () => {
  const { buildLogoSeriesGraph } = await import("@/lib/logoResolution");
  return {
    getLogoSeriesGraph: async () =>
      buildLogoSeriesGraph(graph.rows as Parameters<typeof buildLogoSeriesGraph>[0]),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    event: { findMany: vi.fn() },
    eventSeries: { findMany: vi.fn() },
    artist: { findMany: vi.fn() },
  },
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { getEventsListGrouped } from "@/lib/events";
import { prisma } from "@/lib/prisma";
import { ConcertFilterNav } from "@/components/events/ConcertFilterNav";
import { ConcertGroup } from "@/components/events/ConcertGroup";
import { Pagination } from "@/components/Pagination";
import { EventArt } from "@/components/shared/EventArt";

const mocked = prisma as unknown as {
  event: { findMany: ReturnType<typeof vi.fn> };
  eventSeries: { findMany: ReturnType<typeof vi.fn> };
  artist: { findMany: ReturnType<typeof vi.fn> };
};

const NOW = new Date(Date.UTC(2026, 9, 21));
const SERIES_ARTIST_COLOUR = "#FB8A9B";

function event(id: number, over: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    slug: `ev-${id}`,
    eventSeriesId: null,
    artistId: null,
    organizerName: null,
    status: "scheduled",
    date: null,
    startTime: new Date(Date.UTC(2026, 10, id)),
    originalName: `Event ${id}`,
    originalShortName: `Ev${id}`,
    originalLanguage: "ja",
    originalCity: null,
    originalVenue: null,
    translations: [],
    _count: { setlistItems: 0 },
    logoMode: "inherit",
    logoAsset: null,
    artist: null,
    ...over,
  };
}

function series(id: number, over: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    parentSeriesId: null,
    type: "concert_tour",
    originalName: `Series ${id}`,
    originalShortName: `S${id}`,
    originalLanguage: "ja",
    translations: [],
    artist: null,
    ...over,
  };
}

function graphNode(id: number, over: Record<string, unknown> = {}) {
  return {
    id: BigInt(id),
    parentSeriesId: null,
    isDeleted: false,
    logoMode: "inherit",
    logoAsset: null,
    artistId: null,
    artist: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  graph.rows = [];
  mocked.artist.findMany.mockResolvedValue([]);
});

describe("getEventsListGrouped — display fields", () => {
  it("orders simultaneous rows by ID, independently of database return order", async () => {
    const startTime = new Date("2026-11-01T00:00:00Z");
    mocked.eventSeries.findMany.mockResolvedValue([series(1)]);
    mocked.event.findMany.mockResolvedValue([
      event(3, { eventSeriesId: BigInt(1), startTime }),
      event(1, { eventSeriesId: BigInt(1), startTime }),
      event(2, { eventSeriesId: BigInt(1), startTime: new Date("2026-10-31T23:59:59Z") }),
    ]);

    const { activeGroups } = await getEventsListGrouped("ja", NOW);
    expect(activeGroups[0].events.map((ev) => ev.id)).toEqual([2, 1, 3]);
    expect(mocked.event.findMany.mock.calls[0][0].orderBy).toEqual([
      { startTime: "asc" }, { id: "asc" },
    ]);
  });

  it("breaks equal active and past group times by their first chronological row ID", async () => {
    const future = new Date("2026-11-01T00:00:00Z");
    const past = new Date("2026-10-01T00:00:00Z");
    mocked.eventSeries.findMany.mockResolvedValue([series(1), series(2), series(3), series(4)]);
    // Reverse database order is intentional; a stable sort alone would
    // keep the larger IDs first and fail to define the pagination order.
    mocked.event.findMany.mockResolvedValue([
      event(4, { eventSeriesId: BigInt(4), startTime: past, status: "completed" }),
      event(3, { eventSeriesId: BigInt(3), startTime: future }),
      event(2, { eventSeriesId: BigInt(2), startTime: past, status: "completed" }),
      event(1, { eventSeriesId: BigInt(1), startTime: future }),
    ]);

    const { activeGroups, pastGroups } = await getEventsListGrouped("en", NOW);
    expect(activeGroups.map((g) => g.id)).toEqual(["series:1", "series:3"]);
    expect(pastGroups.map((g) => g.id)).toEqual(["series:2", "series:4"]);
  });

  it("tags the group with the ROOT series type and the art with the event's own series", async () => {
    // Root festival (1) → child leg (2). The group is the root; the art
    // text is the leg's own short name, localized.
    mocked.eventSeries.findMany.mockResolvedValue([
      series(1, { type: "festival" }),
      series(2, {
        parentSeriesId: BigInt(1),
        type: "concert_tour",
        translations: [{ locale: "ko", name: "레그", shortName: "레그 약칭" }],
      }),
    ]);
    mocked.event.findMany.mockResolvedValue([
      event(1, { eventSeriesId: BigInt(2) }),
    ]);

    const { activeGroups } = await getEventsListGrouped("ko", NOW);
    expect(activeGroups[0].id).toBe("series:1");
    expect(activeGroups[0].seriesType).toBe("festival");
    expect(activeGroups[0].events[0].artTitle).toBe("레그 약칭");
  });

  it("falls back to the standalone artist's short name, then the event's own", async () => {
    mocked.eventSeries.findMany.mockResolvedValue([]);
    mocked.artist.findMany.mockResolvedValue([
      {
        id: BigInt(9),
        originalName: "Artist",
        originalShortName: "Art",
        originalLanguage: "ja",
        translations: [],
      },
    ]);
    mocked.event.findMany.mockResolvedValue([
      event(1, { artistId: BigInt(9) }),
      event(2, { organizerName: "Org" }),
    ]);

    const { activeGroups } = await getEventsListGrouped("en", NOW);
    const byId = new Map(
      activeGroups.flatMap((g) => g.events).map((e) => [e.id, e]),
    );
    expect(byId.get(1)?.artTitle).toBe("Art");
    expect(byId.get(2)?.artTitle).toBe("Ev2");
    // Non-series groups carry no type tag.
    expect(activeGroups.every((g) => g.seriesType === null)).toBe(true);
  });

  it("projects the inherited series logo and tint, without the private logo inputs", async () => {
    mocked.eventSeries.findMany.mockResolvedValue([series(1)]);
    graph.rows = [
      graphNode(1, {
        logoMode: "custom",
        logoAsset: { publicUrl: "https://img.test/logo.webp", width: 400, height: 200 },
        artistId: BigInt(5),
        artist: { color: SERIES_ARTIST_COLOUR, isDeleted: false },
      }),
    ];
    mocked.event.findMany.mockResolvedValue([
      event(1, { eventSeriesId: BigInt(1) }),
    ]);

    const { activeGroups } = await getEventsListGrouped("ja", NOW);
    // Positive control: the query really selects the resolver inputs.
    expect(mocked.event.findMany.mock.calls[0][0].select).toMatchObject({
      logoMode: true,
      logoAsset: expect.anything(),
      artist: expect.anything(),
    });
    const ev = activeGroups[0].events[0];
    expect(ev.logo).toEqual({
      image: { url: "https://img.test/logo.webp", width: 400, height: 200 },
      color: SERIES_ARTIST_COLOUR,
    });
    expect(ev).not.toHaveProperty("logoAsset");
    expect(ev).not.toHaveProperty("logoMode");
    expect(ev).not.toHaveProperty("artist");
  });

  it("keeps typography when the event overrides with typography", async () => {
    mocked.eventSeries.findMany.mockResolvedValue([series(1)]);
    graph.rows = [
      graphNode(1, {
        logoMode: "custom",
        logoAsset: { publicUrl: "https://img.test/logo.webp", width: 400, height: 200 },
      }),
    ];
    // Same series, one inheriting sibling (positive control) and one
    // typography override.
    mocked.event.findMany.mockResolvedValue([
      event(1, { eventSeriesId: BigInt(1) }),
      event(2, { eventSeriesId: BigInt(1), logoMode: "typography" }),
    ]);

    const { activeGroups } = await getEventsListGrouped("ja", NOW);
    const [inherits, overrides] = activeGroups[0].events;
    expect(inherits.logo.image?.url).toBe("https://img.test/logo.webp");
    expect(overrides.logo.image).toBeNull();
  });
});

describe("<ConcertFilterNav />", () => {
  const labels = { all: "All", ongoing: "Live now", upcoming: "Upcoming", completed: "Completed" };

  it("links every filter to its own URL without pastPage and marks the current one", () => {
    render(
      <ConcertFilterNav locale="en" active="upcoming" labels={labels} label="Filter events" />,
    );
    const nav = screen.getByRole("navigation", { name: "Filter events" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/en/events",
      "/en/events?filter=ongoing",
      "/en/events?filter=upcoming",
      "/en/events?filter=completed",
    ]);
    expect(screen.getByRole("link", { name: "Upcoming" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
  });
});

describe("<ConcertGroup />", () => {
  const props = {
    title: "Tour",
    artistTag: "Hasu",
    typeLabel: "Tour",
    countLabel: "2 events",
    liveLabel: "LIVE",
    collapseLabel: "Collapse Tour",
    expandLabel: "Expand Tour",
  };

  it("starts expanded and collapses its rows behind the toggle", () => {
    render(
      <ConcertGroup {...props} live={false}>
        <span>Day.1</span>
      </ConcertGroup>,
    );
    const toggle = screen.getByRole("button", { name: "Collapse Tour" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(rows).not.toHaveAttribute("hidden");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAccessibleName("Expand Tour");
    expect(rows).toHaveAttribute("hidden");
    // The header stays: title and count remain visible.
    expect(screen.getByRole("heading", { name: "Tour" })).toBeVisible();
  });

  it("cannot collapse a LIVE group", () => {
    const { rerender } = render(
      <ConcertGroup {...props} live={false}>
        <span>Day.1</span>
      </ConcertGroup>,
    );
    // Positive control: the same group without LIVE has the toggle.
    expect(screen.getByRole("button", { name: "Collapse Tour" })).toBeInTheDocument();
    rerender(
      <ConcertGroup {...props} live>
        <span>Day.1</span>
      </ConcertGroup>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByText("Day.1")).toBeVisible();
  });
});

describe("<EventArt tint />", () => {
  // jsdom normalises colours to rgb(), so compare whole style strings.
  const styleOf = (tint?: string) => {
    const { unmount } = render(<EventArt variant="compact" title="T" tint={tint} />);
    const style = screen.getByTestId("event-art").getAttribute("style");
    unmount();
    return style;
  };

  it("washes the region with a valid colour and ignores anything else", () => {
    const neutral = styleOf();
    expect(styleOf(SERIES_ARTIST_COLOUR)).not.toBe(neutral);
    expect(styleOf("red; background: url(x)")).toBe(neutral);
  });
});

describe("<Pagination /> (past groups)", () => {
  const labels = { nav: "Past events", prev: "Previous", next: "Next", status: "1 / 3" };

  it("omits Previous on the first page and keeps the filter on every link", () => {
    render(
      <Pagination
        currentPage={1}
        totalPages={3}
        pageParamKey="pastPage"
        otherParams={{ filter: "completed" }}
        labels={labels}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Past events" });
    expect(within(nav).queryByRole("link", { name: "Previous" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "1" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "?filter=completed&pastPage=2",
    );
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("shows Previous past the first page and omits Next on the last", () => {
    render(
      <Pagination currentPage={3} totalPages={3} pageParamKey="pastPage" labels={labels} />,
    );
    const nav = screen.getByRole("navigation", { name: "Past events" });
    expect(within(nav).getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "?pastPage=2",
    );
    expect(within(nav).getByRole("link", { name: "Previous" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "3" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("renders nothing for a single page", () => {
    const { container, rerender } = render(
      <Pagination currentPage={1} totalPages={2} pageParamKey="pastPage" labels={labels} />,
    );
    // Positive control: two pages render.
    expect(container).not.toBeEmptyDOMElement();
    rerender(
      <Pagination currentPage={1} totalPages={1} pageParamKey="pastPage" labels={labels} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

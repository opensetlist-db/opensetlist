import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EventsListGroup, EventForList } from "@/lib/events";

vi.mock("@/lib/events", () => ({ getEventsListGrouped: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join("/")}` : key,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/components/EventStatusTicker", () => ({ default: () => null }));

import EventsPage from "@/app/[locale]/events/page";
import { getEventsListGrouped } from "@/lib/events";

const load = vi.mocked(getEventsListGrouped);
const NOW = new Date("2026-10-23T00:00:00Z");
function event(id: number, status: EventForList["status"], startTime: string): EventForList {
  return {
    id, slug: `concert-${id}`, eventSeriesId: id, artistId: null,
    organizerName: null, status, startTime, date: startTime,
    originalName: `Concert ${id}`, originalShortName: null, originalLanguage: "en",
    originalCity: null, originalVenue: null, translations: [],
    _count: { setlistItems: 0 }, logo: { image: null, color: null }, artTitle: null,
  };
}
function group(id: number, events: EventForList[]): EventsListGroup {
  return {
    id: `series:${id}`, kind: "series", title: `Tour ${id}`, artistShortName: null,
    seriesType: "concert_tour", events, earliestStart: 0, latestStart: 0,
    hasOngoing: events.some((e) => e.status === "ongoing"),
  };
}
async function show(searchParams: { filter?: string; pastPage?: string } = {}) {
  return render(await EventsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("concert list server page", () => {
  it("renders a real empty result and an All link after a populated result", async () => {
    load.mockResolvedValue({ activeGroups: [group(1, [event(1, "ongoing", NOW.toISOString())])], pastGroups: [] });
    const populated = await show({ filter: "ongoing" });
    expect(screen.getByRole("link", { name: /Concert 1/ })).toBeInTheDocument();
    populated.unmount();
    load.mockResolvedValue({ activeGroups: [], pastGroups: [] });
    await show({ filter: "ongoing" });
    expect(screen.getByRole("heading", { name: "empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "viewAll" })).toHaveAttribute("href", "/en/events");
    expect(screen.queryByRole("link", { name: /Concert 1/ })).toBeNull();
  });

  it("narrows a mixed tour by resolved UTC status at midnight without changing canonical links", async () => {
    load.mockResolvedValue({ activeGroups: [group(1, [
      event(1, "completed", "2026-10-22T23:59:59Z"),
      event(2, "scheduled", "2026-10-23T00:00:00Z"),
      event(3, "scheduled", "2026-10-23T00:00:01Z"),
      event(4, "cancelled", "2026-10-24T00:00:00Z"),
    ])], pastGroups: [] });
    const all = await show();
    expect(document.querySelectorAll("a[data-status]")).toHaveLength(4);
    all.unmount();
    await show({ filter: "upcoming", pastPage: "2" });
    const rows = [...document.querySelectorAll<HTMLAnchorElement>("a[data-status]")];
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/en/events/3/concert-3"]);
    expect(rows[0]).toHaveAttribute("data-status", "upcoming");
    expect(rows[0].querySelector("time")).toHaveTextContent("2026");
    expect(rows[0].querySelector("time")).toHaveTextContent("23");
    expect(load).toHaveBeenLastCalledWith("en", NOW);
  });

  it("paginates whole past groups, clamps the last page and preserves the filter", async () => {
    load.mockResolvedValue({ activeGroups: [], pastGroups: Array.from({ length: 11 }, (_, i) =>
      group(i + 1, [event(i * 2 + 1, "completed", "2026-01-01T00:00:00Z"), event(i * 2 + 2, "cancelled", "2026-01-02T00:00:00Z")])) });
    const first = await show({ filter: "completed", pastPage: "abc" });
    expect(document.querySelectorAll("a[data-status]")).toHaveLength(20);
    const nav = screen.getByRole("navigation", { name: "pastHeading" });
    expect(within(nav).getByRole("link", { name: "next" })).toHaveAttribute("href", "?filter=completed&pastPage=2");
    first.unmount();
    await show({ filter: "completed", pastPage: "999" });
    expect([...document.querySelectorAll("a[data-status]")].map((a) => a.getAttribute("href"))).toEqual([
      "/en/events/21/concert-21", "/en/events/22/concert-22",
    ]);
    expect(screen.getByRole("link", { name: "2" })).toHaveAttribute("aria-current", "page");
  });

  it("rejects the server render on a data failure", async () => {
    load.mockResolvedValue({ activeGroups: [], pastGroups: [] });
    await expect(EventsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) })).resolves.toBeTruthy();
    load.mockRejectedValue(new Error("fixture database unavailable"));
    await expect(EventsPage({ params: Promise.resolve({ locale: "en" }), searchParams: Promise.resolve({}) })).rejects.toThrow("fixture database unavailable");
  });
});

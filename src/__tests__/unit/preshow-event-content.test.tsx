import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import ko from "../../../messages/ko.json";
import ja from "../../../messages/ja.json";
import en from "../../../messages/en.json";

// Translator mock that keeps the key AND the interpolated values, so the
// empty-state assertions can see which message + which start label won.
vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, string>) =>
      values ? `${key}:${Object.values(values).join("|")}` : key,
}));
// Render only the empty fallback — that is the surface under test.
vi.mock("@/components/SetlistSection", () => ({
  SetlistSection: ({ emptyFallback }: { emptyFallback: ReactNode }) => (
    <div data-testid="setlist-section">{emptyFallback}</div>
  ),
}));
vi.mock("@/components/EventWishSection", () => ({
  EventWishSection: () => null,
}));

import { LiveSetlist } from "@/components/LiveSetlist";
import { EventPerformersPanel } from "@/components/event/EventPerformersPanel";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

const START = { date: "11월 14일", time: "16:30", zone: "JST" };
const OPENS = { date: "11월 7일", time: "16:30", zone: "JST" };

function renderEmpty(
  status: ResolvedEventStatus,
  labels: { start?: typeof START | null; opens?: typeof OPENS | null } = {},
) {
  return render(
    <LiveSetlist
      eventId="107"
      items={[]}
      reactionCounts={{}}
      top3Wishes={[]}
      initialTrendingSongs={[]}
      startTime={new Date("2026-11-14T07:30:00.000Z")}
      unknownSongLabel="?"
      isOngoing={status === "ongoing"}
      locale="ko"
      status={status}
      isWishPredictOpen={false}
      seriesName=""
      eventTitle="Day.1"
      dateLine=""
      availableSongs={[]}
      unitFilters={[]}
      setlistStartLabel={labels.start ?? null}
      predictOpensLabel={labels.opens ?? null}
    />,
  );
}

describe("LiveSetlist empty state", () => {
  it("upcoming: says when the setlist fills in, plus when predictions open", () => {
    renderEmpty("upcoming", { start: START, opens: OPENS });
    expect(
      screen.getByText("setlistUpcoming:11월 14일|16:30|JST"),
    ).toBeInTheDocument();
    expect(screen.getByText("predictOpensAt:11월 7일|16:30|JST")).toBeInTheDocument();
    expect(screen.queryByText("noSetlist")).toBeNull();
  });

  it("upcoming with the window already open: no predict-opens line", () => {
    renderEmpty("upcoming", { start: START });
    expect(screen.queryByText(/^predictOpensAt/)).toBeNull();
  });

  it("completed with no items: 'not recorded yet' wording", () => {
    renderEmpty("completed");
    expect(screen.getByText("setlistNotRecorded")).toBeInTheDocument();
  });

  it("ongoing keeps the original wording", () => {
    renderEmpty("ongoing");
    expect(screen.getByText("noSetlist")).toBeInTheDocument();
  });

  it("hides the zero items/songs subtitle", () => {
    renderEmpty("upcoming", { start: START });
    // The mock renders interpolated keys as `itemsLabel:0`, so match the
    // prefix — a bare-key lookup would pass even with the count shown.
    expect(screen.queryByText(/^itemsLabel:/)).toBeNull();
    expect(screen.queryByText(/songsValue:/)).toBeNull();
  });

  it("shows the items/songs subtitle once there are items (positive control)", () => {
    const item = { id: 1, type: "song", songs: [{ song: { id: 1 } }] };
    render(
      <LiveSetlist
        eventId="107"
        items={[item] as unknown as Parameters<typeof LiveSetlist>[0]["items"]}
        reactionCounts={{}}
        top3Wishes={[]}
        initialTrendingSongs={[]}
        startTime={new Date("2026-11-14T07:30:00.000Z")}
        unknownSongLabel="?"
        isOngoing={false}
        locale="ko"
        status="completed"
        isWishPredictOpen={false}
        seriesName=""
        eventTitle="Day.1"
        dateLine=""
        availableSongs={[]}
        unitFilters={[]}
      />,
    );
    expect(screen.getByText(/^itemsLabel:1/)).toBeInTheDocument();
  });
});

describe("lineup mode panel", () => {
  it("lineup headings, group + unit chips linked to their artist pages", () => {
    render(
      <EventPerformersPanel
        locale="ko"
        isLineup
        units={[
          { id: "1", slug: "hasunosora", name: "蓮ノ空", color: null, members: ["花帆"], kind: "group" },
          { id: "2", slug: "cerise-bouquet", name: "スリーズブーケ", color: "#e91e8c", members: ["花帆"], kind: "unit" },
        ]}
        performers={[]}
      />,
    );
    expect(screen.getByRole("list", { name: "lineupUnitsLabel" })).toBeInTheDocument();
    expect(screen.queryByText("unitsLabel")).toBeNull();
    expect(screen.getByText("蓮ノ空").closest("a")!.getAttribute("href")).toBe(
      "/ko/artists/1/hasunosora",
    );
    expect(
      screen.getByText("スリーズブーケ").closest("a")!.getAttribute("href"),
    ).toBe("/ko/artists/2/cerise-bouquet");
  });

  it("lineup heading and member-page links when a slug is set", () => {
    render(
      <EventPerformersPanel
        locale="ja"
        isLineup
        units={[]}
        performers={[{ id: "si-1", slug: "kaho", name: "花帆", color: "#e91e8c" }]}
      />,
    );
    expect(screen.getByText("lineupPerformersLabel")).toBeInTheDocument();
    expect(screen.getByText("花帆").closest("a")!.getAttribute("href")).toBe(
      "/ja/members/si-1/kaho",
    );
  });
});

describe("n08 i18n keys", () => {
  const keys = [
    "setlistUpcoming",
    "predictOpensAt",
    "setlistNotRecorded",
    "lineupPerformersLabel",
    "lineupUnitsLabel",
  ] as const;
  it.each([
    ["ko", ko],
    ["ja", ja],
    ["en", en],
  ])("%s has every new Event key", (_locale, messages) => {
    const event = (messages as unknown as { Event: Record<string, string> })
      .Event;
    for (const k of keys) expect(event[k], k).toBeTruthy();
    // The interpolated messages must keep all three placeholders.
    for (const k of ["setlistUpcoming", "predictOpensAt"] as const) {
      for (const p of ["{date}", "{time}", "{zone}"]) {
        expect(event[k]).toContain(p);
      }
    }
  });
});

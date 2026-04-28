import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  PerformanceGroup,
  type PerformanceSeries,
} from "@/components/PerformanceGroup";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

const STATUS_LABELS: Record<ResolvedEventStatus, string> = {
  ongoing: "LIVE",
  upcoming: "예정",
  completed: "종료",
  cancelled: "취소",
};

function makeSeries(overrides: Partial<PerformanceSeries> = {}): PerformanceSeries {
  return {
    seriesId: "s1",
    seriesShort: "5th Live Tour",
    hasOngoing: false,
    events: [
      {
        id: "e1",
        status: "completed",
        formattedDate: "12.07",
        name: "Day 2",
        href: "/ko/events/1/day-2",
      },
      {
        id: "e2",
        status: "completed",
        formattedDate: "12.06",
        name: "Day 1",
        href: "/ko/events/2/day-1",
      },
    ],
    ...overrides,
  };
}

describe("<PerformanceGroup />", () => {
  it("renders the series header + every event row by default (expanded)", () => {
    render(
      <PerformanceGroup
        series={makeSeries()}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    expect(screen.getByText("5th Live Tour")).toBeTruthy();
    expect(screen.getByText("Day 1")).toBeTruthy();
    expect(screen.getByText("Day 2")).toBeTruthy();
    expect(screen.getByText("2 events")).toBeTruthy();
  });

  it("collapses event rows when the header is clicked", () => {
    render(
      <PerformanceGroup
        series={makeSeries()}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    fireEvent.click(screen.getByText("5th Live Tour"));
    // Event rows should no longer be in the DOM.
    expect(screen.queryByText("Day 1")).toBeNull();
    expect(screen.queryByText("Day 2")).toBeNull();
    // Header itself stays.
    expect(screen.getByText("5th Live Tour")).toBeTruthy();
  });

  it("re-expands on a second click (toggle)", () => {
    render(
      <PerformanceGroup
        series={makeSeries()}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    const header = screen.getByText("5th Live Tour");
    fireEvent.click(header); // collapse
    fireEvent.click(header); // expand
    expect(screen.getByText("Day 1")).toBeTruthy();
    expect(screen.getByText("Day 2")).toBeTruthy();
  });

  it("renders a LIVE badge in the header when hasOngoing is true", () => {
    render(
      <PerformanceGroup
        series={makeSeries({ hasOngoing: true })}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    // The header LIVE badge + any in-row ongoing events would both
    // produce a "LIVE" string. The makeSeries() default has no
    // ongoing event in the rows, so a single match means the header
    // badge rendered as expected.
    expect(screen.getAllByText("LIVE").length).toBe(1);
  });

  it("renders the resolved status label per event row", () => {
    render(
      <PerformanceGroup
        series={makeSeries({
          events: [
            {
              id: "e1",
              status: "ongoing",
              formattedDate: "04.26",
              name: "Today",
              href: "/ko/events/1/today",
            },
            {
              id: "e2",
              status: "upcoming",
              formattedDate: "05.23",
              name: "Future",
              href: "/ko/events/2/future",
            },
          ],
        })}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.getByText("예정")).toBeTruthy();
  });

  it("renders the per-event `trailing` JSX in each row", () => {
    // `trailing` replaced the previous `renderTrailing` callback prop.
    // The callback couldn't be passed across the RSC boundary because
    // PerformanceGroup is a client component and React refuses to
    // serialize functions; pre-rendered ReactNode trees serialize fine.
    const series = makeSeries({
      events: [
        {
          id: "e1",
          status: "ongoing",
          formattedDate: "5/2",
          name: "Event 1",
          href: "/events/1",
          trailing: <span data-testid="trail-e1">·e1</span>,
        },
        {
          id: "e2",
          status: "upcoming",
          formattedDate: "5/3",
          name: "Event 2",
          href: "/events/2",
          trailing: <span data-testid="trail-e2">·e2</span>,
        },
      ],
    });
    render(
      <PerformanceGroup
        series={series}
        statusLabels={STATUS_LABELS}
        eventCountLabel="2 events"
      />,
    );
    expect(screen.getByTestId("trail-e1")).toBeTruthy();
    expect(screen.getByTestId("trail-e2")).toBeTruthy();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventHeader } from "@/components/EventHeader";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// next-intl `Link` → plain anchor for jsdom.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// EventStatusTicker is a client island that schedules router.refresh; just
// render nothing in tests so we don't need to mock next/navigation.
vi.mock("@/components/EventStatusTicker", () => ({
  default: () => null,
}));

// EventDateTime resolves an i18n-aware date string; tests don't need to
// validate that path here (it has its own coverage). Render the date in
// `data-testid` form so assertions can locate the slot.
vi.mock("@/components/EventDateTime", () => ({
  EventDateTime: ({ date }: { date: Date | string | null }) => (
    <span data-testid="event-date-time">{date ? "DATE" : ""}</span>
  ),
}));

describe("EventHeader", () => {
  const baseProps = {
    status: "upcoming" as const,
    statusLabel: "Upcoming",
    date: new Date("2026-05-02T19:00:00Z"),
    startTime: new Date("2026-05-02T19:00:00Z"),
    series: null,
    title: "Hasunosora 6th Live Fukuoka Day 1",
    subtitle: null,
    venue: "Marine Messe Fukuoka",
    city: "Fukuoka",
  };

  it("renders the title, status badge, and venue + city", () => {
    render(<EventHeader {...baseProps} />);
    expect(screen.getByText(baseProps.title)).toBeInTheDocument();
    expect(screen.getByText(baseProps.statusLabel)).toBeInTheDocument();
    expect(
      screen.getByText("Marine Messe Fukuoka, Fukuoka"),
    ).toBeInTheDocument();
  });

  it("renders the series link when series is present", () => {
    render(
      <EventHeader
        {...baseProps}
        series={{ id: 7, slug: "6th-live-fukuoka", shortName: "6th Live" }}
      />,
    );
    const seriesLink = screen.getByText("6th Live");
    expect(seriesLink.tagName).toBe("A");
    expect(seriesLink.getAttribute("href")).toBe(
      "/series/7/6th-live-fukuoka",
    );
  });

  it("omits the series link when series is null", () => {
    render(<EventHeader {...baseProps} series={null} />);
    // No <a> elements at all (status badge doesn't link, EventStatusTicker
    // is mocked to null). Title is an h1, not an anchor.
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders subtitle only when distinct from title", () => {
    const { rerender } = render(
      <EventHeader {...baseProps} subtitle="Day 1" />,
    );
    expect(screen.getByText("Day 1")).toBeInTheDocument();

    // null subtitle → not rendered
    rerender(<EventHeader {...baseProps} subtitle={null} />);
    expect(screen.queryByText("Day 1")).toBeNull();
  });

  it("falls back gracefully when only one of venue/city is present", () => {
    const { rerender } = render(
      <EventHeader {...baseProps} venue="Some Hall" city={null} />,
    );
    expect(screen.getByText("Some Hall")).toBeInTheDocument();

    rerender(<EventHeader {...baseProps} venue={null} city="Tokyo" />);
    expect(screen.getByText("Tokyo")).toBeInTheDocument();

    // Both null — no venue line
    rerender(<EventHeader {...baseProps} venue={null} city={null} />);
    expect(screen.queryByText(/Hall|Tokyo|,/)).toBeNull();
  });

  it("renders the date slot only when date is non-null", () => {
    const { rerender } = render(<EventHeader {...baseProps} />);
    expect(screen.getByTestId("event-date-time")).toBeInTheDocument();

    rerender(<EventHeader {...baseProps} date={null} />);
    expect(screen.queryByTestId("event-date-time")).toBeNull();
  });
});

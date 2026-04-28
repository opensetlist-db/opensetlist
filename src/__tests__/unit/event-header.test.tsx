import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventHeader } from "@/components/EventHeader";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// next/link → plain anchor for jsdom.
vi.mock("next/link", () => ({
  default: ({
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

// EventStartTime hits `useMounted` + Intl.DateTimeFormat; the time-row
// rendering is exercised by its own test. Stub it so the icon-row
// assertions stay focused on EventHeader's structural concerns.
vi.mock("@/components/EventStartTime", () => ({
  EventStartTime: () => <span data-testid="event-start-time">START</span>,
}));

describe("EventHeader", () => {
  const baseProps = {
    status: "upcoming" as const,
    statusLabel: "Upcoming",
    date: new Date("2026-05-02T19:00:00Z"),
    startTime: new Date("2026-05-02T19:00:00Z"),
    locale: "ko",
    artist: null,
    organizerName: null,
    series: null,
    title: "Hasunosora 6th Live Fukuoka Day 1",
    venue: "Marine Messe Fukuoka",
    city: "Fukuoka",
    songsCount: 18,
    reactionsValue: "1.2K",
  };

  it("renders the title and status badge label", () => {
    render(<EventHeader {...baseProps} />);
    expect(screen.getByText(baseProps.title)).toBeInTheDocument();
    expect(screen.getByText(baseProps.statusLabel)).toBeInTheDocument();
  });

  it("renders venue and city in their own icon rows (not joined)", () => {
    render(<EventHeader {...baseProps} />);
    // Each value sits in its own `<dd>` next to its labelled `<dt>`.
    expect(screen.getByText("Marine Messe Fukuoka")).toBeInTheDocument();
    expect(screen.getByText("Fukuoka")).toBeInTheDocument();
    // No joined "Venue, City" string from the previous flat layout.
    expect(screen.queryByText("Marine Messe Fukuoka, Fukuoka")).toBeNull();
  });

  it("renders the songs-count icon row via the songsValue ICU plural", () => {
    render(<EventHeader {...baseProps} songsCount={18} />);
    // The mocked translator returns the key verbatim — `songsValue`
    // is the ICU plural template; the assertion confirms the icon
    // row is being rendered (key resolves) without depending on the
    // locale-specific output shape.
    expect(screen.getByText("songsValue")).toBeInTheDocument();
  });

  it("renders the pre-formatted reactionsValue verbatim", () => {
    // Page formats via `Intl.NumberFormat({notation: "compact"})`
    // server-side so SSR/CSR can't diverge — EventHeader just
    // displays whatever string the page passed in. Verify both a
    // compact-notation value and a plain integer round-trip
    // unchanged by rerender-ing.
    const { rerender } = render(
      <EventHeader {...baseProps} reactionsValue="1.2K" />,
    );
    expect(screen.getByText("1.2K")).toBeInTheDocument();

    rerender(<EventHeader {...baseProps} reactionsValue="42" />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders the series link locale-prefixed when series is present", () => {
    render(
      <EventHeader
        {...baseProps}
        series={{ id: 7, slug: "6th-live-fukuoka", shortName: "6th Live" }}
      />,
    );
    const seriesLink = screen.getByText("6th Live");
    expect(seriesLink.tagName).toBe("A");
    expect(seriesLink.getAttribute("href")).toBe(
      "/ko/series/7/6th-live-fukuoka",
    );
  });

  it("renders the artist as a link to /{locale}/artists/{id}/{slug}", () => {
    render(
      <EventHeader
        {...baseProps}
        artist={{ id: "42", slug: "hasunosora", name: "蓮ノ空" }}
      />,
    );
    const artistLink = screen.getByText("蓮ノ空");
    expect(artistLink.tagName).toBe("A");
    expect(artistLink.getAttribute("href")).toBe("/ko/artists/42/hasunosora");
  });

  it("renders organizerName as plain text (no link) when artist is null", () => {
    render(
      <EventHeader
        {...baseProps}
        artist={null}
        organizerName="Bandai Namco / Lantis"
      />,
    );
    const text = screen.getByText("Bandai Namco / Lantis");
    expect(text.tagName).toBe("SPAN");
    expect(text.getAttribute("href")).toBeNull();
  });

  it("omits the artist line when both artist and organizerName are null", () => {
    render(<EventHeader {...baseProps} artist={null} organizerName={null} />);
    // No anchor links at all (series and artist both null in baseProps).
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders the start-time slot only when startTime is non-null", () => {
    const { rerender } = render(<EventHeader {...baseProps} />);
    expect(screen.getByTestId("event-start-time")).toBeInTheDocument();

    rerender(<EventHeader {...baseProps} startTime={null} />);
    expect(screen.queryByTestId("event-start-time")).toBeNull();
  });

  it("hides empty venue / city rows entirely (no orphan dt label)", () => {
    render(
      <EventHeader {...baseProps} venue={null} city={null} />,
    );
    // Venue + city rows omitted; their labels never render.
    expect(screen.queryByText("iconLabelVenue")).toBeNull();
    expect(screen.queryByText("iconLabelCity")).toBeNull();
  });
});

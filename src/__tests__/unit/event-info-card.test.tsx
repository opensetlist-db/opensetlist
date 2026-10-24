import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EventInfoCard } from "@/components/event/EventInfoCard";

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
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// EventStartTime hits `useMounted` + Intl.DateTimeFormat; its own test
// covers the formatting. Stubbed so these assertions stay structural.
vi.mock("@/components/EventStartTime", () => ({
  EventStartTime: () => <span data-testid="event-start-time">START</span>,
}));

describe("EventInfoCard", () => {
  const baseProps = {
    locale: "ko",
    date: new Date("2026-05-02T00:00:00Z"),
    startTime: new Date("2026-05-02T09:00:00Z"),
    venue: "Marine Messe Fukuoka",
    city: "Fukuoka",
    series: null,
    songsCount: 18,
    reactionsValue: "1.2K",
  };

  it("anchors the jump link target and titles the panel", () => {
    const { container } = render(<EventInfoCard {...baseProps} />);
    expect(container.querySelector("#event-info")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "infoTitle" })).toBeInTheDocument();
  });

  it("renders venue and city as separate facts (not joined)", () => {
    render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText("Marine Messe Fukuoka")).toBeInTheDocument();
    expect(screen.getByText("Fukuoka")).toBeInTheDocument();
    expect(screen.queryByText("Marine Messe Fukuoka, Fukuoka")).toBeNull();
  });

  it("renders the venue date from its UTC parts", () => {
    render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText("2026년 5월 2일")).toBeInTheDocument();
  });

  it("renders the songs count via the songsValue plural and the reactions verbatim", () => {
    render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText("songsValue")).toBeInTheDocument();
    expect(screen.getByText("1.2K")).toBeInTheDocument();
  });

  it("hides the songs and reactions rows while there is nothing to count", () => {
    // Positive control: with counts, both labelled rows are there.
    const { rerender } = render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText("iconLabelSongs")).toBeInTheDocument();
    expect(screen.getByText("iconLabelReactions")).toBeInTheDocument();
    rerender(<EventInfoCard {...baseProps} songsCount={0} reactionsValue={null} />);
    expect(screen.queryByText("iconLabelSongs")).toBeNull();
    expect(screen.queryByText("iconLabelReactions")).toBeNull();
  });

  it("links the series locale-prefixed with its DB slug", () => {
    render(
      <EventInfoCard
        {...baseProps}
        series={{ id: "7", slug: "6th-live", name: "6th Live Dream" }}
      />,
    );
    expect(screen.getByText("6th Live Dream").getAttribute("href")).toBe(
      "/ko/series/7/6th-live",
    );
  });

  it("links the series artist, or names the organizer when there is none", () => {
    const { rerender } = render(
      <EventInfoCard
        {...baseProps}
        artist={{ id: "42", slug: "hasunosora", name: "蓮ノ空" }}
        organizerName="Bandai Namco"
      />,
    );
    expect(screen.getByText("蓮ノ空").getAttribute("href")).toBe("/ko/artists/42/hasunosora");
    expect(screen.queryByText("Bandai Namco")).toBeNull();
    rerender(<EventInfoCard {...baseProps} artist={null} organizerName="Bandai Namco" />);
    expect(screen.getByText("Bandai Namco").tagName).toBe("DD");
    expect(screen.getByText("organizer")).toBeInTheDocument();
  });

  it("renders the start row only when startTime is set", () => {
    const { rerender } = render(<EventInfoCard {...baseProps} />);
    expect(screen.getByTestId("event-start-time")).toBeInTheDocument();
    rerender(<EventInfoCard {...baseProps} startTime={null} />);
    expect(screen.queryByTestId("event-start-time")).toBeNull();
  });

  it("drops empty venue / city rows entirely (no orphan label)", () => {
    // Positive control: the labels render while the values exist.
    const { rerender } = render(<EventInfoCard {...baseProps} />);
    expect(screen.getByText("venue")).toBeInTheDocument();
    expect(screen.getByText("iconLabelCity")).toBeInTheDocument();
    rerender(<EventInfoCard {...baseProps} venue={null} city={null} />);
    expect(screen.queryByText("venue")).toBeNull();
    expect(screen.queryByText("iconLabelCity")).toBeNull();
  });
});

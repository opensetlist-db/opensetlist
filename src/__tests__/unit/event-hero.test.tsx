import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { EventHero } from "@/components/event/EventHero";
import type { ResolvedEventStatus } from "@/lib/eventStatus";

// The ticker refreshes the route at status boundaries; nothing to assert
// here, and it needs the app router.
vi.mock("@/components/EventStatusTicker", () => ({ default: () => null }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function renderHero(status: ResolvedEventStatus, statusLabel: string) {
  return render(
    <EventHero
      status={status}
      statusLabel={statusLabel}
      startTimeIso={null}
      startLabel="10月9日 11:24 JST"
      logoUrl={null}
      logoTint={null}
      artTitle="Fes"
      series={null}
      title="リハーサル Day.1"
      dateLabel={null}
      venueLine={null}
    />,
  );
}

describe("EventHero", () => {
  it("marks the LIVE hero and shows the shared LIVE badge with its dot", () => {
    renderHero("ongoing", "LIVE");
    // The coral rule / warm wash hang off this attribute in the module.
    expect(screen.getByTestId("event-hero")).toHaveAttribute("data-status", "ongoing");
    const badge = screen.getByText("LIVE");
    // StatusBadge carries the label with an aria-hidden dot beside it, so
    // LIVE never depends on colour alone.
    expect(badge.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("リハーサル Day.1");
  });

  it("keeps the list pill for the other states (no LIVE dot)", () => {
    renderHero("completed", "終了");
    expect(screen.getByTestId("event-hero")).toHaveAttribute("data-status", "completed");
    expect(screen.getByText("終了").querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

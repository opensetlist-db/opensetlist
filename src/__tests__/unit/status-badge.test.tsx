import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/styles/tokens";
import { hexToRgbString } from "@/__tests__/utils/color";

describe("StatusBadge", () => {
  it("renders the supplied label", () => {
    render(<StatusBadge status="upcoming" label="Upcoming" />);
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("renders an animated dot only for ongoing", () => {
    const { rerender, container } = render(
      <StatusBadge status="ongoing" label="LIVE" />,
    );
    // Dot is the only span with `border-radius: 50%` inside the badge.
    const ongoingDot = container.querySelector('span[aria-hidden="true"]');
    expect(ongoingDot).not.toBeNull();
    // Animation must reference the global `live-pulse` keyframe (defined in
    // globals.css, PR #141 renamed it from `status-badge-pulse`).
    expect((ongoingDot as HTMLElement).style.animation).toContain("live-pulse");

    rerender(<StatusBadge status="upcoming" label="Upcoming" />);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();

    rerender(<StatusBadge status="completed" label="Completed" />);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();

    rerender(<StatusBadge status="cancelled" label="Cancelled" />);
    expect(container.querySelector('span[aria-hidden="true"]')).toBeNull();
  });

  it("uses the live (red) palette for ongoing", () => {
    render(<StatusBadge status="ongoing" label="LIVE" />);
    const badge = screen.getByText("LIVE");
    expect(badge.style.backgroundColor).toBe(hexToRgbString(colors.liveBg));
    expect(badge.style.color).toBe(hexToRgbString(colors.live));
    expect(badge.style.border).toContain(hexToRgbString(colors.liveBorder));
  });

  it("uses the upcoming (green) palette for upcoming", () => {
    render(<StatusBadge status="upcoming" label="Upcoming" />);
    const badge = screen.getByText("Upcoming");
    expect(badge.style.backgroundColor).toBe(hexToRgbString(colors.upcomingBg));
    expect(badge.style.color).toBe(hexToRgbString(colors.upcoming));
    expect(badge.style.border).toContain(hexToRgbString(colors.upcomingBorder));
  });

  it("uses the completed (gray) palette for completed", () => {
    render(<StatusBadge status="completed" label="Completed" />);
    const badge = screen.getByText("Completed");
    expect(badge.style.backgroundColor).toBe(
      hexToRgbString(colors.completedBg),
    );
    expect(badge.style.color).toBe(hexToRgbString(colors.completed));
  });

  it("uses the cancelled (lighter-gray + bordered) palette for cancelled", () => {
    // Cancelled palette is intentionally inlined in StatusBadge.tsx (handoff §5
    // doesn't promote these to tokens). Hard-code the exact hex values here so
    // a future drift in the component's CONFIG without a token rename gets
    // caught.
    render(<StatusBadge status="cancelled" label="Cancelled" />);
    const badge = screen.getByText("Cancelled");
    expect(badge.style.backgroundColor).toBe(hexToRgbString("#fafafa"));
    expect(badge.style.color).toBe(hexToRgbString(colors.textMuted));
    expect(badge.style.border).toContain(hexToRgbString("#e5e7eb"));
  });

  it("differs in padding/fontSize between size sm and md", () => {
    const { rerender, getByText } = render(
      <StatusBadge status="upcoming" label="Upcoming" size="sm" />,
    );
    const sm = getByText("Upcoming");
    const smPadding = sm.style.padding;
    const smFontSize = sm.style.fontSize;

    rerender(<StatusBadge status="upcoming" label="Upcoming" size="md" />);
    const md = getByText("Upcoming");
    expect(md.style.padding).not.toBe(smPadding);
    expect(md.style.fontSize).not.toBe(smFontSize);
  });

  it("defaults to size sm when no size prop is passed", () => {
    const { rerender, getByText } = render(
      <StatusBadge status="upcoming" label="A" />,
    );
    const defaultPadding = getByText("A").style.padding;
    const defaultFontSize = getByText("A").style.fontSize;

    rerender(<StatusBadge status="upcoming" label="A" size="sm" />);
    expect(getByText("A").style.padding).toBe(defaultPadding);
    expect(getByText("A").style.fontSize).toBe(defaultFontSize);
  });
});

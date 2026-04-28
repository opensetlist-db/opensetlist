import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnitsCard } from "@/components/event/UnitsCard";
import { hexToRgbString } from "@/__tests__/utils/color";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

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

describe("UnitsCard", () => {
  const sample = [
    {
      id: "10",
      slug: "cerise-bouquet",
      name: "Cerise Bouquet",
      color: "#e91e8c",
      members: ["花帆", "綴理"],
    },
    {
      id: "11",
      slug: "dollchestra",
      name: "DOLLCHESTRA",
      color: null,
      members: [],
    },
  ];

  it("renders nothing when units is empty", () => {
    const { container } = render(<UnitsCard locale="ko" units={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders one row per unit with a locale-prefixed link", () => {
    render(<UnitsCard locale="ko" units={sample} />);
    const cerise = screen.getByText("Cerise Bouquet");
    expect(cerise.tagName).toBe("A");
    expect(cerise.getAttribute("href")).toBe("/ko/artists/10/cerise-bouquet");

    const dollch = screen.getByText("DOLLCHESTRA");
    expect(dollch.getAttribute("href")).toBe("/ko/artists/11/dollchestra");
  });

  it("uses unit.color for the colored row when present", () => {
    render(<UnitsCard locale="ko" units={[sample[0]]} />);
    const link = screen.getByText("Cerise Bouquet");
    expect(link.style.color).toBe(hexToRgbString("#e91e8c"));
  });

  it("falls back to UNIT_COLOR_FALLBACK (= colors.primary) when unit.color is null", () => {
    // `resolveUnitColor` substitutes `colors.primary` (#0277BD)
    // when the unit has no `Artist.color` set yet — so the no-color
    // unit's name and bar both render with the brand-default tint
    // rather than a neutral gray.
    render(<UnitsCard locale="ko" units={[sample[1]]} />);
    const link = screen.getByText("DOLLCHESTRA");
    expect(link.style.color).toBe(hexToRgbString("#0277BD"));
  });

  it("renders the joined members sublist when members exist", () => {
    render(<UnitsCard locale="ko" units={[sample[0]]} />);
    expect(screen.getByText("花帆 · 綴理")).toBeInTheDocument();
  });

  it("omits the members sublist entirely when members is empty", () => {
    render(<UnitsCard locale="ko" units={[sample[1]]} />);
    // No `·` separator anywhere in the rendered output (the only
    // place that pattern appears is the joined sublist).
    expect(screen.queryByText(/·/)).toBeNull();
  });
});

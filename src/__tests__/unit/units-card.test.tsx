import { describe, it, expect, vi } from "vitest";
import type { ReactNode, CSSProperties } from "react";
import { render, screen } from "@testing-library/react";
import { UnitsCard } from "@/components/event/UnitsCard";
import { resolveUnitColor } from "@/lib/artistColor";
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
    children: ReactNode;
    className?: string;
    style?: CSSProperties;
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

  it("falls back to a deterministic palette color when unit.color is null", () => {
    // `resolveUnitColor` substitutes a palette pick keyed on the
    // unit's slug when `Artist.color` is null — so the no-color unit
    // gets a distinct hue rather than colliding with every other
    // color-pending unit on the same page. Test asserts the
    // rendered color matches the resolver's output for the same
    // input shape (slug + null color), which decouples the test
    // from any specific palette ordering / hash output.
    const expected = resolveUnitColor({ slug: "dollchestra", color: null });
    render(<UnitsCard locale="ko" units={[sample[1]]} />);
    const link = screen.getByText("DOLLCHESTRA");
    expect(link.style.color).toBe(hexToRgbString(expected));
  });

  it("renders the joined members sublist when members exist", () => {
    render(<UnitsCard locale="ko" units={[sample[0]]} />);
    expect(screen.getByText("花帆 · 綴理")).toBeInTheDocument();
  });

  it("omits the members sublist entirely when members is empty", () => {
    render(<UnitsCard locale="ko" units={[sample[1]]} />);
    // No `·` separator anywhere in the rendered output (the only
    // place that pattern appears is the joined sublist; guest
    // suffix path is also `·`-prefixed but isGuest is unset here).
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("appends the guest suffix when isGuest is true", () => {
    // D9: a guest unit (no host members at this event) gets a muted
    // "· {guestLabel}" suffix appended to its name. The mocked
    // useTranslations returns the i18n key verbatim, so the suffix
    // text reads "· guestLabel" in this test.
    const guestUnit = {
      id: "20",
      slug: "visiting-unit",
      name: "ヤママ娘",
      color: "#3949AB",
      members: [],
      isGuest: true,
    };
    render(<UnitsCard locale="ko" units={[guestUnit]} />);
    // The suffix renders as a child span of the unit Link.
    expect(screen.getByText(/·\s*guestLabel/)).toBeInTheDocument();
  });

  it("does not append the guest suffix when isGuest is false / unset", () => {
    render(<UnitsCard locale="ko" units={[sample[0]]} />);
    // sample[0] has no isGuest field — treated as host; no suffix.
    expect(screen.queryByText(/·\s*guestLabel/)).toBeNull();
  });
});

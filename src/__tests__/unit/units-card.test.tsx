import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnitsCard } from "@/components/event/UnitsCard";

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
    { id: "10", slug: "cerise-bouquet", name: "Cerise Bouquet", color: "#e91e8c" },
    { id: "11", slug: "dollchestra", name: "DOLLCHESTRA", color: null },
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
    // color is rendered as inline style; jsdom returns it as rgb(...)
    expect(link.style.color).not.toBe("");
  });
});

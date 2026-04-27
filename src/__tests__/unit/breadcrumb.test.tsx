import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "@/components/Breadcrumb";

// next-intl's `Link` is a thin wrapper around next/link that auto-prefixes
// the locale; the test renderer doesn't have an active locale, so swap it
// for a plain anchor that just preserves the href + children verbatim.
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

describe("Breadcrumb", () => {
  it("renders nothing when given an empty items array", () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each item in order with › separators between them", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Series", href: "/series/1" },
          { label: "Day 1" },
        ]}
      />,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Series")).toBeInTheDocument();
    expect(screen.getByText("Day 1")).toBeInTheDocument();

    // Two separators for three items (rendered between, not before/after).
    const separators = screen.getAllByText("›");
    expect(separators).toHaveLength(2);
  });

  it("renders href-bearing items as links and href-less items as non-clickable spans", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Current page" },
        ]}
      />,
    );
    const home = screen.getByText("Home");
    expect(home.tagName).toBe("A");
    expect(home.getAttribute("href")).toBe("/");

    const current = screen.getByText("Current page");
    expect(current.tagName).toBe("SPAN");
    expect(current.getAttribute("aria-current")).toBe("page");
  });

  it("uses an aria-label on the nav for assistive tech", () => {
    render(<Breadcrumb items={[{ label: "Home", href: "/" }]} />);
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("Breadcrumb");
  });

  it("hides the › separator from assistive tech", () => {
    render(
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "X" },
        ]}
      />,
    );
    const separator = screen.getByText("›");
    expect(separator.getAttribute("aria-hidden")).toBe("true");
  });
});

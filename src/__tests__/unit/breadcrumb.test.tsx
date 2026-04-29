import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumb } from "@/components/Breadcrumb";

// next/link's prefetch + router-context behavior isn't useful in
// jsdom; swap it for a plain anchor that preserves the href +
// children verbatim so href-shape assertions stay readable.
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

describe("Breadcrumb", () => {
  it("renders nothing when given an empty items array", () => {
    const { container } = render(<Breadcrumb ariaLabel="Breadcrumb" items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders each item in order with › separators between them", () => {
    render(
      <Breadcrumb
        ariaLabel="Breadcrumb"
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
        ariaLabel="Breadcrumb"
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

  it("renders the caller-supplied aria-label on the nav (must be locale-translated)", () => {
    render(
      <Breadcrumb
        ariaLabel="탐색 경로"
        items={[{ label: "Home", href: "/" }]}
      />,
    );
    const nav = screen.getByRole("navigation");
    expect(nav.getAttribute("aria-label")).toBe("탐색 경로");
  });

  it("hides the › separator from assistive tech", () => {
    render(
      <Breadcrumb
        ariaLabel="Breadcrumb"
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

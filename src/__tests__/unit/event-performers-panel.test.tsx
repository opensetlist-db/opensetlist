import { describe, it, expect, vi } from "vitest";
import type { ReactNode, CSSProperties } from "react";
import { render, screen, within } from "@testing-library/react";
import { EventPerformersPanel } from "@/components/event/EventPerformersPanel";
import { resolveUnitColor } from "@/lib/artistColor";

vi.mock("next-intl", () => ({
  useTranslations:
    () => (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
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

const units = [
  {
    id: "10",
    slug: "cerise-bouquet",
    name: "Cerise Bouquet",
    color: "#e91e8c",
    members: ["花帆", "綴理"],
  },
  { id: "11", slug: "dollchestra", name: "DOLLCHESTRA", color: null, members: [] },
];

function performer(i: number, extra: Record<string, unknown> = {}) {
  return { id: `si-${i}`, slug: `m${i}`, name: `メンバー${i}`, color: "#7B1FA2", ...extra };
}

describe("EventPerformersPanel", () => {
  it("renders nothing when both lists are empty", () => {
    const { container } = render(
      <EventPerformersPanel locale="ko" units={[]} performers={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders unit chips as locale-prefixed artist links", () => {
    render(<EventPerformersPanel locale="ko" units={units} performers={[]} />);
    const cerise = screen.getByText("Cerise Bouquet").closest("a")!;
    expect(cerise.getAttribute("href")).toBe("/ko/artists/10/cerise-bouquet");
    expect(screen.getByText("DOLLCHESTRA").closest("a")!.getAttribute("href")).toBe(
      "/ko/artists/11/dollchestra",
    );
  });

  it("feeds the unit colour (or its palette fallback) into --artist, never into text", () => {
    render(<EventPerformersPanel locale="ko" units={units} performers={[]} />);
    const cerise = screen.getByText("Cerise Bouquet").closest("a")!;
    expect(cerise.style.getPropertyValue("--artist")).toBe(units[0].color);
    expect(cerise.style.color).toBe("");
    const dollch = screen.getByText("DOLLCHESTRA").closest("a")!;
    expect(dollch.style.getPropertyValue("--artist")).toBe(
      resolveUnitColor({ slug: "dollchestra", color: null }),
    );
  });

  it("keeps a unit's performing members as the chip hint", () => {
    render(<EventPerformersPanel locale="ko" units={units} performers={[]} />);
    expect(screen.getByText("Cerise Bouquet").closest("a")!.getAttribute("title")).toBe(
      "花帆 · 綴理",
    );
    expect(screen.getByText("DOLLCHESTRA").closest("a")!.hasAttribute("title")).toBe(false);
  });

  it("marks guest units and guest performers, guests after hosts", () => {
    render(
      <EventPerformersPanel
        locale="ko"
        units={[{ ...units[0], isGuest: true }]}
        performers={[performer(9, { isGuest: true }), performer(1)]}
      />,
    );
    expect(screen.getByText(/·\s*guestLabel/)).toBeInTheDocument();
    const names = screen.getAllByText(/^メンバー/).map((el) => el.textContent);
    expect(names).toEqual(["メンバー1", "メンバー9"]);
    const guestCard = screen.getByText("メンバー9").closest("li")!;
    expect(within(guestCard).getByText("guestLabel")).toBeInTheDocument();
  });

  it("links performers with a slug to their member page", () => {
    render(
      <EventPerformersPanel
        locale="ja"
        units={[]}
        performers={[performer(1), { id: "si-x", name: "名無し", color: "#3949AB" }]}
      />,
    );
    expect(screen.getByText("メンバー1").closest("a")!.getAttribute("href")).toBe(
      "/ja/members/si-1/m1",
    );
    expect(screen.getByText("名無し").closest("a")).toBeNull();
  });

  it("shows six cards and folds the rest behind a 'more' disclosure", () => {
    const many = Array.from({ length: 9 }, (_, i) => performer(i + 1));
    const { container } = render(
      <EventPerformersPanel locale="ko" units={[]} performers={many} />,
    );
    const details = container.querySelector("details")!;
    expect(details).not.toBeNull();
    expect(within(details).getAllByText(/^メンバー/)).toHaveLength(3);
    expect(screen.getByText('performersMore:{"count":3}')).toBeInTheDocument();
    // The heading count is the whole roster, not just the open cards.
    expect(screen.getByText("9")).toBeInTheDocument();
  });

  it("uses the lineup headings before the show", () => {
    render(
      <EventPerformersPanel
        locale="ko"
        isLineup
        units={units}
        performers={[performer(1)]}
      />,
    );
    expect(screen.getByRole("heading", { name: "lineupPerformersLabel" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "lineupUnitsLabel" })).toBeInTheDocument();
    expect(screen.queryByText("performersLabel")).toBeNull();
  });
});

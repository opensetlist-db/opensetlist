import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

// Series identity panel (32-v1): the H1 is always the series name; a
// resolved logo image sits above it in the reserved slot, and a failed
// image removes the slot instead of retrying anything else.

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { SeriesIdentity } from "@/components/series/detail/SeriesIdentity";

// The resolver's source colour for the test series (an artist colour).
const ACCENT = "#FB8A9B";

const base = {
  typeLabel: "콘서트 투어",
  title: { text: "하스노소라 6th Live", lang: "ko" },
  subtitle: { text: "蓮ノ空 6th Live", lang: "ja" },
  meta: {
    kind: "artist" as const,
    label: "아티스트",
    href: "/artists/1/hasunosora",
    name: { text: "하스노소라", lang: "ko" },
  },
  description: null,
  metrics: [
    { label: "총 공연", value: "8회" },
    { label: "총 도시", value: "4개" },
    { label: "등장 곡", value: "35곡+" },
    { label: "유닛", value: "4팀" },
  ],
};

describe("<SeriesIdentity />", () => {
  it("typography: no logo slot, H1 + original subtitle with their languages", () => {
    const { container } = render(
      <SeriesIdentity {...base} logo={{ image: null, color: null }} />,
    );
    expect(screen.queryByTestId("series-logo")).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("하스노소라 6th Live");
    expect(h1.getAttribute("lang")).toBe("ko");
    expect(screen.getByText("蓮ノ空 6th Live").getAttribute("lang")).toBe("ja");
    // No colour → the CSS default accent (no inline custom property).
    expect((container.firstChild as HTMLElement).getAttribute("style")).toBeNull();
  });

  it("links the representative artist canonically and keeps four metrics", () => {
    render(<SeriesIdentity {...base} logo={{ image: null, color: null }} />);
    expect(screen.getByRole("link", { name: "하스노소라" }).getAttribute("href")).toBe(
      "/artists/1/hasunosora",
    );
    expect(screen.getAllByRole("term").map((n) => n.textContent)).toEqual([
      "총 공연",
      "총 도시",
      "등장 곡",
      "유닛",
    ]);
  });

  it("organizer fallback is plain text, not a link", () => {
    render(
      <SeriesIdentity
        {...base}
        meta={{ kind: "organizer", label: "주최", name: { text: "러브라이브! 시리즈", lang: "ko" } }}
        logo={{ image: null, color: null }}
      />,
    );
    expect(screen.getByText("러브라이브! 시리즈").tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("logo image above the H1; a failed image removes the slot, H1 stays", () => {
    const { container } = render(
      <SeriesIdentity
        {...base}
        logo={{
          image: { url: "https://img.example/qa-logo.webp", width: 720, height: 240 },
          color: ACCENT,
        }}
      />,
    );
    const slot = screen.getByTestId("series-logo");
    const img = slot.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://img.example/qa-logo.webp");
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--accent")).toBe(
      ACCENT,
    );

    fireEvent.error(img);
    expect(screen.queryByTestId("series-logo")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("하스노소라 6th Live");
  });
});

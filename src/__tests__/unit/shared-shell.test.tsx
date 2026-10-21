import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";

/*
 * Shared shell (redesign ticket 06): Nav menu behaviour, locale switch
 * query preservation, footer identity copy, and the EventArt / CoverImage
 * fallback contract from packet 03-v1.1.
 */

const replace = vi.fn();
let pathname = "/events";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  useLocale: () => "ko",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => pathname,
  useRouter: () => ({ replace }),
}));

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { Nav } from "@/components/Nav";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Footer } from "@/components/Footer";
import { EventArt } from "@/components/shared/EventArt";
import { CoverImage } from "@/components/shared/CoverImage";

beforeEach(() => {
  pathname = "/events";
  // jsdom has no matchMedia; Nav subscribes to the header threshold.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

describe("<Nav />", () => {
  it("keeps the four existing destinations and marks the active one", () => {
    render(<Nav />);
    const links = screen
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    for (const href of ["/", "/artists", "/events", "/albums"]) {
      expect(links).toContain(href);
    }
    const current = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.getAttribute("href"))).toEqual(["/events"]);
  });

  it("does not render a search entry while showSearch is off", () => {
    render(<Nav />);
    expect(screen.queryByRole("search")).toBeNull();
    expect(screen.queryByRole("link", { name: "search" })).toBeNull();
  });

  it("opens the menu, then Escape closes it and returns focus to the toggle", () => {
    render(<Nav />);
    const toggle = screen.getByRole("button", { name: "openMenu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menuId = toggle.getAttribute("aria-controls");
    expect(menuId && document.getElementById(menuId)).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(menuId && document.getElementById(menuId)).toBeFalsy();
    expect(document.activeElement).toBe(toggle);
  });

  it("closes the menu on an outside pointer press", () => {
    render(<Nav />);
    const toggle = screen.getByRole("button", { name: "openMenu" });
    fireEvent.click(toggle);
    fireEvent.mouseDown(document.body);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

describe("<LanguageSwitcher />", () => {
  it("keeps the query string and hash when switching locale", () => {
    pathname = "/events";
    window.history.replaceState(null, "", "/ko/events?page=2&type=past#top");
    render(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    expect(replace).toHaveBeenCalledWith("/events?page=2&type=past#top", {
      locale: "ja",
    });
  });

  it("does nothing when the active locale is chosen, but still reports the selection", () => {
    const onSelect = vi.fn();
    render(<LanguageSwitcher variant="menu" onSelect={onSelect} />);
    const active = screen.getByRole("button", { name: "한국어" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    expect(replace).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("<Footer />", () => {
  it("shows the unofficial statement, legal links, contact and UTC year", () => {
    pathname = "/privacy";
    render(<Footer />);
    expect(screen.getByText("unofficial")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "privacy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "contact" })).toHaveAttribute(
      "href",
      "mailto:help@opensetlist.com",
    );
    expect(
      screen.getByText(
        `copyright:${JSON.stringify({ year: new Date().getUTCFullYear() })}`,
      ),
    ).toBeInTheDocument();
  });
});

describe("<EventArt />", () => {
  it("renders typography when no logo is set", () => {
    render(<EventArt title="러브라이브! 페스" eyebrow="LoveLive! Series" />);
    const art = screen.getByTestId("event-art");
    expect(art).toHaveAttribute("data-state", "fallback");
    expect(art).toHaveTextContent("러브라이브! 페스");
    expect(art.querySelector("img")).toBeNull();
  });

  it("renders the logo contained, and falls back to typography in the same region on error", () => {
    render(<EventArt title="Fes" logoUrl="https://example.test/logo.png" />);
    const art = screen.getByTestId("event-art");
    const img = art.querySelector("img")!;
    expect(img).toHaveClass("object-contain");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    const regionClass = art.className;

    fireEvent.error(img);
    expect(art).toHaveAttribute("data-state", "fallback");
    expect(art).toHaveTextContent("Fes");
    // Same reserved geometry before and after the failure.
    expect(art.className).toBe(regionClass);
  });

  it("hides eyebrow/caption in the compact variant", () => {
    render(
      <EventArt variant="compact" title="T" eyebrow="E" caption="C" />,
    );
    const art = screen.getByTestId("event-art");
    expect(art).toHaveTextContent("T");
    expect(art).not.toHaveTextContent("E");
    expect(art).not.toHaveTextContent("C");
  });
});

describe("<CoverImage />", () => {
  it("keeps a square slot with a localized label when the image is missing", () => {
    render(<CoverImage size={92} />);
    const slot = screen.getByTestId("cover-image");
    expect(slot).toHaveAttribute("data-state", "fallback");
    expect(slot.style.width).toBe("92px");
    expect(slot.style.height).toBe("92px");
    expect(slot).toHaveTextContent("noImage");
  });

  it("uses no-referrer and falls back on load error without resizing", () => {
    render(<CoverImage size={44} src="https://example.test/c.jpg" alt="Album" />);
    const slot = screen.getByTestId("cover-image");
    const img = slot.querySelector("img")!;
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    fireEvent.error(img);
    expect(slot).toHaveAttribute("data-state", "fallback");
    expect(slot.style.width).toBe("44px");
    // Small slot: glyph only, but the named cover keeps its accessible name.
    expect(slot).not.toHaveTextContent("noImage");
    expect(screen.getByRole("img", { name: "Album" })).toBe(slot);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// Translators echo the key so assertions read the contract, not one
// locale's copy.
const echo = (ns?: string) => (key: string) => (ns ? `${ns}.${key}` : key);

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async (ns?: string) => echo(ns)),
}));
// Locale-aware Link → plain anchor with the locale prefix the real one adds.
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={`/ko${href}`} {...rest}>
      {children}
    </a>
  ),
}));

import LegalLayout from "@/components/legal/LegalLayout";
import privacyKo from "@/content/privacy/ko";
import termsEn from "@/content/terms/en";

async function renderLegal(page: "privacy" | "terms", locale: string) {
  const el = await LegalLayout({ page, locale });
  return render(el as ReactElement);
}

describe("LegalLayout", () => {
  it("renders every source section, in order, with its original anchor id", async () => {
    const { container } = await renderLegal("privacy", "ko");
    const sections = [...container.querySelectorAll("article section")];
    expect(sections.map((s) => s.id)).toEqual(
      privacyKo.sections.map((s) => s.id),
    );
    // h1 → h2 (section) → h3 (subgroup) outline.
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(privacyKo.sections.map((s) => s.title));
    expect(
      screen.getByRole("heading", { level: 3, name: "자동 수집 정보 (제3자 처리자)" }),
    ).toBeInTheDocument();
    // Each section is labelled by its heading and focusable for TOC jumps.
    expect(sections[0]).toHaveAttribute("aria-labelledby", "heading-collection");
    expect(sections[0]).toHaveAttribute("tabindex", "-1");
  });

  it("keeps the preamble, UTC revision date, inline code and mailto contact", async () => {
    const { container } = await renderLegal("privacy", "ko");
    expect(screen.getByText(privacyKo.intro!)).toBeInTheDocument();
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-04-22T00:00:00Z");
    expect(time?.textContent).toContain("2026");
    expect(
      [...container.querySelectorAll("code")].map((c) => c.textContent),
    ).toContain("opensetlist_anon_id");
    expect(
      container.querySelector('a[href="mailto:help@opensetlist.com"]'),
    ).not.toBeNull();
  });

  it("renders both TOCs (sidebar + mobile disclosure) linking the same ids", async () => {
    const { container } = await renderLegal("terms", "en");
    const tocs = screen.getAllByRole("navigation", { name: "legal.tocLabel" });
    expect(tocs).toHaveLength(2);
    const ids = termsEn.sections.map((s) => `#${s.id}`);
    for (const toc of tocs) {
      expect(
        within(toc)
          .getAllByRole("link")
          .map((a) => a.getAttribute("href")),
      ).toEqual(ids);
    }
    expect(container.querySelector("details summary")?.textContent).toBe(
      "legal.tocLabel",
    );
  });

  it("moves focus to the target section after a TOC jump", async () => {
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb) => {
        cb(0);
        return 0;
      });
    try {
      const { container } = await renderLegal("terms", "en");
      const [toc] = screen.getAllByRole("navigation", { name: "legal.tocLabel" });
      const link = within(toc).getAllByRole("link")[1];
      fireEvent.click(link);
      expect(document.activeElement).toBe(
        container.querySelector(`#${termsEn.sections[1].id}`),
      );
    } finally {
      raf.mockRestore();
    }
  });

  it("marks the current page in both page switchers and links the other page", async () => {
    await renderLegal("privacy", "ko");
    const switchers = screen.getAllByRole("navigation", {
      name: "legal.legalNavLabel",
    });
    expect(switchers).toHaveLength(2);
    for (const nav of switchers) {
      const current = within(nav).getByRole("link", { current: "page" });
      expect(current).toHaveAttribute("href", "/ko/privacy");
      expect(
        within(nav).getByRole("link", { name: "legal.termsTitle" }),
      ).toHaveAttribute("href", "/ko/terms");
    }
    expect(
      screen.getByRole("link", { name: "legal.bottomLinkViewTerms" }),
    ).toHaveAttribute("href", "/ko/terms");
    // Breadcrumb: Home link + current page.
    const crumbs = screen.getByRole("navigation", { name: "Common.breadcrumb" });
    expect(within(crumbs).getByRole("link")).toHaveAttribute("href", "/ko");
  });

  it("falls back to the unavailable notice without TOC, date or cross-page CTA", async () => {
    // Positive control: the same page in a real locale has every element
    // the fallback must drop, so the absence checks below can't pass
    // because the selectors are wrong.
    const real = await renderLegal("privacy", "ko");
    expect(
      screen.getAllByRole("navigation", { name: "legal.tocLabel" }),
    ).toHaveLength(2);
    expect(real.container.querySelector("details")).not.toBeNull();
    expect(real.container.querySelector("time")).not.toBeNull();
    expect(
      screen.getByRole("link", { name: "legal.bottomLinkViewTerms" }),
    ).toBeInTheDocument();
    real.unmount();

    const { container } = await renderLegal("privacy", "zh");
    expect(screen.getByText("legal.unavailableInLocale")).toBeInTheDocument();
    expect(
      screen.queryAllByRole("navigation", { name: "legal.tocLabel" }),
    ).toHaveLength(0);
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("time")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "legal.bottomLinkViewTerms" }),
    ).toBeNull();
    // The page switcher stays so the reader can still move between pages.
    expect(
      screen.getAllByRole("navigation", { name: "legal.legalNavLabel" }),
    ).toHaveLength(2);
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// Translators echo the key (plus vars) so assertions read the contract,
// not one locale's copy.
const echo = (ns?: string) => (key: string, vars?: Record<string, unknown>) => {
  const full = ns ? `${ns}.${key}` : key;
  return vars ? `${full}:${JSON.stringify(vars)}` : full;
};

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async (opts?: string | { namespace?: string }) =>
    echo(typeof opts === "string" ? opts : opts?.namespace),
  ),
}));
vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => echo(ns),
}));
type Href = { pathname: string; query?: Record<string, string>; hash?: string };
const serialise = (href: Href) => {
  const q =
    href.query && Object.keys(href.query).length
      ? `?${new URLSearchParams(href.query)}`
      : "";
  return `${href.pathname}${q}${href.hash ? `#${href.hash}` : ""}`;
};
// Locale-aware Link → plain anchor with the query serialised, enough to
// assert the filter and pager hrefs. `redirect` throws like the real one
// (it never returns), carrying the target for assertions.
const nav = vi.hoisted(() => ({
  RedirectError: class RedirectError extends Error {
    constructor(
      readonly target: string,
      readonly locale: string,
    ) {
      super(`redirect ${target}`);
    }
  },
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: Href;
    children: ReactNode;
  }) => (
    <a href={serialise(href)} {...rest}>
      {children}
    </a>
  ),
  redirect: ({ href, locale }: { href: Href; locale: string }) => {
    throw new nav.RedirectError(serialise(href), locale);
  },
}));

const lib = vi.hoisted(() => ({
  getAlbumsPage: vi.fn(),
  getAlbumArtistFilters: vi.fn(),
}));
vi.mock("@/lib/albums", async (orig) => ({
  ...(await orig<typeof import("@/lib/albums")>()),
  getAlbumsPage: lib.getAlbumsPage,
  getAlbumArtistFilters: lib.getAlbumArtistFilters,
}));

import { AlbumListRow } from "@/components/albums/AlbumListRow";
import { AlbumListCover } from "@/components/albums/AlbumListCover";
import { AlbumArtistFilter } from "@/components/albums/AlbumArtistFilter";
import { AlbumPagination } from "@/components/albums/AlbumPagination";
import { ALBUMS_PER_PAGE } from "@/lib/albums";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function album(over: Record<string, unknown> = {}): Any {
  return {
    id: 135,
    slug: "bloom-the-smile",
    type: "single",
    releaseDate: "2024-03-13",
    imageUrl: null,
    originalTitle: "Bloom the smile, Bloom the dream!",
    originalLanguage: "ja",
    translations: [{ locale: "ko", title: "블룸 더 스마일" }],
    artists: [],
    listings: [],
    ...over,
  };
}

async function renderRow(props: Record<string, unknown> = {}) {
  const el = await AlbumListRow({
    album: album(),
    locale: "ko",
    activeBonusCount: 0,
    ...props,
  } as Any);
  return render(el as ReactElement);
}

describe("AlbumListRow", () => {
  it("is one canonical album link with the artist as plain text", async () => {
    const { container } = await renderRow({ artistName: "하스노소라" });
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe(
      "/ko/albums/135/bloom-the-smile",
    );
    expect(screen.getByText("하스노소라").tagName).toBe("SPAN");
  });

  it("falls back to the id-only canonical for an empty slug", async () => {
    const { container } = await renderRow({ album: album({ slug: "" }) });
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/ko/albums/135",
    );
  });

  it("shows the original title with the viewer-locale title and year below", async () => {
    const { container } = await renderRow();
    expect(screen.getByText("Bloom the smile, Bloom the dream!")).toBeTruthy();
    // Secondary line: translation + mobile year; the desktop year span
    // is a sibling (CSS shows one per band).
    const sub = container.querySelector('[class*="rowSub"]');
    expect(sub?.textContent).toBe("블룸 더 스마일 · 2024");
    expect(container.querySelector('[class*="year"]:not([class*="mobileYear"])')?.textContent).toBe("2024");
  });

  it("omits the secondary title without a translation and the year when undated", async () => {
    // Positive control: the same album with a date prints its year.
    const dated = await renderRow({ album: album({ translations: [] }) });
    expect(dated.container.querySelector('[class*="rowSub"]')?.textContent).toBe("2024");
    dated.unmount();
    const { container } = await renderRow({
      album: album({ translations: [], releaseDate: null }),
    });
    expect(container.querySelector('[class*="rowSub"]')?.textContent).toBe("");
    expect(container.textContent).not.toMatch(/\d{4}/);
  });

  it("labels the type pill and the active-bonus badge", async () => {
    const { container } = await renderRow({ activeBonusCount: 3 });
    const type = container.querySelector("[data-type]");
    expect(type?.getAttribute("data-type")).toBe("single");
    expect(type?.textContent).toBe("Album.type.single");
    const badge = screen.getByRole("img");
    expect(badge.getAttribute("aria-label")).toBe(
      'Album.albumActiveBonuses:{"count":3}',
    );
    expect(badge.textContent).toBe('Album.albumActiveBonusesBadge:{"count":3}');
  });

  it("renders no badge without active bonuses", async () => {
    await renderRow();
    // Positive control: the row and its meta line rendered.
    expect(screen.getByText("Album.type.single")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("AlbumListCover", () => {
  it("shows the localized no-image fallback for a missing cover", () => {
    const { container } = render(<AlbumListCover src={null} />);
    const slot = container.firstElementChild!;
    expect(slot.getAttribute("data-state")).toBe("fallback");
    expect(slot.getAttribute("aria-hidden")).toBe("true");
    expect(slot.textContent).toContain("SharedImage.noImage");
  });

  it("loads an external cover lazily without a referrer and falls back on error", () => {
    const { container } = render(
      <AlbumListCover src="https://m.media-amazon.com/images/I/x.jpg" />,
    );
    const img = container.querySelector("img")!;
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("alt")).toBe("");
    fireEvent.error(img);
    expect(container.querySelector("img")).toBeNull();
    expect(container.firstElementChild?.getAttribute("data-state")).toBe(
      "fallback",
    );
  });
});

describe("AlbumArtistFilter", () => {
  const options = [
    { id: "1", name: "하스노소라" },
    { id: "109", name: "이키즈라이부!" },
  ];

  it("is omitted with one option or none", async () => {
    expect(await AlbumArtistFilter({ active: null, options: [options[0]] })).toBeNull();
    expect(await AlbumArtistFilter({ active: null, options: [] })).toBeNull();
  });

  it("links All + each artist and marks the active one current", async () => {
    const el = await AlbumArtistFilter({ active: "109", options });
    const { container } = render(el as ReactElement);
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/albums",
      "/albums?artist=1",
      "/albums?artist=109",
    ]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([
      null,
      null,
      "page",
    ]);
    // Full names as the visible text.
    expect(links[1].textContent).toBe("하스노소라");
  });
});

describe("AlbumPagination", () => {
  async function renderPager(page: number, totalPages: number, artist: string | null = null) {
    const el = await AlbumPagination({ page, totalPages, artist });
    return el ? render(el as ReactElement) : null;
  }
  const items = (container: HTMLElement) =>
    [...container.querySelector("nav")!.children].map((e) => ({
      tag: e.tagName,
      text: e.textContent,
      href: e.getAttribute("href"),
      current: e.getAttribute("aria-current"),
      disabled: e.getAttribute("aria-disabled"),
    }));

  it("renders nothing for a single page", async () => {
    expect(await renderPager(1, 1)).toBeNull();
    // Positive control: two pages do render a pager.
    expect(await renderPager(1, 2)).not.toBeNull();
  });

  it("disables Previous on page 1 and links canonical page URLs", async () => {
    const { container } = (await renderPager(1, 24))!;
    expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Album.pagination.aria",
    );
    const prev = { href: null, current: null };
    expect(items(container)).toEqual([
      { tag: "SPAN", text: "Album.pagination.prev", ...prev, disabled: "true" },
      { tag: "SPAN", text: "1", href: null, current: "page", disabled: null },
      { tag: "A", text: "2", href: "/albums?page=2#album-results", current: null, disabled: null },
      { tag: "SPAN", text: "…", href: null, current: null, disabled: null },
      { tag: "A", text: "24", href: "/albums?page=24#album-results", current: null, disabled: null },
      {
        tag: "A",
        text: "Album.pagination.next",
        href: "/albums?page=2#album-results",
        current: null,
        disabled: null,
      },
    ]);
  });

  it("keeps the artist filter, drops ?page= for page 1, disables Next at the end", async () => {
    const { container } = (await renderPager(4, 4, "1"))!;
    const list = items(container);
    expect(list[0].href).toBe("/albums?artist=1&page=3#album-results");
    expect(list[1]).toMatchObject({ text: "1", href: "/albums?artist=1#album-results" });
    expect(list.at(-2)).toMatchObject({ text: "4", current: "page" });
    expect(list.at(-1)).toMatchObject({ tag: "SPAN", disabled: "true" });
  });

  it("gives page numbers an accessible page name and hides the ellipsis", async () => {
    const { container } = (await renderPager(10, 24))!;
    const current = container.querySelector('[aria-current="page"]')!;
    expect(current.getAttribute("aria-label")).toBe(
      'Album.pagination.pageLabel:{"page":10}',
    );
    const gaps = [...container.querySelectorAll("nav > span")].filter(
      (e) => e.textContent === "…",
    );
    expect(gaps).toHaveLength(2);
    for (const gap of gaps) expect(gap.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("AlbumsPage", () => {
  type Sp = { artist?: string | string[]; page?: string | string[] };
  async function runPage(sp: Sp) {
    const { default: AlbumsPage } = await import("@/app/[locale]/albums/page");
    return AlbumsPage({
      params: Promise.resolve({ locale: "ko" }),
      searchParams: Promise.resolve(sp),
    });
  }
  async function redirectOf(sp: Sp) {
    try {
      await runPage(sp);
    } catch (e) {
      if (e instanceof nav.RedirectError) return `${e.locale}:${e.target}`;
      throw e;
    }
    return null;
  }
  // The filter is an async server component; the page tree is checked
  // structurally instead of rendered. The page's own props are read back
  // from the JSON tree.
  const tree = (el: unknown) =>
    JSON.stringify(el, (_k, v) => (typeof v === "function" ? v.name : v));
  const pageResult = (albums: unknown[], total: number) => ({
    albums,
    total,
    totalPages: Math.ceil(total / ALBUMS_PER_PAGE),
  });

  it("shows the empty panel, without summary or pager, for no albums", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([]);
    lib.getAlbumsPage.mockResolvedValue(pageResult([], 0));
    const json = tree(await runPage({}));
    expect(json).toContain("Album.noAlbums");
    expect(json).not.toContain("album-results");
    expect(json).not.toContain("AlbumPagination");
    expect(lib.getAlbumsPage).toHaveBeenCalledWith("ko", undefined, 1);
  });

  it("renders this page's year sections, summary and pager", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([]);
    lib.getAlbumsPage.mockResolvedValue(
      pageResult([album(), album({ id: 136, slug: "x", releaseDate: null })], 42),
    );
    const json = tree(await runPage({ page: "3" }));
    expect(lib.getAlbumsPage).toHaveBeenLastCalledWith("ko", undefined, 3);
    expect(json).toContain("AlbumListRow");
    expect(json).toContain("album-year-2024");
    expect(json).toContain("album-year-undated");
    expect(json).toContain(`Album.yearPageCount:${JSON.stringify(JSON.stringify({ count: 1 })).slice(1, -1)}`);
    // Rows 41–42 of 42: the range ends at the last row actually shown.
    const summary = JSON.stringify({
      total: 42,
      start: 41,
      end: 42,
      perPage: ALBUMS_PER_PAGE,
      page: 3,
      totalPages: 3,
    });
    expect(json).toContain(
      `Album.pagination.summary:${JSON.stringify(summary).slice(1, -1)}`,
    );
    expect(json).toContain("AlbumPagination");
    expect(json).not.toContain("Album.noAlbums");
  });

  it("validates ?artist=: unknown → all, repeated → first", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([
      { id: "1", name: "A" },
      { id: "109", name: "B" },
    ]);
    lib.getAlbumsPage.mockResolvedValue(pageResult([album()], 1));
    expect(await redirectOf({ artist: "109" })).toBeNull();
    expect(lib.getAlbumsPage).toHaveBeenLastCalledWith("ko", BigInt(109), 1);
    // Unknown → the unfiltered list, and the URL drops the filter.
    expect(await redirectOf({ artist: "999" })).toBe("ko:/albums");
    expect(lib.getAlbumsPage).toHaveBeenLastCalledWith("ko", undefined, 1);
    // Repeated → the first, spelled once.
    expect(await redirectOf({ artist: ["109", "1"] })).toBe("ko:/albums?artist=109");
    expect(lib.getAlbumsPage).toHaveBeenLastCalledWith("ko", BigInt(109), 1);
  });

  // generateMetadata never receives searchParams, so every `?page=` /
  // `?artist=` variant shares the bare list's canonical and hreflang set
  // (the concert list's rule). The origin comes from the site-URL env.
  it("keeps the canonical on the bare list for any filter or page", async () => {
    const { generateMetadata } = await import("@/app/[locale]/albums/page");
    const { absoluteUrl } = await import("@/lib/seo/entityUrl");
    const meta = await generateMetadata({ params: Promise.resolve({ locale: "ja" }) });
    expect(meta.alternates?.canonical).toBe(absoluteUrl("/ja/albums"));
    expect(meta.alternates?.languages).toMatchObject({
      ko: absoluteUrl("/ko/albums"),
      en: absoluteUrl("/en/albums"),
      "x-default": absoluteUrl("/ja/albums"),
    });
  });

  it.each([
    [{ page: "1" }, "ko:/albums"],
    [{ page: "abc" }, "ko:/albums"],
    [{ page: "0" }, "ko:/albums"],
    [{ page: "-3" }, "ko:/albums"],
    [{ page: "" }, "ko:/albums"],
    [{ page: "02" }, "ko:/albums?page=2"],
    [{ page: ["2", "3"] }, "ko:/albums?page=2"],
    [{ page: "25" }, "ko:/albums?page=24"],
    [{ page: "99999999999999999999" }, "ko:/albums?page=24"],
    [{ artist: "1", page: "x" }, "ko:/albums?artist=1"],
    [{ artist: "1", page: "30" }, "ko:/albums?artist=1&page=24"],
    [{ artist: "999", page: "1" }, "ko:/albums"],
  ] as const)("redirects %j to %s", async (sp, target) => {
    lib.getAlbumArtistFilters.mockResolvedValue([
      { id: "1", name: "A" },
      { id: "109", name: "B" },
    ]);
    lib.getAlbumsPage.mockResolvedValue(pageResult([], 474));
    expect(await redirectOf(sp as Sp)).toBe(target);
  });

  it("does not redirect canonical URLs", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([
      { id: "1", name: "A" },
      { id: "2", name: "B" },
    ]);
    lib.getAlbumsPage.mockResolvedValue(pageResult([album()], 474));
    expect(await redirectOf({})).toBeNull();
    expect(await redirectOf({ page: "2" })).toBeNull();
    expect(await redirectOf({ page: "24" })).toBeNull();
    expect(await redirectOf({ artist: "1", page: "3" })).toBeNull();
  });

  it("sends any page of an empty result to the bare list", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([]);
    lib.getAlbumsPage.mockResolvedValue(pageResult([], 0));
    expect(await redirectOf({ page: "3" })).toBe("ko:/albums");
    // Positive control: the bare list itself renders (empty panel).
    expect(await redirectOf({})).toBeNull();
  });
});

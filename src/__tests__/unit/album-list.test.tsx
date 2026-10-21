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
// Locale-aware Link → plain anchor with the query serialised, enough to
// assert the filter hrefs.
vi.mock("@/i18n/navigation", () => ({
  Link: ({
    href,
    children,
    ...rest
  }: {
    href: { pathname: string; query?: Record<string, string> };
    children: ReactNode;
  }) => {
    const q = href.query ? `?${new URLSearchParams(href.query)}` : "";
    return (
      <a href={`${href.pathname}${q}`} {...rest}>
        {children}
      </a>
    );
  },
}));

const lib = vi.hoisted(() => ({
  getAlbums: vi.fn(),
  getAlbumArtistFilters: vi.fn(),
}));
vi.mock("@/lib/albums", async (orig) => ({
  ...(await orig<typeof import("@/lib/albums")>()),
  getAlbums: lib.getAlbums,
  getAlbumArtistFilters: lib.getAlbumArtistFilters,
}));

import { AlbumListRow } from "@/components/albums/AlbumListRow";
import { AlbumListCover } from "@/components/albums/AlbumListCover";
import { AlbumArtistFilter } from "@/components/albums/AlbumArtistFilter";

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
    // Full names, no truncation title fallback.
    expect(links[1].textContent).toBe("하스노소라");
    expect(links[1].getAttribute("title")).toBeNull();
  });
});

describe("AlbumsPage", () => {
  it("shows the empty panel when the catalog has no albums", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([]);
    lib.getAlbums.mockResolvedValue([]);
    const { default: AlbumsPage } = await import("@/app/[locale]/albums/page");
    const el = await AlbumsPage({
      params: Promise.resolve({ locale: "ko" }),
      searchParams: Promise.resolve({}),
    });
    // The filter is an async server component; the page tree is checked
    // structurally instead of rendered.
    const json = JSON.stringify(el, (_k, v) =>
      typeof v === "function" ? v.name : v,
    );
    expect(json).toContain("Album.noAlbums");
    expect(json).not.toContain("AlbumListRow");
    expect(lib.getAlbums).toHaveBeenCalledWith("ko", undefined);
  });

  it("validates ?artist=: unknown → all, repeated → first", async () => {
    lib.getAlbumArtistFilters.mockResolvedValue([
      { id: "1", name: "A" },
      { id: "109", name: "B" },
    ]);
    lib.getAlbums.mockResolvedValue([]);
    const { default: AlbumsPage } = await import("@/app/[locale]/albums/page");
    await AlbumsPage({
      params: Promise.resolve({ locale: "ko" }),
      searchParams: Promise.resolve({ artist: "999" }),
    });
    expect(lib.getAlbums).toHaveBeenLastCalledWith("ko", undefined);
    await AlbumsPage({
      params: Promise.resolve({ locale: "ko" }),
      searchParams: Promise.resolve({ artist: ["109", "1"] }),
    });
    expect(lib.getAlbums).toHaveBeenLastCalledWith("ko", BigInt(109));
  });
});

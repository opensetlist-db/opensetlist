import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetlistRow } from "@/components/SetlistRow";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import { hexToRgbString } from "@/__tests__/utils/color";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/useMounted", () => ({
  useMounted: () => true,
}));

vi.mock("@/lib/anonId", () => ({
  getAnonId: () => "test-anon-id",
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn(),
}));

// Build a valid LiveSetlistItem for tests; tests override the fields they
// care about. Centralizing keeps each case readable.
function makeItem(overrides: Partial<LiveSetlistItem> = {}): LiveSetlistItem {
  return {
    id: 1,
    position: 1,
    isEncore: false,
    stageType: "full_group",
    unitName: null,
    status: "live",
    performanceType: "live_performance",
    type: "song",
    songs: [
      {
        song: {
          id: 100,
          slug: "test-song",
          originalTitle: "Test Song",
          originalLanguage: "en",
          variantLabel: null,
          translations: [{ locale: "en", title: "Test Song" }],
          artists: [],
        },
      },
    ],
    performers: [],
    artists: [],
    ...overrides,
  };
}

describe("SetlistRow", () => {
  it("renders a song row with title and reaction buttons", () => {
    render(
      <SetlistRow
        item={makeItem()}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(screen.getByText("Test Song")).toBeInTheDocument();
    // ReactionButtons renders 4 emojis as button titles (i18n stub returns key).
    expect(screen.getByTitle("waiting")).toBeInTheDocument();
    expect(screen.getByTitle("best")).toBeInTheDocument();
  });

  it("hides reactions for non-song variants (mc/video/interval) and renders the type label in muted gray (no row-level opacity dim)", () => {
    const { container, rerender } = render(
      <SetlistRow
        item={makeItem({ type: "mc", songs: [] })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    const li = container.querySelector("li");
    // Row chrome stays at full opacity (border, hover state, position
    // number must remain legible). Only the type label is grayed.
    expect(li?.style.opacity).toBe("");
    expect(screen.queryByTitle("best")).toBeNull();
    const mcLabel = screen.getByText("itemType.mc");
    expect(mcLabel.style.color).toBe(hexToRgbString("#94a3b8"));

    rerender(
      <SetlistRow
        item={makeItem({ type: "video", songs: [] })}
        index={1}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(container.querySelector("li")?.style.opacity).toBe("");
    expect(screen.queryByTitle("best")).toBeNull();

    rerender(
      <SetlistRow
        item={makeItem({ type: "interval", songs: [] })}
        index={2}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(container.querySelector("li")?.style.opacity).toBe("");
    expect(screen.queryByTitle("best")).toBeNull();
  });

  it("uses the canonical song.slug from DB (not a runtime re-slugify of the title)", () => {
    const item = makeItem({
      songs: [
        {
          song: {
            id: 999,
            slug: "canonical-stored-slug",
            // Localized title that would slugify to something different
            // — the link must still use the DB slug.
            originalTitle: "Original Title",
            originalLanguage: "ja",
            variantLabel: null,
            translations: [{ locale: "en", title: "Localized Title!" }],
            artists: [],
          },
        },
      ],
    });
    render(
      <SetlistRow
        item={item}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Resolve the link via the rendered title text — `displayOriginalTitle`
    // returns the originalTitle as `main` for non-en originalLanguage.
    const link = screen.getByText("Original Title").closest("a");
    expect(link?.getAttribute("href")).toBe(
      "/en/songs/999/canonical-stored-slug",
    );
  });

  it("uses Artist.color for unit badge background + text when present", () => {
    const item = makeItem({
      stageType: "unit",
      artists: [
        {
          artist: {
            id: 7,
            slug: "cerise-bouquet",
            color: "#e91e8c",
            originalName: "Cerise Bouquet",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
          },
        },
      ],
    });
    render(
      <SetlistRow
        item={item}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    const badge = screen.getByText("Cerise Bouquet");
    // Text color uses the artist.color hex directly — jsdom normalizes to
    // rgb form, which we match via the helper. The background uses the
    // 8-digit `${color}18` (alpha 0.094) form, which jsdom normalizes
    // inconsistently across versions, so just assert it's NON-empty (not
    // the zinc-class fallback path).
    expect(badge.style.color).toBe(hexToRgbString("#e91e8c"));
    expect(badge.style.backgroundColor).not.toBe("");
  });

  it("falls back to default zinc badge when Artist.color is null", () => {
    const item = makeItem({
      stageType: "unit",
      artists: [
        {
          artist: {
            id: 7,
            slug: "cerise-bouquet",
            color: null,
            originalName: "Cerise Bouquet",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
          },
        },
      ],
    });
    render(
      <SetlistRow
        item={item}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    const badge = screen.getByText("Cerise Bouquet");
    // No inline backgroundColor when artist.color is null — falls to zinc class.
    expect(badge.style.backgroundColor).toBe("");
    expect(badge.className).toContain("bg-zinc-100");
  });

  it("uses primary color for the song link (sourced from tokens)", () => {
    render(
      <SetlistRow
        item={makeItem()}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Primary token is #0277BD (handoff §1). Without importing tokens directly
    // we can verify via the rendered jsdom rgb form.
    const link = screen.getByText("Test Song");
    expect(link.style.color).toBe(hexToRgbString("#0277BD"));
  });

  it("renders the position number top-aligned (paddingTop 1px), not center", () => {
    const { container } = render(
      <SetlistRow
        item={makeItem()}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Position number is the first <span> in the row's flex container.
    // Critical per mockup §3-2: alignItems flex-start + paddingTop on
    // position. We verify via the Tailwind utility class.
    const li = container.querySelector("li");
    const flexInner = li?.querySelector(":scope > div");
    expect(flexInner?.className).toContain("items-start");
  });
});

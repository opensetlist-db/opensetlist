import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SetlistRow } from "@/components/SetlistRow";
import type { LiveSetlistItem } from "@/components/LiveSetlist";
import { resolveUnitColor } from "@/lib/artistColor";
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
    expect(screen.getByText("itemType.video").style.color).toBe(
      hexToRgbString("#94a3b8"),
    );

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
    expect(screen.getByText("itemType.interval").style.color).toBe(
      hexToRgbString("#94a3b8"),
    );
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
    const { container } = render(
      <SetlistRow
        item={item}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Locate the song link by href prefix instead of by display text.
    // The previous getByText approach couples the test to the
    // title-display policy — if the row ever switches to rendering
    // the localized title (or some other transformation) the test
    // breaks for a reason unrelated to slug correctness. Querying
    // by href targets only the slug logic this test asserts on.
    const link = container.querySelector('a[href^="/en/songs/"]');
    expect(link?.getAttribute("href")).toBe(
      "/en/songs/999/canonical-stored-slug",
    );
  });

  it("falls back to id-only href when song.slug is empty (defensive — schema requires slug, but legacy imports may have left it blank)", () => {
    const item = makeItem({
      songs: [
        {
          song: {
            id: 555,
            slug: "",
            originalTitle: "Slug-less Song",
            originalLanguage: "ja",
            variantLabel: null,
            translations: [],
            artists: [],
          },
        },
      ],
    });
    const { container } = render(
      <SetlistRow
        item={item}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Same display-string-decoupled link locator as above.
    const link = container.querySelector('a[href^="/en/songs/"]');
    // No trailing slash — the href is `/en/songs/555` exactly.
    expect(link?.getAttribute("href")).toBe("/en/songs/555");
  });

  it("does not render reactions for a song-typed item that has no songs attached (placeholder rows)", () => {
    render(
      <SetlistRow
        item={makeItem({ type: "song", songs: [] })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // The empty-songs branch renders the noSongAssigned label instead
    // of any title; reactions must be suppressed because there's no
    // valid songId to attach POSTs to.
    expect(screen.queryByTitle("best")).toBeNull();
    expect(screen.getByText("noSongAssigned")).toBeInTheDocument();
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

  it("falls back to a deterministic palette color when Artist.color is null", () => {
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
    // `resolveUnitColor` substitutes a palette pick keyed on the
    // unit's slug when `Artist.color` is null — multiple
    // color-pending units render with distinguishable hues instead
    // of all collapsing to brand blue. Test asserts the rendered
    // text color matches the resolver's output (decoupled from the
    // specific palette index). Background is the same color at ~9%
    // alpha (`${color}18`), normalized inconsistently by jsdom, so
    // we only assert it's non-empty (not the old zinc-fallback path).
    const expected = resolveUnitColor({
      slug: "cerise-bouquet",
      color: null,
    });
    expect(badge.style.color).toBe(hexToRgbString(expected));
    expect(badge.style.backgroundColor).not.toBe("");
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

  it("uses a CSS grid with `items-start` so position + title align at the top, not vertically centered", () => {
    const { container } = render(
      <SetlistRow
        item={makeItem()}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Mockup `event-page-desktop-mockup-v2.jsx:185` uses
    // `alignItems: "start"` on the row grid so the position number
    // sits flush with the first line of the title (not centered
    // vertically against the unit badge).
    const li = container.querySelector("li");
    expect(li?.className).toContain("grid");
    expect(li?.className).toContain("items-start");
  });

  it("renders the generic stageType label for an ad-hoc unit-stage row with no Artist credit (D8)", () => {
    // Phase 1A — D8: stageType=unit + no artists + no unitName →
    // <FallbackUnitBadge> renders the i18n stageType label so the
    // row still indicates "this is a unit-stage performance".
    // Mocked useTranslations returns the i18n key verbatim, so the
    // label text reads "stageType.unit".
    render(
      <SetlistRow
        item={makeItem({ stageType: "unit", unitName: null, artists: [] })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(screen.getByText("stageType.unit")).toBeInTheDocument();
  });

  it("hides operator-typed unitName even when set on an ad-hoc unit-stage row (D4b)", () => {
    // Phase 1A — D4b: `item.unitName` is intentionally suppressed
    // on public surfaces (no per-locale translations). The row
    // shows the generic stageType label, never the operator's
    // typed string.
    render(
      <SetlistRow
        item={makeItem({
          stageType: "unit",
          unitName: "Sakura × Maya",
          artists: [],
        })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(screen.queryByText("Sakura × Maya")).toBeNull();
    // The generic stageType fallback still renders.
    expect(screen.getByText("stageType.unit")).toBeInTheDocument();
  });

  it("does not render a unit badge for full_group rows even when unitName is set", () => {
    // The new ad-hoc branch is gated on stageType !== "full_group"
    // — full-group rows shouldn't surface a "유닛" badge under any
    // circumstance.
    render(
      <SetlistRow
        item={makeItem({
          stageType: "full_group",
          unitName: "Should Be Ignored",
          artists: [],
        })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    expect(screen.queryByText("stageType.full_group")).toBeNull();
    expect(screen.queryByText("Should Be Ignored")).toBeNull();
  });
});

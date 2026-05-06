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
          baseVersionId: null,
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
            baseVersionId: null,
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
            baseVersionId: null,
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
            type: "unit",
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
            type: "unit",
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

  it("renders FallbackUnitBadge when stageType=unit but the credited Artist is solo-type (F18 ad-hoc case)", () => {
    // F18 — event 43 "Love it!" / "Wonderful Trip!" reproducer.
    // Operator entered the song with one performing member's solo
    // Artist row as `SetlistItemArtist`. Pre-fix: `<UnitBadge>`
    // rendered the solo Artist's name with `resolveUnitColor`'s
    // slug-hashed palette tint ("one performer name with a mystery
    // color"). Post-fix: the typed gate suppresses the UnitBadge,
    // so the existing FallbackUnitBadge branch fires the generic
    // stageType label — matching PR #190 D4b's "never expose
    // half-formed unit data publicly" rule.
    const { container } = render(
      <SetlistRow
        item={makeItem({
          stageType: "unit",
          artists: [
            {
              artist: {
                id: 99,
                slug: "sayaka-solo",
                type: "solo",
                color: null,
                originalName: "Sayaka",
                originalShortName: null,
                originalLanguage: "ja",
                translations: [],
              },
            },
          ],
          performers: [
            {
              stageIdentity: {
                id: "si-sayaka",
                originalName: "Sayaka",
                originalShortName: null,
                originalLanguage: "ja",
                translations: [],
                artistLinks: [],
              },
              realPerson: null,
            },
            {
              stageIdentity: {
                id: "si-tsuzuri",
                originalName: "Tsuzuri",
                originalShortName: null,
                originalLanguage: "ja",
                translations: [],
                artistLinks: [],
              },
              realPerson: null,
            },
          ],
        })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="42"
      />,
    );
    // Generic stageType label fires (FallbackUnitBadge branch).
    expect(screen.getByText("stageType.unit")).toBeInTheDocument();
    // The solo Artist's name must NOT appear as a UnitBadge link in
    // the title block. (Sayaka may still appear in the desktop col-3
    // performer list, which is plain text — not an artist-page link.)
    expect(
      container.querySelector('a[href="/en/artists/99/sayaka-solo"]'),
    ).toBeNull();
  });

  it("renders the solo Artist's UnitBadge for a true solo song (no regression)", () => {
    // Solo songs (stageType="solo" + artist.type="solo") still render
    // the credited solo Artist as a UnitBadge — the typed gate honors
    // this case unchanged.
    const item = makeItem({
      stageType: "solo",
      artists: [
        {
          artist: {
            id: 11,
            slug: "kaho-solo",
            type: "solo",
            color: "#ffb74d",
            originalName: "Kaho",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
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
    const badge = screen.getByText("Kaho");
    expect(badge.style.color).toBe(hexToRgbString("#ffb74d"));
    expect(
      container.querySelector('a[href="/en/artists/11/kaho-solo"]'),
    ).not.toBeNull();
    // Generic stageType label must NOT also fire on top of the badge.
    expect(screen.queryByText("stageType.solo")).toBeNull();
  });

  it("renders UnitBadge for stageType=special with a group-type Artist credit (parent group as special)", () => {
    // The F18 suppression is narrowly scoped to "solo-type Artist on
    // a non-solo stage type". Other type combinations stay unchanged
    // — including group-type Artist on a "special" row (e.g. the
    // parent Hasunosora group performing as a special encore). This
    // test locks that behavior in so a future refactor of the typed
    // gate can't silently regress it.
    const item = makeItem({
      stageType: "special",
      artists: [
        {
          artist: {
            id: 1,
            slug: "hasunosora",
            type: "group",
            color: "#0277BD",
            originalName: "Hasunosora",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
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
    expect(screen.getByText("Hasunosora")).toBeInTheDocument();
    expect(
      container.querySelector('a[href="/en/artists/1/hasunosora"]'),
    ).not.toBeNull();
    // FallbackUnitBadge for "stageType.special" must NOT also fire.
    expect(screen.queryByText("stageType.special")).toBeNull();
  });

  it("renders FallbackUnitBadge for stageType=special with a solo-type Artist credit (F18 misfire on special)", () => {
    // Companion to the "special + group-type" test above. The F18
    // misfire predicate is `artist.type === "solo" && stageType !==
    // "solo"`, so it fires for `special + solo` as well as `unit +
    // solo`. Locks in the suppression on the special branch so a
    // future refactor (e.g. simplifying the gate to only check
    // stageType === "unit") can't silently regress it.
    const item = makeItem({
      stageType: "special",
      artists: [
        {
          artist: {
            id: 55,
            slug: "member-solo",
            type: "solo",
            color: "#ffb74d",
            originalName: "Member",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
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
    expect(screen.getByText("stageType.special")).toBeInTheDocument();
    expect(
      container.querySelector('a[href="/en/artists/55/member-solo"]'),
    ).toBeNull();
  });

  it("comma-joins multiple performer names in the desktop performer column", () => {
    // The col-3 performer list (`item.performers.map(...).join(", ")`,
    // SetlistRow.tsx:203) is desktop-only (`hidden lg:block`). Locks
    // in the lineup display so a future regression on the title-block
    // gate doesn't silently break the per-row member listing too.
    const item = makeItem({
      stageType: "unit",
      artists: [],
      performers: [
        {
          stageIdentity: {
            id: "si-sayaka",
            originalName: "Sayaka",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
            artistLinks: [],
          },
          realPerson: null,
        },
        {
          stageIdentity: {
            id: "si-tsuzuri",
            originalName: "Tsuzuri",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
            artistLinks: [],
          },
          realPerson: null,
        },
        {
          stageIdentity: {
            id: "si-yuyu",
            originalName: "Yuyu",
            originalShortName: null,
            originalLanguage: "ja",
            translations: [],
            artistLinks: [],
          },
          realPerson: null,
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
    expect(screen.getByText("Sayaka, Tsuzuri, Yuyu")).toBeInTheDocument();
  });
});

describe("SetlistRow — rowState prop (Phase 1B/1C scaffold)", () => {
  it("default (no rowState passed): renders the position as a span (byte-equiv with pre-refactor)", () => {
    render(
      <SetlistRow
        item={makeItem()}
        index={2}
        reactionCounts={{}}
        locale="en"
        eventId="1"
      />,
    );
    // Position 3 (index + 1) renders as a span, not a button.
    const position = screen.getByText("3");
    expect(position.tagName.toLowerCase()).toBe("span");
    // No interactive ARIA labels for the rumoured/my-confirmed
    // states.
    expect(screen.queryByRole("button", { name: "confirmAriaRumoured" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "confirmAriaMyConfirmed" }),
    ).toBeNull();
  });

  it("rowState=\"confirmed\": no gray bg on the <li>", () => {
    const { container } = render(
      <SetlistRow
        item={makeItem()}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="1"
        rowState="confirmed"
      />,
    );
    const li = container.querySelector("li")!;
    // Default: no inline background style (relies on the section
    // card's white bg).
    expect(li.style.background).toBe("");
  });

  it("rowState=\"rumoured\": gray bg + [?] dotted button", () => {
    const { container } = render(
      <SetlistRow
        item={makeItem({ status: "rumoured" })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="1"
        rowState="rumoured"
      />,
    );
    const li = container.querySelector("li")!;
    // colors.bgSubtle is #f8fafc → rgb(248, 250, 252).
    expect(li.style.background.toLowerCase()).toContain(
      "rgb(248, 250, 252)",
    );
    // [?] button rendered with the rumouredLabel ARIA.
    const btn = screen.getByRole("button", { name: "confirmAriaRumoured" });
    expect(btn.textContent).toBe("?");
    expect(btn.getAttribute("style")).toContain("dashed");
  });

  it("rowState=\"my-confirmed\": gray bg + [✓] sky-blue button", () => {
    const { container } = render(
      <SetlistRow
        item={makeItem({ status: "rumoured" })}
        index={0}
        reactionCounts={{}}
        locale="en"
        eventId="1"
        rowState="my-confirmed"
      />,
    );
    const li = container.querySelector("li")!;
    expect(li.style.background.toLowerCase()).toContain(
      "rgb(248, 250, 252)",
    );
    const btn = screen.getByRole("button", { name: "confirmAriaMyConfirmed" });
    expect(btn.textContent).toBe("✓");
    expect(btn.getAttribute("style")).toContain("solid");
  });

  it("reactions still render on rumoured rows (regression: wiki/conflicts.md #8)", () => {
    render(
      <SetlistRow
        item={makeItem({ status: "rumoured" })}
        index={0}
        reactionCounts={{ "1": { best: 5, waiting: 3 } }}
        locale="en"
        eventId="1"
        rowState="rumoured"
      />,
    );
    // ReactionButtons render as buttons with reaction-type ARIA
    // labels (mocked to the i18n key value). At minimum the
    // four standard reaction buttons should be present alongside
    // the [?] confirm button.
    const buttons = screen.getAllByRole("button");
    // 4 reactions + 1 confirm slot = at least 5 buttons.
    expect(buttons.length).toBeGreaterThanOrEqual(5);
    expect(
      screen.getByRole("button", { name: "confirmAriaRumoured" }),
    ).toBeTruthy();
  });
});

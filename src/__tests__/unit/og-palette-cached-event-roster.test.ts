import { describe, it, expect } from "vitest";
import { collectArtistRosterFromCachedEvent } from "@/lib/ogPalette";

// Stage-link fixture builder. Mirrors the runtime shape of
// `CachedEventForOgPalette["eventSeries"]["artist"]["stageLinks"]` —
// only `stageIdentity.color` is read by the helper.
function stageLinks(...colors: Array<string | null>) {
  return colors.map((color) => ({ stageIdentity: { color } }));
}

describe("collectArtistRosterFromCachedEvent — own-first then parent fallback", () => {
  it("uses the artist's OWN stageLinks when non-empty, ignoring parent", () => {
    // Sub-unit with its own 3 members AND a parent group whose roster
    // would otherwise dominate. Own-first wins — the parent's 9
    // members never contribute. This is the semantic shift vs the
    // prior "always use root" rule: a Cerise-headlined event now
    // surfaces Cerise's palette, not Hasunosora's.
    const artist = {
      color: "#cf3a52", // unread by this helper; surfaced for realism
      stageLinks: stageLinks("#cf3a52", "#f5a623", "#7ed321"),
      parentArtist: {
        stageLinks: stageLinks(
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
          "#abcdef",
        ),
      },
    };
    const freq = collectArtistRosterFromCachedEvent(artist);
    expect(freq.size).toBe(3);
    expect(freq.has("#cf3a52")).toBe(true);
    expect(freq.has("#f5a623")).toBe(true);
    expect(freq.has("#7ed321")).toBe(true);
    expect(freq.has("#abcdef")).toBe(false);
  });

  it("falls back to parent roster when artist's own stageLinks is empty", () => {
    // Sub-unit row whose own StageIdentityArtist join returned zero
    // valid-hex colors — every member could have a null color, the
    // sub-unit might be a stub awaiting member assignment, etc. The
    // parent group's roster takes over.
    const artist = {
      color: null,
      stageLinks: stageLinks(null, null), // no valid hex
      parentArtist: {
        stageLinks: stageLinks("#0277bd", "#7b1fa2", "#0277bd"),
      },
    };
    const freq = collectArtistRosterFromCachedEvent(artist);
    expect(freq.size).toBe(2);
    expect(freq.get("#0277bd")).toBe(2);
    expect(freq.get("#7b1fa2")).toBe(1);
  });

  it("returns an empty map when own is empty and parent is absent", () => {
    // Root group whose own stageLinks happens to be empty (a fresh
    // Artist row with no StageIdentityArtist links yet). Nothing to
    // fall back to; the palette assembly later harmonizes from the
    // brand fallback.
    const artist = {
      color: "#0277bd",
      stageLinks: stageLinks(),
      parentArtist: null,
    };
    const freq = collectArtistRosterFromCachedEvent(artist);
    expect(freq.size).toBe(0);
  });

  it("returns an empty map when artist itself is null", () => {
    // Multi-artist festival case: `EventSeries.artistId` is null, so
    // the page's `getEvent` leaves `eventSeries.artist === null`. The
    // helper's callers pass null through; the palette assembly later
    // falls through to brand harmonization.
    const freq = collectArtistRosterFromCachedEvent(null);
    expect(freq.size).toBe(0);
  });
});

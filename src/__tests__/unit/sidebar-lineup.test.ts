import { describe, it, expect } from "vitest";
import {
  deriveLineupFromRoster,
  deriveSidebarUnitsAndPerformers,
} from "@/lib/sidebarDerivations";
import type {
  EventRosterEntry,
  LiveSetlistItem,
  RosterArtist,
} from "@/lib/types/setlist";

// Fixture shaped after the real 15th Fes roster: two host groups, a
// cross-group collab group (AiScReam-style) linking one member of
// each, main + derivative units, solo "artists", and one guest.
function artist(
  id: number,
  slug: string,
  type: RosterArtist["type"],
  opts: Partial<RosterArtist> = {},
): RosterArtist {
  return {
    id,
    slug,
    type,
    color: null,
    parentArtistId: null,
    isMainUnit: false,
    isDeleted: false,
    originalName: slug,
    originalShortName: null,
    originalLanguage: "ja",
    translations: [],
    ...opts,
  };
}

const hasu = artist(1, "hasunosora", "group", { originalName: "蓮ノ空" });
const niji = artist(24, "nijigasaki", "group", { originalName: "虹ヶ咲" });
const ikizurai = artist(44, "ikizurai-bu", "group");
const collab = artist(200, "aiscream", "group");
const cerise = artist(2, "cerise-bouquet", "unit", {
  parentArtistId: 1,
  isMainUnit: true,
  color: "#e91e8c",
});
const gelato = artist(3, "kaho-megu-gelato", "unit", { parentArtistId: 1 });
const azuna = artist(25, "azuna", "unit", { parentArtistId: 24, isMainUnit: true });
const chaki = artist(45, "chaki", "unit", { parentArtistId: 44 });
const callMe = artist(46, "call-me", "unit", { parentArtistId: 44 });
const solo = (id: number, parent: number) =>
  artist(id, `solo-${id}`, "solo", { parentArtistId: parent });

function member(
  id: string,
  links: RosterArtist[],
  isGuest = false,
): EventRosterEntry {
  return {
    isGuest,
    stageIdentity: {
      id,
      slug: `slug-${id}`,
      originalName: id,
      originalShortName: null,
      originalLanguage: "ja",
      translations: [],
      artistLinks: links.map((a) => ({ artist: a })),
    },
  };
}

const roster: EventRosterEntry[] = [
  member("kaho", [hasu, cerise, gelato, solo(100, 1)]),
  member("ginko", [hasu, cerise, solo(101, 1)]),
  // Collab group listed FIRST for this member — the headcount rule must
  // still file her under 蓮ノ空.
  member("ceras", [collab, hasu, solo(102, 1)]),
  member("ayumu", [niji, azuna, collab, solo(103, 24)]),
  member("shizuku", [niji, azuna]),
  member("yuu", [niji, solo(104, 24)], true),
  member("polka", [ikizurai, chaki, callMe]),
];

describe("deriveLineupFromRoster", () => {
  const lineup = deriveLineupFromRoster(roster, "ko", "?", "??");

  it("files every member under their home group, never the collab group", () => {
    expect(lineup.groups.map((g) => g.slug)).toEqual([
      "hasunosora",
      "nijigasaki",
      "ikizurai-bu",
    ]);
  });

  it("emits a group header row followed by that group's units", () => {
    expect(lineup.units.map((u) => [u.kind, u.slug])).toEqual([
      ["group", "hasunosora"],
      // Main-unit filter: Cerise shown, the derivative pair hidden.
      ["unit", "cerise-bouquet"],
      ["group", "nijigasaki"],
      ["unit", "azuna"],
      ["group", "ikizurai-bu"],
      // No main unit flagged → all of the group's units shown.
      ["unit", "chaki"],
      ["unit", "call-me"],
    ]);
  });

  it("lists host members per group/unit and keeps guests out of them", () => {
    const bySlug = new Map(lineup.units.map((u) => [u.slug, u]));
    expect(bySlug.get("hasunosora")!.members).toEqual(["kaho", "ginko", "ceras"]);
    expect(bySlug.get("cerise-bouquet")!.members).toEqual(["kaho", "ginko"]);
    expect(bySlug.get("nijigasaki")!.members).toEqual(["ayumu", "shizuku"]);
    expect(bySlug.get("nijigasaki")!.isGuest).toBe(false);
  });

  it("never shows solo artists as units", () => {
    expect(lineup.units.some((u) => u.slug.startsWith("solo-"))).toBe(false);
  });

  it("orders pills by section, guests last, with slugs for member links", () => {
    expect(lineup.performers.map((p) => p.id)).toEqual([
      "kaho",
      "ginko",
      "ceras",
      "ayumu",
      "shizuku",
      "polka",
      "yuu",
    ]);
    expect(lineup.performers.at(-1)!.isGuest).toBe(true);
    expect(lineup.performers[0].slug).toBe("slug-kaho");
  });

  it("tints a pill by its shown unit, else its group", () => {
    const kaho = lineup.performers.find((p) => p.id === "kaho")!;
    expect(kaho.color).toBe("#e91e8c");
    // ceras has no shown unit → falls back to the group's resolved color
    // (deterministic palette pick, never empty).
    const ceras = lineup.performers.find((p) => p.id === "ceras")!;
    expect(ceras.color).toMatch(/^#/);
  });

  it("marks a group with only guest members as guest and sorts it last", () => {
    const other = artist(300, "visiting", "group");
    const l = deriveLineupFromRoster(
      [member("guest-a", [other], true), member("host", [hasu])],
      "ko",
      "?",
      "??",
    );
    expect(l.groups.map((g) => [g.slug, g.isGuest])).toEqual([
      ["hasunosora", false],
      ["visiting", true],
    ]);
  });

  it("ignores soft-deleted artists", () => {
    const deleted = artist(400, "deleted-group", "group", { isDeleted: true });
    const l = deriveLineupFromRoster([member("x", [deleted, hasu])], "ko", "?", "??");
    expect(l.groups.map((g) => g.slug)).toEqual(["hasunosora"]);
  });

  it("returns empty lists for an empty roster", () => {
    expect(deriveLineupFromRoster([], "ko", "?", "??")).toEqual({
      units: [],
      performers: [],
      groups: [],
    });
  });
});

describe("deriveSidebarUnitsAndPerformers (unchanged by the lineup)", () => {
  it("still derives nothing from an empty setlist — the lineup is a separate path", () => {
    const items: LiveSetlistItem[] = [];
    expect(
      deriveSidebarUnitsAndPerformers(
        items,
        [{ stageIdentityId: "kaho", isGuest: false }],
        "ko",
        "?",
        "??",
      ),
    ).toEqual({ units: [], performers: [] });
  });
});

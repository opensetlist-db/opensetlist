import { createHash } from "node:crypto";
import { converter, formatHex, parse } from "culori";
import { prisma } from "@/lib/prisma";

export type OgPaletteSource =
  | "faithful"
  | "harmonized"
  | "anchored"
  | "fallback";

const BASE_COLOR = "#0f172a" as const;
const BRAND_ANCHOR_COLOR = "#0277BD" as const;

export type OgPalette = {
  base: typeof BASE_COLOR;
  brandAnchor: typeof BRAND_ANCHOR_COLOR;
  mesh: [string, string, string];
  source: OgPaletteSource;
  fingerprint: string;
};

const BRAND_FALLBACK: [string, string, string] = [
  "#4FC3F7",
  BRAND_ANCHOR_COLOR,
  "#7B1FA2",
];

const toOklch = converter("oklch");
const toRgb = converter("rgb");

function fallbackPalette(): OgPalette {
  const mesh = BRAND_FALLBACK;
  return {
    base: BASE_COLOR,
    brandAnchor: BRAND_ANCHOR_COLOR,
    mesh,
    source: "fallback",
    fingerprint: computeFingerprint("fallback", mesh),
  };
}

function computeFingerprint(
  source: OgPaletteSource,
  colors: readonly string[]
): string {
  // Preserve order — mesh[0/1/2] map to fixed gradient stops, so reordering
  // the same set of colors produces a visually different image and must
  // invalidate the CDN cache.
  const ordered = colors.map((c) => c.toLowerCase()).join(",");
  return createHash("sha256")
    .update(`${source}:${ordered}`)
    .digest("hex")
    .slice(0, 8);
}

function isValidHex(value: string | null | undefined): value is string {
  return !!value && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

function rotateOklchHue(hex: string, degrees: number): string | null {
  try {
    const oklch = toOklch(parse(hex));
    if (!oklch || typeof oklch.h !== "number") return null;
    const rotated = { ...oklch, h: (oklch.h + degrees + 360) % 360 };
    return formatHex(toRgb(rotated)) ?? null;
  } catch {
    return null;
  }
}

function pickTopColors(frequency: Map<string, number>): string[] {
  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([color]) => color);
}

function harmonize(realColors: readonly string[]): [string, string, string] {
  const out: string[] = [...realColors];
  const rotations = [30, -30, 60];
  let i = 0;
  while (out.length < 3) {
    const seed = realColors[i % realColors.length];
    const rotated = rotateOklchHue(seed, rotations[out.length - 1] ?? 30);
    out.push(rotated ?? BRAND_FALLBACK[out.length]);
    i++;
    if (i > 10) break;
  }
  return [out[0], out[1], out[2]] as [string, string, string];
}

export function buildMeshBackground(palette: OgPalette): string {
  return [
    `radial-gradient(circle at 20% 30%, ${palette.mesh[0]} 0%, transparent 50%)`,
    `radial-gradient(circle at 80% 20%, ${palette.mesh[1]} 0%, transparent 50%)`,
    `radial-gradient(circle at 60% 80%, ${palette.mesh[2]} 0%, transparent 50%)`,
    `radial-gradient(circle at 50% 50%, rgba(2, 119, 189, 0.15) 0%, transparent 60%)`,
  ].join(", ");
}

// Build a palette, optionally anchored on an explicit color (the
// artist/group/unit's own brand color from `Artist.color`). When the
// anchor is set, it takes mesh[0] and the supporting stops are drawn
// from the frequency map — but with the anchor REMOVED from the
// candidate pool first, so a member whose personal color matches the
// unit's brand color doesn't produce a duplicate stop. When the
// anchor is null/invalid, behavior collapses to the original
// frequency-only path (faithful → harmonized → fallback).
//
// Exported for unit testing — the DB-layer getters that produce the
// anchor + frequency are integration-tested manually via the OG
// preview routes, but the palette assembly logic deserves
// automated coverage of every branch.
export function paletteFromAnchorAndFrequency(
  anchor: string | null,
  frequency: Map<string, number>,
): OgPalette {
  const validAnchor = isValidHex(anchor) ? anchor.toLowerCase() : null;

  if (!validAnchor) {
    if (frequency.size === 0) return fallbackPalette();
    const ordered = pickTopColors(frequency);
    if (ordered.length >= 3) {
      const mesh: [string, string, string] = [ordered[0], ordered[1], ordered[2]];
      return {
        base: BASE_COLOR,
        brandAnchor: BRAND_ANCHOR_COLOR,
        mesh,
        source: "faithful",
        fingerprint: computeFingerprint("faithful", mesh),
      };
    }
    const mesh = harmonize(ordered);
    return {
      base: BASE_COLOR,
      brandAnchor: BRAND_ANCHOR_COLOR,
      mesh,
      source: "harmonized",
      fingerprint: computeFingerprint("harmonized", mesh),
    };
  }

  // Anchor set. Drop it from the supporting candidate pool so we
  // never end up with [anchor, anchor, anything] when a member's
  // personal color matches the unit's brand color.
  const remaining = new Map(frequency);
  remaining.delete(validAnchor);
  const supporting = pickTopColors(remaining);

  let mesh: [string, string, string];
  if (supporting.length >= 2) {
    mesh = [validAnchor, supporting[0], supporting[1]];
  } else {
    // Harmonize: anchor + as many supporting as we have; the
    // existing OKLCH rotation fills mesh[1..2] from anchor's hue
    // when the supporting list is short. With supporting.length 0
    // we get [anchor, anchor+30°, anchor-30°]; with length 1 we
    // get [anchor, supporting[0], supporting[0]-30°].
    mesh = harmonize([validAnchor, ...supporting]);
  }

  return {
    base: BASE_COLOR,
    brandAnchor: BRAND_ANCHOR_COLOR,
    mesh,
    source: "anchored",
    fingerprint: computeFingerprint("anchored", mesh),
  };
}


// ── ANCHOR COLOR GETTERS ───────────────────────────────────────
//
// Each derive*() now seeds the palette with an explicit "anchor"
// color drawn from the entity's own brand color (Artist.color),
// taking mesh[0] when set. Member personal colors fill mesh[1..2].
// When the anchor is null, the existing frequency-only logic runs
// unchanged. See paletteFromAnchorAndFrequency for the assembly.

// Walks Artist.color → root parent's Artist.color (in that order)
// and returns the first valid hex. Visited-set guards against any
// pathological parentArtistId cycle.
async function getArtistAnchorColor(
  artistId: bigint,
): Promise<string | null> {
  const visited = new Set<string>();
  let currentId: bigint | null = artistId;
  while (currentId !== null && !visited.has(currentId.toString())) {
    visited.add(currentId.toString());
    const artist: { color: string | null; parentArtistId: bigint | null } | null =
      await prisma.artist.findUnique({
        where: { id: currentId },
        select: { color: true, parentArtistId: true },
      });
    if (!artist) return null;
    if (isValidHex(artist.color)) return artist.color;
    currentId = artist.parentArtistId;
  }
  return null;
}

// event.eventSeries.artist.color. Multi-artist festivals
// (series.artistId: null, organizerName set) return null and fall
// through to roster-frequency logic.
async function getEventAnchorColor(
  eventId: bigint,
): Promise<string | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      eventSeries: {
        select: {
          artist: { select: { color: true } },
        },
      },
    },
  });
  const color = event?.eventSeries?.artist?.color;
  return isValidHex(color) ? color : null;
}

// Primary SongArtist's artist.color. Falls through if no role:
// "primary" entry exists or the primary artist's color is null.
async function getSongAnchorColor(
  songId: bigint,
): Promise<string | null> {
  const link = await prisma.songArtist.findFirst({
    where: { songId, role: "primary" },
    select: { artist: { select: { color: true } } },
  });
  const color = link?.artist?.color;
  return isValidHex(color) ? color : null;
}

// Climbs the Artist.parentArtistId chain and returns the root ancestor id.
async function findRootArtistId(seedId: bigint): Promise<bigint> {
  const visited = new Set<string>();
  let currentId: bigint | null = seedId;
  let rootId: bigint = seedId;
  while (currentId !== null && !visited.has(currentId.toString())) {
    visited.add(currentId.toString());
    rootId = currentId;
    const artist: { parentArtistId: bigint | null } | null =
      await prisma.artist.findUnique({
        where: { id: currentId },
        select: { parentArtistId: true },
      });
    currentId = artist?.parentArtistId ?? null;
  }
  return rootId;
}

async function collectRosterColorsByArtistId(
  artistId: bigint
): Promise<Map<string, number>> {
  const links = await prisma.stageIdentityArtist.findMany({
    where: { artistId },
    select: { stageIdentity: { select: { color: true } } },
  });

  const frequency = new Map<string, number>();
  for (const link of links) {
    const color = link.stageIdentity.color;
    if (isValidHex(color)) {
      const key = color.toLowerCase();
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }
  return frequency;
}

async function collectEventSetlistColors(
  eventId: bigint
): Promise<Map<string, number>> {
  const items = await prisma.setlistItem.findMany({
    where: { eventId, isDeleted: false },
    select: {
      id: true,
      performers: {
        select: { stageIdentity: { select: { color: true } } },
      },
    },
  });

  const frequency = new Map<string, number>();
  for (const item of items) {
    const perItem = new Set<string>();
    for (const performer of item.performers) {
      const color = performer.stageIdentity.color;
      if (isValidHex(color)) perItem.add(color.toLowerCase());
    }
    for (const color of perItem) {
      frequency.set(color, (frequency.get(color) ?? 0) + 1);
    }
  }
  return frequency;
}

async function collectEventArtistRosterColors(
  eventId: bigint
): Promise<Map<string, number>> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      eventSeries: { select: { artistId: true } },
    },
  });
  const seedArtistId = event?.eventSeries?.artistId;
  if (!seedArtistId) return new Map();

  const rootId = await findRootArtistId(seedArtistId);
  return collectRosterColorsByArtistId(rootId);
}

async function collectSongPerformerColors(
  songId: bigint
): Promise<Map<string, number>> {
  const rows = await prisma.setlistItemSong.findMany({
    where: {
      songId,
      setlistItem: { isDeleted: false, event: { isDeleted: false } },
    },
    select: {
      setlistItem: {
        select: {
          id: true,
          performers: {
            select: { stageIdentity: { select: { color: true } } },
          },
        },
      },
    },
  });

  const seenItems = new Set<string>();
  const frequency = new Map<string, number>();
  for (const row of rows) {
    const itemKey = row.setlistItem.id.toString();
    if (seenItems.has(itemKey)) continue;
    seenItems.add(itemKey);
    const perItem = new Set<string>();
    for (const performer of row.setlistItem.performers) {
      const color = performer.stageIdentity.color;
      if (isValidHex(color)) perItem.add(color.toLowerCase());
    }
    for (const color of perItem) {
      frequency.set(color, (frequency.get(color) ?? 0) + 1);
    }
  }
  return frequency;
}

async function collectSongCreditedArtistColors(
  songId: bigint
): Promise<Map<string, number>> {
  const links = await prisma.stageIdentityArtist.findMany({
    where: { artist: { songCredits: { some: { songId } } } },
    select: { stageIdentity: { select: { color: true } } },
  });

  const frequency = new Map<string, number>();
  for (const link of links) {
    const color = link.stageIdentity.color;
    if (isValidHex(color)) {
      const key = color.toLowerCase();
      frequency.set(key, (frequency.get(key) ?? 0) + 1);
    }
  }
  return frequency;
}

export async function deriveOgPaletteFromEvent(
  eventId: bigint
): Promise<OgPalette> {
  try {
    // Anchor + initial frequency in parallel — independent queries.
    // The fallback to artist-roster frequency runs only if the
    // setlist-color map is empty; nothing about that branch is
    // worth parallelizing with anchor since anchor was already
    // settled in the first round.
    const [anchor, setlistFrequency] = await Promise.all([
      getEventAnchorColor(eventId),
      collectEventSetlistColors(eventId),
    ]);
    const frequency =
      setlistFrequency.size > 0
        ? setlistFrequency
        : await collectEventArtistRosterColors(eventId);
    return paletteFromAnchorAndFrequency(anchor, frequency);
  } catch (err) {
    console.error("[ogPalette] event derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

export async function deriveOgPaletteFromSong(
  songId: bigint
): Promise<OgPalette> {
  try {
    const [anchor, performerFrequency] = await Promise.all([
      getSongAnchorColor(songId),
      collectSongPerformerColors(songId),
    ]);
    const frequency =
      performerFrequency.size > 0
        ? performerFrequency
        : await collectSongCreditedArtistColors(songId);
    return paletteFromAnchorAndFrequency(anchor, frequency);
  } catch (err) {
    console.error("[ogPalette] song derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

export async function deriveOgPaletteFromArtist(
  artistId: bigint
): Promise<OgPalette> {
  try {
    const [anchor, rosterFrequency] = await Promise.all([
      getArtistAnchorColor(artistId),
      collectRosterColorsByArtistId(artistId),
    ]);
    let frequency = rosterFrequency;
    if (frequency.size === 0) {
      const rootId = await findRootArtistId(artistId);
      if (rootId !== artistId) {
        frequency = await collectRosterColorsByArtistId(rootId);
      }
    }
    return paletteFromAnchorAndFrequency(anchor, frequency);
  } catch (err) {
    console.error("[ogPalette] artist derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

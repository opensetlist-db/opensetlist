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

  // Defensive lowercase normalization. The internal collectors
  // (collectRosterColorsByArtistId, collectEventSetlistColors, etc.)
  // already store lowercased keys, but this function is exported
  // and could be called by tests/future callers with mixed-case
  // input. Without normalization, `remaining.delete(validAnchor)`
  // would silently miss a "#ABC" entry against an "#abc" anchor
  // and the anchor would appear twice in the mesh as different
  // strings. Sum counts on collision so a map with both "#ABC"
  // and "#abc" doesn't lose data.
  const normalizedFreq = new Map<string, number>();
  for (const [color, count] of frequency) {
    const key = color.toLowerCase();
    normalizedFreq.set(key, (normalizedFreq.get(key) ?? 0) + count);
  }

  if (!validAnchor) {
    if (normalizedFreq.size === 0) return fallbackPalette();
    const ordered = pickTopColors(normalizedFreq);
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
  // personal color matches the unit's brand color. Reads from
  // `normalizedFreq` (not the raw `frequency`) so the delete hits
  // regardless of the input casing.
  const remaining = new Map(normalizedFreq);
  remaining.delete(validAnchor);
  const supporting = pickTopColors(remaining);

  let mesh: [string, string, string];
  if (supporting.length >= 2) {
    mesh = [validAnchor, supporting[0], supporting[1]];
  } else {
    // Harmonize: anchor + as many supporting as we have; the
    // existing OKLCH rotation fills mesh[1..2] from anchor's hue
    // because `harmonize` seeds via `realColors[i % length]` and
    // i starts at 0 — so the rotation source is always
    // realColors[0] (= anchor) for the first fill, and again
    // anchor (i=1, length=1) when we only have the anchor itself.
    // With supporting.length 0 we get [anchor, anchor+30°,
    // anchor-30°]; with length 1 we get [anchor, supporting[0],
    // anchor-30°].
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
//
// orderBy is required: a song can have multiple `role: "primary"`
// rows (a collab credited equally to two artists), and findFirst
// without orderBy returns whichever row the DB happened to scan
// first. That nondeterminism would propagate into the fingerprint
// hash and break CDN cache on every render. `artistId asc` picks
// the lowest-id artist (semantically: the earlier-created entry,
// usually the lead) as the canonical primary; `id asc` on the
// junction is the tie-break for the unlikely two-rows-same-artist
// case so the choice is fully deterministic.
async function getSongAnchorColor(
  songId: bigint,
): Promise<string | null> {
  const link = await prisma.songArtist.findFirst({
    where: { songId, role: "primary" },
    select: { artist: { select: { color: true } } },
    orderBy: [{ artistId: "asc" }, { id: "asc" }],
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

// Accept any ID-shaped scalar at the cached-helper boundary. Cached
// page data goes through `serializeBigInt` (top-level BigInt → Number)
// and through Prisma's `relationJoins` LATERAL JOIN which emits
// nested IDs as `::text` strings inside JSONB. Prisma's declared TS
// types still say `bigint`, so the runtime shape doesn't line up
// with the types — widening here lets callers pass the cached
// objects without an `as unknown as` cast, and `BigInt(...)` accepts
// all three forms at the conversion boundary.
type SerializedId = string | number | bigint;

// Cached-event variant of deriveOgPaletteFromEvent. The event detail
// page's `getEvent` (wrapped in react.cache) already fetches both
// pieces of data the palette derivation needs:
//
//   - event.eventSeries.artist.color  → the anchor
//   - event.setlistItems[].performers[].stageIdentity.color
//                                     → the frequency map
//
// The DB-loading `deriveOgPaletteFromEvent` was firing two queries
// (an Event.findUnique reading `eventSeries.artist.color` and a
// SetlistItem.findMany reading `stageIdentity.color`) that were pure
// duplicates of work `getEvent` already did. Sentry trace
// (event 5086a051fbe14d3384b7000ceda86503) showed these at 570ms +
// 579ms of DB time per request, against an event whose
// `relationJoins` mega-query was already hydrating the same columns.
//
// This variant takes the loaded event and computes the palette
// in-process. Only the empty-roster fallback path (no member colors
// at all in the setlist) still touches the DB — that branch needs
// `StageIdentityArtist` rows which `getEvent` does not pull. Common
// case: zero DB queries for the palette.
//
// The OG image route (`/api/og/event/[id]`) keeps using
// `deriveOgPaletteFromEvent` since its own Event fetch is intentionally
// minimal (translations only) and doesn't carry the color columns.
export type CachedEventForOgPalette = {
  eventSeries: {
    artistId: SerializedId | null;
    artist: {
      color: string | null;
    } | null;
  } | null;
  setlistItems: ReadonlyArray<{
    performers: ReadonlyArray<{
      stageIdentity: {
        color: string | null;
      };
    }>;
  }>;
};

export async function deriveOgPaletteFromCachedEvent(
  event: CachedEventForOgPalette,
): Promise<OgPalette> {
  try {
    const artistColor = event.eventSeries?.artist?.color;
    const anchor = isValidHex(artistColor) ? artistColor : null;

    // Mirrors `collectEventSetlistColors`: per-item dedupe via Set
    // (so two members in one setlist item with the same color count
    // once for that item), then sum across items.
    const setlistFrequency = new Map<string, number>();
    for (const item of event.setlistItems) {
      const perItem = new Set<string>();
      for (const performer of item.performers) {
        const color = performer.stageIdentity?.color;
        if (isValidHex(color)) perItem.add(color.toLowerCase());
      }
      for (const color of perItem) {
        setlistFrequency.set(color, (setlistFrequency.get(color) ?? 0) + 1);
      }
    }

    const frequency =
      setlistFrequency.size > 0
        ? setlistFrequency
        : await collectFallbackArtistRosterColors(
            event.eventSeries?.artistId ?? null,
          );
    return paletteFromAnchorAndFrequency(anchor, frequency);
  } catch (err) {
    console.error(
      "[ogPalette] cached event derivation failed, using fallback",
      err,
    );
    return fallbackPalette();
  }
}

// Empty-roster fallback for the cached-event path. The series'
// `artistId` is already known (carried in the cached event), so
// unlike `collectEventArtistRosterColors` we skip the redundant
// Event.findUnique and go straight to the parent-chain walk +
// StageIdentityArtist gather.
async function collectFallbackArtistRosterColors(
  seedArtistIdRaw: SerializedId | null,
): Promise<Map<string, number>> {
  if (seedArtistIdRaw === null || seedArtistIdRaw === undefined) {
    return new Map();
  }
  const rootId = await findRootArtistId(BigInt(seedArtistIdRaw));
  return collectRosterColorsByArtistId(rootId);
}

// Cached-song variant of `deriveOgPaletteFromSong`. The song detail
// page's `getSong` (now wrapped in react.cache) already fetches every
// SongArtist + its `artist.color`, and `getSongPerformances` (also
// cached) now also pulls each setlistItem's `performers.stageIdentity.
// color`. Both pieces are exactly what the palette derivation needs:
//
//   - song.artists[role:"primary"][lowest artistId].artist.color
//                                             → the anchor
//   - performances[].setlistItem.performers[].stageIdentity.color
//                                             → the frequency map
//
// The previous DB-loading `deriveOgPaletteFromSong(songId)` was firing
// two queries inside `generateMetadata` — a `SongArtist.findFirst` on
// the primary artist's color (237ms in Sentry trace
// feb38ab569e7432b8960b6a42f6cffaf) and a `SetlistItemSong.findMany`
// on every performer color across every performance (392ms in the
// same trace). Both were redundant against data the cached getters
// already had on hand (or could trivially carry).
//
// `/api/og/song/[id]` keeps using `deriveOgPaletteFromSong(songId)`
// since its standalone Event fetch doesn't carry these columns.
//
// Anchor-selection logic mirrors `getSongAnchorColor` exactly: the
// SongArtist row with `role: "primary"` and the smallest `artistId`
// (tie-break: smallest `id`), so deterministic with the
// `orderBy: [{ artistId: "asc" }, { id: "asc" }]` the SQL version
// uses. Important for fingerprint stability on songs credited equally
// to two primary artists.
//
// Empty-roster fallback (no member colors on any of the 50 most-recent
// performances) goes to `collectSongCreditedArtistColorsFromCachedSong`,
// which queries the StageIdentity roster of every credited Artist —
// matching the existing `collectSongCreditedArtistColors` shape, just
// keyed off the cached song's artistIds instead of an extra Song
// roundtrip.
export type CachedSongForOgPalette = {
  artists: ReadonlyArray<{
    id: string;
    role: string;
    artistId: SerializedId;
    artist: {
      color: string | null;
    };
  }>;
};

export type CachedSongPerformancesForOgPalette = ReadonlyArray<{
  setlistItem: {
    performers: ReadonlyArray<{
      stageIdentity: {
        color: string | null;
      };
    }>;
  };
}>;

export async function deriveOgPaletteFromCachedSong(
  song: CachedSongForOgPalette,
  performances: CachedSongPerformancesForOgPalette,
): Promise<OgPalette> {
  try {
    // Find the primary SongArtist with the smallest (artistId, id)
    // — same ordering as the DB version's `findFirst` with
    // `orderBy: [{ artistId: "asc" }, { id: "asc" }]`.
    let bestSa: CachedSongForOgPalette["artists"][number] | null = null;
    for (const sa of song.artists) {
      if (sa.role !== "primary") continue;
      if (bestSa === null) {
        bestSa = sa;
        continue;
      }
      const ai = BigInt(sa.artistId);
      const bi = BigInt(bestSa.artistId);
      if (ai < bi || (ai === bi && sa.id < bestSa.id)) {
        bestSa = sa;
      }
    }
    // `paletteFromAnchorAndFrequency` does its own `isValidHex` check
    // and falls through to the null-anchor branches when the value
    // isn't a valid hex — so we pass `color` through as-is and let
    // the assembly function decide. Same effective behavior as the
    // DB version's `isValidHex(color) ? color : null`.
    const anchor = bestSa?.artist?.color ?? null;

    // Per-item dedupe: if two members in the same setlistItem share
    // a color, that color contributes one count for the item, not
    // two. Across items, counts sum. Matches
    // `collectSongPerformerColors`'s `seenItems` + `perItem` Set
    // logic — kept defensively even though the bounded `take: 50`
    // means each setlistItem appears at most once per
    // `SetlistItemSong` row for a given song.
    const frequency = new Map<string, number>();
    for (const p of performances) {
      const perItem = new Set<string>();
      for (const performer of p.setlistItem.performers) {
        const color = performer.stageIdentity?.color;
        if (isValidHex(color)) perItem.add(color.toLowerCase());
      }
      for (const color of perItem) {
        frequency.set(color, (frequency.get(color) ?? 0) + 1);
      }
    }

    const finalFreq =
      frequency.size > 0
        ? frequency
        : await collectSongCreditedArtistColorsFromCachedSong(song);
    return paletteFromAnchorAndFrequency(anchor, finalFreq);
  } catch (err) {
    console.error(
      "[ogPalette] cached song derivation failed, using fallback",
      err,
    );
    return fallbackPalette();
  }
}

// Cached-song variant of `collectSongCreditedArtistColors`. The
// original query joins through `Artist.songCredits` to find every
// StageIdentity that's ever been credited on any artist tied to the
// song; we already know those artist IDs from the cached song, so
// we skip the relation traversal and query StageIdentityArtist
// directly with an `artistId IN (...)` filter.
async function collectSongCreditedArtistColorsFromCachedSong(
  song: CachedSongForOgPalette,
): Promise<Map<string, number>> {
  if (song.artists.length === 0) return new Map();
  const artistIds = song.artists.map((sa) => BigInt(sa.artistId));
  const links = await prisma.stageIdentityArtist.findMany({
    where: { artistId: { in: artistIds } },
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

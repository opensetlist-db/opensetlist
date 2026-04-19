import { createHash } from "node:crypto";
import { converter, formatHex, parse } from "culori";
import { prisma } from "@/lib/prisma";

export type OgPaletteSource = "faithful" | "harmonized" | "fallback";

export type OgPalette = {
  base: "#0f172a";
  brandAnchor: "#0277BD";
  mesh: [string, string, string];
  source: OgPaletteSource;
  fingerprint: string;
};

const BASE_COLOR = "#0f172a" as const;

const BRAND_FALLBACK: [string, string, string] = [
  "#4FC3F7",
  "#0277BD",
  "#7B1FA2",
];

const toOklch = converter("oklch");
const toRgb = converter("rgb");

function fallbackPalette(): OgPalette {
  const mesh = BRAND_FALLBACK;
  return {
    base: BASE_COLOR,
    brandAnchor: "#0277BD",
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

function paletteFromFrequency(frequency: Map<string, number>): OgPalette {
  if (frequency.size === 0) return fallbackPalette();

  const ordered = pickTopColors(frequency);

  if (ordered.length >= 3) {
    const mesh: [string, string, string] = [ordered[0], ordered[1], ordered[2]];
    return {
      base: BASE_COLOR,
      brandAnchor: "#0277BD",
      mesh,
      source: "faithful",
      fingerprint: computeFingerprint("faithful", mesh),
    };
  }

  const mesh = harmonize(ordered);
  return {
    base: BASE_COLOR,
    brandAnchor: "#0277BD",
    mesh,
    source: "harmonized",
    fingerprint: computeFingerprint("harmonized", mesh),
  };
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
  const rows = await prisma.songArtist.findMany({
    where: { songId },
    select: { artistId: true },
  });

  const frequency = new Map<string, number>();
  for (const { artistId } of rows) {
    const sub = await collectRosterColorsByArtistId(artistId);
    for (const [color, count] of sub) {
      frequency.set(color, (frequency.get(color) ?? 0) + count);
    }
  }
  return frequency;
}

export async function deriveOgPaletteFromEvent(
  eventId: bigint
): Promise<OgPalette> {
  try {
    let frequency = await collectEventSetlistColors(eventId);
    if (frequency.size === 0) {
      frequency = await collectEventArtistRosterColors(eventId);
    }
    return paletteFromFrequency(frequency);
  } catch (err) {
    console.error("[ogPalette] event derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

export async function deriveOgPaletteFromSong(
  songId: bigint
): Promise<OgPalette> {
  try {
    let frequency = await collectSongPerformerColors(songId);
    if (frequency.size === 0) {
      frequency = await collectSongCreditedArtistColors(songId);
    }
    return paletteFromFrequency(frequency);
  } catch (err) {
    console.error("[ogPalette] song derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

export async function deriveOgPaletteFromArtist(
  artistId: bigint
): Promise<OgPalette> {
  try {
    let frequency = await collectRosterColorsByArtistId(artistId);
    if (frequency.size === 0) {
      const rootId = await findRootArtistId(artistId);
      if (rootId !== artistId) {
        frequency = await collectRosterColorsByArtistId(rootId);
      }
    }
    return paletteFromFrequency(frequency);
  } catch (err) {
    console.error("[ogPalette] artist derivation failed, using fallback", err);
    return fallbackPalette();
  }
}

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
  const sorted = [...new Set(colors.map((c) => c.toLowerCase()))].sort();
  return createHash("sha256")
    .update(`${source}:${sorted.join(",")}`)
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

async function collectSetlistColors(
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

async function collectArtistRosterColors(
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

  const visited = new Set<string>();
  let currentId: bigint | null = seedArtistId;
  let rootId: bigint = seedArtistId;
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

  const links = await prisma.stageIdentityArtist.findMany({
    where: { artistId: rootId },
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

export async function deriveOgPalette(eventId: bigint): Promise<OgPalette> {
  try {
    let frequency = await collectSetlistColors(eventId);
    if (frequency.size === 0) {
      frequency = await collectArtistRosterColors(eventId);
    }

    if (frequency.size === 0) return fallbackPalette();

    const ordered = pickTopColors(frequency);

    if (ordered.length >= 3) {
      const mesh: [string, string, string] = [ordered[0], ordered[1], ordered[2]];
      return {
        base: BASE_COLOR,
        brandAnchor: "#0277BD",
        mesh,
        source: "faithful",
        fingerprint: computeFingerprint("faithful", ordered),
      };
    }

    const mesh = harmonize(ordered);
    return {
      base: BASE_COLOR,
      brandAnchor: "#0277BD",
      mesh,
      source: "harmonized",
      fingerprint: computeFingerprint("harmonized", ordered),
    };
  } catch (err) {
    console.error("[ogPalette] derivation failed, using fallback", err);
    return fallbackPalette();
  }
}


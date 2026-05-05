import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

// Public song-search endpoint backing the shared <SongSearch> component
// (wishlist, prediction, admin SetlistBuilder).
//
// Search uses Prisma's `contains: { mode: "insensitive" }` over both
// originalTitle and the SongTranslation rows, mirroring /api/admin/songs.
// pg_tsvector / Meilisearch is the Phase 2 swap-in (per
// roadmap_phase2_3.md); this v1 keeps parity with the existing admin
// search so the component, the admin path, and the new fan paths all
// share one query shape.
//
// Locale is intentionally NOT a query param at v1: ILIKE doesn't rank,
// so locale would have no semantic effect on the result set. The full
// translation rows come back so the client picks the display locale via
// displayOriginalTitle / displayNameWithFallback. When tsvector lands,
// add `locale` here for language-config + ranking weights.
//
// `includeVariants` defaults to false: wishlist + prediction pickers
// only ever surface base versions, because variant matching is handled
// at *scoring* time via baseVersionId (per engagement-features.md
// "Match semantics"). Admin opts in (?includeVariants=true) to retain
// its current ability to record variant-specific setlist rows.

const RESULT_LIMIT = 20;

function parseExcludeIds(raw: string | null): bigint[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => BigInt(s));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  // Empty query is a no-op rather than a 400: the component fires this
  // endpoint as the user types, and an in-flight request whose input
  // got cleared shouldn't surface as an error in the UI.
  if (!q) {
    return NextResponse.json([]);
  }

  const includeVariants = searchParams.get("includeVariants") === "true";
  const excludeIds = parseExcludeIds(searchParams.get("excludeIds"));

  const where: Prisma.SongWhereInput = {
    isDeleted: false,
    OR: [
      { originalTitle: { contains: q, mode: "insensitive" } },
      {
        translations: {
          some: { title: { contains: q, mode: "insensitive" } },
        },
      },
    ],
  };

  if (!includeVariants) {
    where.baseVersionId = null;
  }

  if (excludeIds.length > 0) {
    where.id = { notIn: excludeIds };
  }

  const songs = await prisma.song.findMany({
    where,
    select: {
      id: true,
      originalTitle: true,
      originalLanguage: true,
      variantLabel: true,
      baseVersionId: true,
      translations: {
        select: { locale: true, title: true, variantLabel: true },
      },
      artists: {
        select: {
          artist: {
            select: {
              id: true,
              originalName: true,
              originalShortName: true,
              originalLanguage: true,
              translations: {
                select: { locale: true, name: true, shortName: true },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: RESULT_LIMIT,
  });

  return NextResponse.json(serializeBigInt(songs));
}

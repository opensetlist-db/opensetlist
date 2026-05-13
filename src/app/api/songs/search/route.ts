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
//
// `expandVariants` (added for SongSearch v2 / AddItemBottomSheet) is
// orthogonal to `includeVariants`. When true, the response keeps the
// base-only flat list (variants are NOT promoted to top-level rows)
// but each base row carries its child variants in a nested `variants`
// array — used by the v2 two-stage picker to render stage 2 from the
// same payload that drove stage 1, with no second round-trip. The two
// flags are independent: admin keeps `includeVariants=true` for its
// flat-variant escape hatch; fan v2 callers pass `expandVariants=true`.

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
  const expandVariants = searchParams.get("expandVariants") === "true";
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

  // `expandVariants` implies base-only too: nested variants on a flat
  // variant row would be a no-op (variants are leaves), so when v2's
  // expansion is requested we force the same base-only filter that
  // applies in the default (non-admin) case.
  if (!includeVariants || expandVariants) {
    where.baseVersionId = null;
  }

  if (excludeIds.length > 0) {
    where.id = { notIn: excludeIds };
  }

  // Single typed select with conditional `variants` injection. v2's
  // expansion is a leaf-level addition — the rest of the projection is
  // byte-identical, so spreading the conditional block keeps the v1
  // shape stable for non-expand callers (admin SetlistBuilder, wishlist,
  // prediction) and avoids a union return type on findMany.
  //
  // Each variant row carries id + variantLabel + per-locale translation
  // overrides — enough for the picker to render labels and for the
  // consumer to derive `variantId` from the user's pick.
  const select: Prisma.SongSelect = {
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
    ...(expandVariants
      ? {
          variants: {
            where: { isDeleted: false },
            select: {
              id: true,
              variantLabel: true,
              translations: {
                select: { locale: true, title: true, variantLabel: true },
              },
            },
            orderBy: { id: "asc" },
          },
        }
      : {}),
  };

  try {
    const songs = await prisma.song.findMany({
      where,
      select,
      orderBy: { createdAt: "desc" },
      take: RESULT_LIMIT,
    });

    return NextResponse.json(serializeBigInt(songs));
  } catch (err) {
    // DB connection / Prisma errors. Returning a JSON 500 (instead of
    // letting Next.js render its HTML error page) keeps the
    // component's `await res.json()` parse path predictable: the
    // catch branch fires and the empty-state UI shows.
    console.error("[/api/songs/search] DB error", err);
    return NextResponse.json([], { status: 500 });
  }
}

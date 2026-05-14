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
//
// `scope` (added for SongSearch v2 scope-filter, multi-IP support) is
// independent of both flags above. It filters results server-side to
// songs by artists tied to a given event / series / explicit artist
// list. Default (param omitted) is `all`, which preserves v1 catalog-
// wide behavior — admin SetlistBuilder relies on that default because
// the operator legitimately records guest-IP songs.
//
// Resolution rules (per task-week3-songsearch-v2-scope-filter.md):
//   scope=event   → event.eventSeries.artistId ∪
//                    event.performers[].stageIdentity.artistLinks[].artistId
//   scope=series  → series.artistId
//   scope=artist  → passthrough of `scopeArtistIds`
//   scope=all     → no filter (returns null from resolver)
//
// Unknown event/series id resolves to `[]` (empty filter set), so the
// picker shows "no results" — same UX as a missing match. We do NOT
// 404 the request: distinguishing "wrong id" from "no matches" is
// opaque to the end user either way.
//
// Validation errors (missing/invalid scopeId, unknown scope name) DO
// return 400 with a JSON body, mirroring the route's 500 path so the
// component's `await res.json()` keeps working without a special-case.

const RESULT_LIMIT = 20;

// Parse a comma-separated list of positive integer IDs off a URL
// param into BigInts (Prisma's id type). Silently drops any segment
// that isn't a bare run of digits — garbage input shouldn't 400 a
// search request whose other params are fine.
//
// Used for both `excludeIds` (dedup pruning on the result list) and
// `scopeArtistIds` (multi-IP scope filter). The two share a wire
// format and validation rules, so they share a parser to keep them
// from drifting (e.g. one adding a max-length cap or dedup pass
// without the other).
function parseCsvBigIntIds(raw: string | null): bigint[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => BigInt(s));
}

// Server-side scope type — uses bigint to match Prisma's id columns.
// Mirrors the component-side `SongSearchScope` (which uses `number`
// because the client follows serializeBigInt's number-coerced convention).
// The URL transport carries strings either way; this discriminated union
// is the parsed-and-validated form we hand to the resolver.
type RouteScope =
  | { kind: "all" }
  | { kind: "event"; eventId: bigint }
  | { kind: "series"; seriesId: bigint }
  | { kind: "artist"; artistIds: bigint[] };

// Parse + validate scope params off the URL. Returns either a typed
// scope or a 400-bound error string. Centralising the validation here
// keeps the GET handler's branching shallow and the error contract
// uniform.
function parseScope(
  searchParams: URLSearchParams,
): { ok: true; scope: RouteScope } | { ok: false; error: string } {
  const kind = searchParams.get("scope");
  // Missing / "all" → default catalog-wide search. Other scope params
  // are ignored when scope is "all" (or absent).
  if (!kind || kind === "all") {
    return { ok: true, scope: { kind: "all" } };
  }
  if (kind === "event" || kind === "series") {
    const raw = searchParams.get("scopeId");
    if (!raw || !/^\d+$/.test(raw)) {
      return {
        ok: false,
        error: `scope=${kind} requires a numeric scopeId`,
      };
    }
    const id = BigInt(raw);
    return kind === "event"
      ? { ok: true, scope: { kind: "event", eventId: id } }
      : { ok: true, scope: { kind: "series", seriesId: id } };
  }
  if (kind === "artist") {
    const artistIds = parseCsvBigIntIds(searchParams.get("scopeArtistIds"));
    if (artistIds.length === 0) {
      return {
        ok: false,
        error: "scope=artist requires at least one numeric scopeArtistIds entry",
      };
    }
    return { ok: true, scope: { kind: "artist", artistIds } };
  }
  return { ok: false, error: `unknown scope value: ${kind}` };
}

// Resolve a parsed scope to the artist-id set we filter songs by, or
// `null` for "no filter" (admin / scope=all path). Empty array means
// "filter for zero artists" → empty result set, which is the spec's
// required UX for an unknown event/series id (the picker just shows
// "no results"; no 404, no different error state).
//
// Path through the schema (see prisma/schema.prisma):
//   Event.performers → EventPerformer.stageIdentity →
//     StageIdentity.artistLinks → StageIdentityArtist.artistId
// Each performer's StageIdentity can be linked to multiple artists
// (e.g. Megumi belongs to 蓮ノ空, Mira-Cra Park!, KahoMegu♡Gelato),
// so we fan out and dedupe via Set.
async function resolveScopeArtistIds(
  scope: RouteScope,
): Promise<bigint[] | null> {
  switch (scope.kind) {
    case "all":
      return null;
    case "event": {
      const event = await prisma.event.findUnique({
        where: { id: scope.eventId },
        select: {
          eventSeries: { select: { artistId: true } },
          performers: {
            select: {
              stageIdentity: {
                select: {
                  artistLinks: { select: { artistId: true } },
                },
              },
            },
          },
        },
      });
      if (!event) return [];
      const ids = new Set<bigint>();
      if (event.eventSeries?.artistId) ids.add(event.eventSeries.artistId);
      for (const p of event.performers) {
        for (const link of p.stageIdentity.artistLinks) {
          ids.add(link.artistId);
        }
      }
      return [...ids];
    }
    case "series": {
      const series = await prisma.eventSeries.findUnique({
        where: { id: scope.seriesId },
        select: { artistId: true },
      });
      return series?.artistId ? [series.artistId] : [];
    }
    case "artist":
      return scope.artistIds;
  }
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
  const excludeIds = parseCsvBigIntIds(searchParams.get("excludeIds"));

  // Scope parse + validate is the only param family that can hard-fail
  // the request — everything else (q, includeVariants, expandVariants,
  // excludeIds) accepts garbage gracefully. Validate before any DB hit
  // so a 400 doesn't waste a connection. The resolver itself can hit
  // the DB (event/series lookups), so it lives inside the try below
  // alongside `findMany` — a connection error there would otherwise
  // escape uncaught and Next.js would render its HTML 500 page that
  // the component's `await res.json()` can't parse.
  const scopeResult = parseScope(searchParams);
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: 400 });
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
    // Resolver can hit the DB (event/series lookups) — wrapped in
    // this try so a connection error joins the same JSON-500 path as
    // `findMany` below. Without this, a flaky DB during resolution
    // would let the error escape uncaught and Next.js would render
    // its HTML 500 page, which the component's `await res.json()`
    // can't parse → unhandled rejection in the browser.
    const scopeArtistIds = await resolveScopeArtistIds(scopeResult.scope);

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

    // Scope filter: only attached when the resolver returned a concrete
    // list. `null` (scope=all) skips this entirely — byte-identical to v1
    // for unscoped callers. An empty array (unknown event/series) still
    // attaches as `artistId: { in: [] }`, which Prisma translates to
    // "match nothing" → empty result set, exactly the spec's UX.
    if (scopeArtistIds !== null) {
      where.artists = { some: { artistId: { in: scopeArtistIds } } };
    }

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

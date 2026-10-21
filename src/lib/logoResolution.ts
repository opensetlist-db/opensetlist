import type { LogoDisplayMode } from "@/generated/prisma/enums";

/*
 * Shared logo resolution for public surfaces (redesign).
 *
 * One contract decides, for an Event or an EventSeries page, which
 * managed logo image to show — or that the card/heading falls back to
 * typography — and which colour that typography is tinted with. Every
 * consumer (home, concert list, search, series and concert detail) goes
 * through this module instead of reading `logoMode`/`logoAsset` itself,
 * so the inheritance rule cannot drift between pages.
 *
 * Inheritance (spec "Image assignment and storage contract"):
 *   - Walk event → its own series → that series' ancestors.
 *   - The first node in `custom` mode wins with its own asset.
 *   - The first node in `typography` mode stops the walk: typography,
 *     even when an ancestor has a logo. A descendant `custom` is met
 *     before an ancestor `typography`, so descendant overrides win.
 *   - `inherit` continues upward; running out of nodes = typography.
 *   - A series page starts the walk at its own node.
 *
 * Safety: a missing, soft-deleted or already-visited series ends the
 * walk with typography (never an exception, never an infinite loop) —
 * the DB has no constraint against a parentSeriesId cycle. A `custom`
 * node whose asset is unusable is typography too, NOT a retry with the
 * ancestor's logo: the operator chose that node's image, and silently
 * swapping in a different one would misrepresent the event. The same
 * holds at render time — an image that fails to load falls back to
 * typography in the shared `EventArt` primitive, not to an ancestor.
 *
 * Never a logo: `Event.posterUrl` and `EventSeries.imageUrl` keep their
 * meanings (poster / generic series image). This module does not read
 * them, so no historical URL is ever promoted to an approved logo.
 *
 * Typography colour source: the series' representative artist (the
 * nearest `artistId` up the series chain — the same owning-artist rule
 * `src/lib/artists.ts` uses for counts), then the event's own
 * representative artist (`Event.artistId`), then the brand. Only an
 * artist that actually has a valid colour counts; a performer roster is
 * never consulted, so a multi-artist event can't be tinted by whichever
 * performer happens to sort first. The value returned is the SOURCE
 * colour only: readable-text contrast against it is the rendering
 * contract owned by 03/06, not decided here.
 *
 * Public projection: `PublicLogo` carries only what a renderer needs
 * (delivery URL + intrinsic size for reserved-space layout, and the
 * colour). ImageAsset provenance (`sourceUrl`, `usageNote`), the
 * standalone `objectKey`, asset ids and which node the logo came from
 * never leave the server through it. Queries select assets through
 * `LOGO_ASSET_SELECT`, so the private columns are not even read.
 */

/** The asset columns a public logo may carry — and the only ones read. */
export const LOGO_ASSET_SELECT = {
  publicUrl: true,
  width: true,
  height: true,
} as const;

const LOGO_ARTIST_SELECT = { color: true, isDeleted: true } as const;

type LogoAssetRow = { publicUrl: string; width: number; height: number };
type ColorArtistRow = { color: string | null; isDeleted: boolean };

/** One EventSeries row as the resolver needs it. */
export type LogoSeriesNode = {
  id: bigint;
  parentSeriesId: bigint | null;
  isDeleted: boolean;
  logoMode: LogoDisplayMode;
  logoAsset: LogoAssetRow | null;
  artistId: bigint | null;
  artist: ColorArtistRow | null;
};

/** The event fields the resolver needs (select with `LOGO_EVENT_SELECT`). */
export type LogoEventInput = {
  eventSeriesId: bigint | null;
  logoMode: LogoDisplayMode;
  logoAsset: LogoAssetRow | null;
  artist: ColorArtistRow | null;
};

/**
 * Prisma `select` fragment for an event that will be passed to
 * `resolveEventLogo`. Spread it into a consumer's own event select.
 */
export const LOGO_EVENT_SELECT = {
  eventSeriesId: true,
  logoMode: true,
  logoAsset: { select: LOGO_ASSET_SELECT },
  artist: { select: LOGO_ARTIST_SELECT },
} as const;

/** Prisma `select` for the series graph rows (see `logoSeriesGraph.ts`). */
export const LOGO_SERIES_SELECT = {
  id: true,
  parentSeriesId: true,
  isDeleted: true,
  logoMode: true,
  logoAsset: { select: LOGO_ASSET_SELECT },
  artistId: true,
  artist: { select: LOGO_ARTIST_SELECT },
} as const;

/**
 * Every series by id (key: `id.toString()`). Build once per request
 * with `buildLogoSeriesGraph`. Server-only — it holds internal fields
 * (parent ids, deletion flags, artist ids): hand clients `PublicLogo`
 * values, never the graph.
 */
export type LogoSeriesGraph = ReadonlyMap<string, LogoSeriesNode>;

export function buildLogoSeriesGraph(
  rows: readonly LogoSeriesNode[],
): LogoSeriesGraph {
  return new Map(rows.map((row) => [row.id.toString(), row]));
}

/** A usable managed logo: delivery URL plus intrinsic size. */
export type LogoImage = { url: string; width: number; height: number };

/** What a public renderer receives. `image: null` = typography. */
export type PublicLogo = {
  image: LogoImage | null;
  /**
   * Typography source colour (`#RRGGBB`), or null for the brand
   * fallback. Not a text colour — see the module comment.
   */
  color: string | null;
};

/**
 * The decision with its reason. Server-side only: the tests pin the
 * reason, and `resolve*Logo` drops it for the public projection.
 */
export type LogoDecision =
  | { kind: "custom"; image: LogoImage }
  | {
      kind: "typography";
      reason:
        | "typography-mode" // a node explicitly stops inheritance
        | "exhausted" // every node inherited; no custom anywhere
        | "unusable-asset" // the chosen custom asset is missing/invalid
        | "broken-chain"; // missing / deleted / cyclic series relation
    };

// Defence in depth on top of the series-depth guard in src/lib/artists.ts
// and src/lib/events.ts: real chains are 1–3 deep.
const MAX_SERIES_DEPTH = 32;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function usableImage(asset: LogoAssetRow | null): LogoImage | null {
  if (!asset) return null;
  const { publicUrl, width, height } = asset;
  // The DB already enforces positive sizes (post-deploy CHECK); these
  // guards keep a hand-built or legacy row from producing a zero-area
  // reserved box or a relative/blank src.
  if (!publicUrl || !/^https?:\/\//i.test(publicUrl)) return null;
  if (!(width > 0) || !(height > 0)) return null;
  return { url: publicUrl, width, height };
}

/**
 * The one series-chain walk both rules share. Visits `start`, then each
 * parent, until `visit` returns a result (stop) or the chain ends
 * (`onEnd`). A missing, soft-deleted or already-visited node, or a
 * chain deeper than MAX_SERIES_DEPTH, ends the walk with `onBroken` —
 * a broken relation never lets the walk skip past it to an ancestor.
 */
function walkSeriesChain<T>(
  start: bigint | null,
  graph: LogoSeriesGraph,
  visit: (node: LogoSeriesNode) => T | undefined,
  onEnd: T,
  onBroken: T,
): T {
  const visited = new Set<string>();
  let cur = start;
  for (let depth = 0; cur != null; depth++) {
    const key = cur.toString();
    if (depth >= MAX_SERIES_DEPTH || visited.has(key)) return onBroken;
    visited.add(key);
    const node = graph.get(key);
    if (!node || node.isDeleted) return onBroken;
    const result = visit(node);
    if (result !== undefined) return result;
    cur = node.parentSeriesId;
  }
  return onEnd;
}

/** One node's own mode; `undefined` = inherit (keep walking). */
function decideNode(node: {
  logoMode: LogoDisplayMode;
  logoAsset: LogoAssetRow | null;
}): LogoDecision | undefined {
  if (node.logoMode === "custom") {
    const image = usableImage(node.logoAsset);
    return image ? { kind: "custom", image } : { kind: "typography", reason: "unusable-asset" };
  }
  if (node.logoMode === "typography") return { kind: "typography", reason: "typography-mode" };
  return undefined;
}

const EXHAUSTED: LogoDecision = { kind: "typography", reason: "exhausted" };
const BROKEN: LogoDecision = { kind: "typography", reason: "broken-chain" };

/** Logo decision for an event (starts at the event's own mode). */
export function decideEventLogo(
  event: LogoEventInput,
  graph: LogoSeriesGraph,
): LogoDecision {
  return (
    decideNode(event) ??
    walkSeriesChain(event.eventSeriesId, graph, decideNode, EXHAUSTED, BROKEN)
  );
}

/** Logo decision for a series page (starts at the series itself). */
export function decideSeriesLogo(
  seriesId: bigint,
  graph: LogoSeriesGraph,
): LogoDecision {
  return walkSeriesChain(seriesId, graph, decideNode, EXHAUSTED, BROKEN);
}

/**
 * Admin explanation of a series' logo: the same decision as
 * `decideSeriesLogo`, plus WHICH series node decided it. Server-only,
 * for the admin logo card ("상위 시리즈 X의 로고를 사용"), never for a
 * public projection — the deciding node is internal by the module
 * contract above.
 *
 * `sourceSeriesId` is the node whose own mode ended the walk (its custom
 * logo, its typography stop, or its unusable custom asset). It is null
 * when no node decided: every node inherited (`exhausted`) or the chain
 * broke (`broken-chain`). Built on the same walk as the public rule, so
 * deletion / cycle / depth handling can never diverge from it.
 */
export function explainSeriesLogo(
  seriesId: bigint,
  graph: LogoSeriesGraph,
): { decision: LogoDecision; sourceSeriesId: bigint | null } {
  return walkSeriesChain<{ decision: LogoDecision; sourceSeriesId: bigint | null }>(
    seriesId,
    graph,
    (node) => {
      const decision = decideNode(node);
      return decision ? { decision, sourceSeriesId: node.id } : undefined;
    },
    { decision: EXHAUSTED, sourceSeriesId: null },
    { decision: BROKEN, sourceSeriesId: null },
  );
}

/**
 * Admin explanation of an event's logo — the event-override counterpart
 * of `explainSeriesLogo`, with the same server-only contract.
 *
 * `source` names the node whose own mode decided: `"event"` when the
 * event's own custom / typography / unusable custom asset ended it,
 * otherwise the deciding series (null for exhausted / broken chain).
 * The decision is always `decideEventLogo`'s: the event node first, then
 * the very walk `explainSeriesLogo` runs from the event's series.
 */
export function explainEventLogo(
  event: LogoEventInput,
  graph: LogoSeriesGraph,
): { decision: LogoDecision; source: "event" | { seriesId: bigint } | null } {
  const own = decideNode(event);
  if (own) return { decision: own, source: "event" };
  const { decision, sourceSeriesId } =
    event.eventSeriesId == null
      ? { decision: EXHAUSTED, sourceSeriesId: null }
      : explainSeriesLogo(event.eventSeriesId, graph);
  return { decision, source: sourceSeriesId === null ? null : { seriesId: sourceSeriesId } };
}

function artistColor(artist: ColorArtistRow | null): string | null {
  if (!artist || artist.isDeleted) return null;
  return artist.color && HEX_COLOR.test(artist.color) ? artist.color : null;
}

/**
 * Representative artist colour of a series: the nearest series up the
 * chain that names an artist decides (same rule as the owning artist in
 * src/lib/artists.ts — a sub-series without its own artist belongs to
 * its parent's). That artist's colour or nothing: a nearer
 * representative without a colour does not fall through to an
 * ancestor's different artist.
 */
function seriesArtistColor(
  startSeriesId: bigint | null,
  graph: LogoSeriesGraph,
): string | null {
  return walkSeriesChain<string | null>(
    startSeriesId,
    graph,
    (node) => (node.artistId != null ? artistColor(node.artist) : undefined),
    null,
    null,
  );
}

/** Typography source colour for an event; null = brand. */
export function eventLogoColor(
  event: LogoEventInput,
  graph: LogoSeriesGraph,
): string | null {
  return seriesArtistColor(event.eventSeriesId, graph) ?? artistColor(event.artist);
}

function toPublicLogo(decision: LogoDecision, color: string | null): PublicLogo {
  return { image: decision.kind === "custom" ? { ...decision.image } : null, color };
}

/** Public logo for an event card/heading. */
export function resolveEventLogo(
  event: LogoEventInput,
  graph: LogoSeriesGraph,
): PublicLogo {
  return toPublicLogo(decideEventLogo(event, graph), eventLogoColor(event, graph));
}

/** Public logo for a series page/card. */
export function resolveSeriesLogo(
  seriesId: bigint,
  graph: LogoSeriesGraph,
): PublicLogo {
  return toPublicLogo(decideSeriesLogo(seriesId, graph), seriesArtistColor(seriesId, graph));
}

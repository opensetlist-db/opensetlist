import { prisma } from "@/lib/prisma";
import { CACHE_TTL, cachedQuery } from "@/lib/dataCache";
import {
  LOGO_SERIES_SELECT,
  buildLogoSeriesGraph,
  type LogoSeriesGraph,
  type LogoSeriesNode,
} from "@/lib/logoResolution";

/*
 * DB side of the logo resolver (pure rules live in `logoResolution.ts`).
 *
 * Why one graph of every series instead of walking parents per event:
 * a page lists events from many series (home, concert list, search),
 * and per-event ancestor queries would be N round trips. The whole
 * EventSeries table is small (a few dozen rows) and the select
 * is a handful of scalars plus the asset's URL/size and the artist's
 * colour, so one read covers every chain on the page. Deleted series
 * are included on purpose: the resolver must SEE a deleted node to stop
 * at it, rather than mistake it for "no parent".
 *
 * Cache contract. The graph is a cached public read, so it carries
 * PUBLIC_DATA_TAG like every other `cachedQuery`. Every writer that can
 * change a logo decision — EventSeries create/update/delete (mode,
 * asset, parent, artist), Event create/update/delete (mode, asset,
 * series, artist) and Artist colour edits — already calls
 * `revalidatePublicData()`, which expires this graph together with the
 * home / series / detail / song / artist entries that embed resolved
 * logos. A series change therefore refreshes every descendant event's
 * projection on every surface at once; no per-series tag or dependency
 * map is needed. Logo writers added later (series/event upload forms)
 * must keep calling `revalidatePublicData()`, NOT only
 * `revalidateEventData(id)`: an event-scoped tag would leave the graph
 * and the other events of the series stale for an hour.
 *
 * Live path: nothing here touches `setlistRevision` or the live
 * snapshot (`/api/setlist`). A logo change is not a setlist edit, so it
 * never bumps the revision; the live snapshot does not carry logos, and
 * an ongoing event page (which bypasses its own cache) still reads this
 * graph through the cache, refreshed by the same public expiry.
 */

export async function fetchLogoSeriesGraphRows(): Promise<LogoSeriesNode[]> {
  return prisma.eventSeries.findMany({ select: LOGO_SERIES_SELECT });
}

const getLogoSeriesGraphRowsCached = cachedQuery(
  "logo-series-graph",
  fetchLogoSeriesGraphRows,
  { revalidate: CACHE_TTL.entity },
);

/** The cached series graph for `resolveEventLogo` / `resolveSeriesLogo`. */
export async function getLogoSeriesGraph(): Promise<LogoSeriesGraph> {
  return buildLogoSeriesGraph(await getLogoSeriesGraphRowsCached());
}

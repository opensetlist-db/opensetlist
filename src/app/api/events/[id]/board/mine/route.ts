import { NextResponse } from "next/server";
import { defaultLocale, locales, type Locale } from "@/i18n/routing";
import { parseRequiredAnonId } from "@/lib/anonId";
import { getBoardControlCached } from "@/lib/board/boardRead";
import { parseDecimalId } from "@/lib/board/ids";
import { loadMinePicks } from "@/lib/board/picks";
import { classifyPreExecutionFailure } from "@/lib/dbErrors";
import type { BoardMineResponse } from "@/lib/board/types";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * The caller's own expected-song picks for one event (n15-03).
 *
 *   GET /api/events/[id]/board/mine?anonId=<browser id>&locale=ja
 *     → { picks: BoardMinePick[] }
 *
 * The client's fallback when its local copy is empty (storage cleared,
 * another tab wrote it). The anon id is a bearer capability: whoever
 * holds it reads that ballot, nobody else's — so this answer is
 * `private, no-store`, never enters a shared cache, and is computed
 * per request (the data cache is not used for the rows).
 *
 *   400 malformed event id; missing, empty or malformed anonId
 *   404 event missing
 *
 * Served even when the board is disabled or locked: it is a read of
 * the caller's own rows, and the client only asks while it shows the
 * board anyway. The event existence check reuses the board's cached
 * control row (one cached read, no extra query).
 */

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(req: Request, { params }: RouteProps) {
  const eventId = parseDecimalId((await params).id);
  if (eventId === null) {
    return NextResponse.json(
      { error: "invalid_event_id" },
      { status: 400, headers: PRIVATE_NO_STORE },
    );
  }
  const search = new URL(req.url).searchParams;
  const anon = parseRequiredAnonId(search.get("anonId") ?? undefined);
  if (!anon.ok) {
    return NextResponse.json(
      { error: "invalid_anon_id" },
      { status: 400, headers: PRIVATE_NO_STORE },
    );
  }
  const raw = search.get("locale");
  const locale: Locale = locales.includes(raw as Locale)
    ? (raw as Locale)
    : defaultLocale;

  try {
    const control = await getBoardControlCached(eventId);
    if (!control) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: PRIVATE_NO_STORE },
      );
    }
    const body: BoardMineResponse = {
      picks: await loadMinePicks(eventId, anon.value, locale),
    };
    return NextResponse.json(body, { headers: PRIVATE_NO_STORE });
  } catch (err) {
    // Same answer as the write routes when the pool is exhausted: a
    // retry-safe 503, not a 500 (the client just keeps its empty list).
    if (classifyPreExecutionFailure(err)) {
      return NextResponse.json(
        { error: "busy" },
        { status: 503, headers: { ...PRIVATE_NO_STORE, "Retry-After": "2" } },
      );
    }
    throw err;
  }
}

import { NextResponse } from "next/server";
import { defaultLocale, locales, type Locale } from "@/i18n/routing";
import { resolveBoardRead } from "@/lib/board/boardRead";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Fan board read (n15).
 *
 *   GET /api/events/[id]/board?locale=ja
 *     → { enabled: false }                         flag off
 *     → { enabled, status, locked: true, lockAt }  ongoing / cancelled stub
 *     → { enabled, status, locked, lockAt, asOf, groups }
 *
 * HTTP `no-store` on every answer: the kill switch must reach a reader
 * on the next request, so no browser/CDN copy may outlive the control
 * check. The load is carried by the server data cache underneath
 * (`src/lib/board/boardRead.ts`), not by HTTP caching.
 *
 * Never touches `/api/setlist`, the live snapshot or any revalidate
 * helper.
 */

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request, { params }: RouteProps) {
  const { id } = await params;
  let eventId: bigint;
  try {
    eventId = BigInt(id);
  } catch {
    return NextResponse.json(
      { error: "invalid_event_id" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (eventId <= BigInt(0)) {
    return NextResponse.json(
      { error: "invalid_event_id" },
      { status: 400, headers: NO_STORE },
    );
  }
  // Unknown locale → default rather than 400: the locale only picks
  // display strings, and it is part of the cache key, so clamping it
  // also stops arbitrary strings from minting cache entries.
  const raw = new URL(req.url).searchParams.get("locale");
  const locale: Locale = locales.includes(raw as Locale)
    ? (raw as Locale)
    : defaultLocale;

  const board = await resolveBoardRead(eventId, locale);
  if (!board) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }
  return NextResponse.json(board, { headers: NO_STORE });
}

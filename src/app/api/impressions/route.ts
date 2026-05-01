import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  IMPRESSION_LOCALES,
  IMPRESSION_MAX_CHARS,
  IMPRESSION_PAGE_SIZE,
} from "@/lib/config";
import {
  encodeImpressionCursor,
  decodeImpressionCursor,
} from "@/lib/impressionCursor";
import { parseAnonId } from "@/lib/anonId";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId) {
    return NextResponse.json({ error: "eventId required" }, { status: 400 });
  }

  let eid: bigint;
  try {
    eid = BigInt(eventId);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  const beforeRaw = req.nextUrl.searchParams.get("before");
  const cursor = beforeRaw ? decodeImpressionCursor(beforeRaw) : null;
  if (beforeRaw && !cursor) {
    return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
  }

  // `?includeTotal=1` is the opt-in flag for the event-wide
  // `count()` query. Polling skips it (the count would run every 5s
  // per concurrent viewer for a UX-only metric — needless DB hot-
  // path cost). SSR seed + each "see older" click set it, so the
  // header total + "X more" button refresh on every load-more even
  // though they may drift slightly between clicks as other users
  // post. Optimistic increments in `EventImpressions` cover the
  // user's own submit/report actions in between.
  const includeTotal = req.nextUrl.searchParams.get("includeTotal") === "1";

  const baseWhere = {
    eventId: eid,
    supersededAt: null,
    isDeleted: false,
    isHidden: false,
  } as const;

  // Cursor predicate: rows strictly OLDER than the cursor under the
  // composite (createdAt, id) ordering. When createdAt is equal across
  // multiple rows (sub-millisecond bursts), the id tiebreaker keeps
  // pagination strictly forward-progressing — no skips, no dupes.
  const where = cursor
    ? {
        ...baseWhere,
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : baseWhere;

  // Parallel findMany + (optional) count. When `includeTotal` is
  // false the count branch resolves to undefined synchronously and
  // adds zero DB round trips. Without the gate, the polling hot
  // path (5s per concurrent viewer) would fire a redundant
  // event-wide aggregate per tick.
  const [rows, totalCount] = await Promise.all([
    prisma.eventImpression.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: IMPRESSION_PAGE_SIZE,
    }),
    includeTotal
      ? prisma.eventImpression.count({ where: baseWhere })
      : Promise.resolve(undefined),
  ]);

  const impressions = rows.map((r) => ({
    id: r.id,
    rootImpressionId: r.rootImpressionId,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
  }));

  // `nextCursor` is null when this page is the LAST one — i.e., the
  // page returned fewer rows than the page size. Rendering the
  // "see older" button hinges on this being non-null, so the client
  // never needs to compute "is there more?" itself. Computed from
  // `rows` (the raw Prisma result) rather than `impressions` so any
  // future shape change in the response mapper can't desync the
  // cursor-end check.
  const lastRow = rows[rows.length - 1];
  const nextCursor =
    rows.length === IMPRESSION_PAGE_SIZE && lastRow
      ? encodeImpressionCursor(lastRow.createdAt, lastRow.id)
      : null;

  // Omit `totalCount` from the body entirely when not requested so
  // the response shape mirrors the cost: a poll request gets back
  // exactly what the server computed, no `null` placeholder. Client
  // type is `totalCount?: number`.
  const body: {
    impressions: typeof impressions;
    nextCursor: string | null;
    totalCount?: number;
  } = { impressions, nextCursor };
  if (totalCount !== undefined) {
    body.totalCount = totalCount;
  }

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, content, locale, anonId } = body ?? {};

  if (!eventId || typeof content !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) {
    return NextResponse.json(
      { error: `Content must be 1-${IMPRESSION_MAX_CHARS} chars` },
      { status: 400 }
    );
  }

  const anonResult = parseAnonId(anonId);
  if (!anonResult.ok) {
    return NextResponse.json({ error: anonResult.message }, { status: 400 });
  }
  const dedupAnonId = anonResult.value;

  let eid: bigint;
  try {
    eid = BigInt(eventId);
  } catch {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }

  const event = await prisma.event.findFirst({
    where: { id: eid, isDeleted: false },
    select: { id: true },
  });
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const resolvedLocale =
    typeof locale === "string" &&
    (IMPRESSION_LOCALES as readonly string[]).includes(locale)
      ? locale
      : "ko";

  // Generate the id upfront so the head row can set
  // rootImpressionId = id in a single insert (no two-step placeholder dance).
  // No P2002 catch needed here: rootImpressionId is fresh per call, so the
  // event_impression_anon_unique partial unique cannot fire on insert.
  const newId = randomUUID();
  const created = await prisma.eventImpression.create({
    data: {
      id: newId,
      rootImpressionId: newId,
      eventId: eid,
      content: trimmed,
      locale: resolvedLocale,
      anonId: dedupAnonId,
    },
  });

  return NextResponse.json({
    impression: {
      id: created.id,
      rootImpressionId: created.rootImpressionId,
      eventId: created.eventId.toString(),
      content: created.content,
      locale: created.locale,
      createdAt: created.createdAt.toISOString(),
    },
  });
}

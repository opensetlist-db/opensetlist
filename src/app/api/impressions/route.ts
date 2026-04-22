import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_LOCALES, IMPRESSION_MAX_CHARS } from "@/lib/config";

const ANON_ID_MAX_LEN = 64;

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

  const rows = await prisma.eventImpression.findMany({
    where: {
      eventId: eid,
      supersededAt: null,
      isDeleted: false,
      isHidden: false,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const impressions = rows.map((r) => ({
    id: r.id,
    rootImpressionId: r.rootImpressionId,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json(
    { impressions },
    {
      headers: {
        "Cache-Control": "public, s-maxage=3, stale-while-revalidate=5",
      },
    },
  );
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

  if (anonId !== undefined && (typeof anonId !== "string" || anonId.length > ANON_ID_MAX_LEN)) {
    return NextResponse.json({ error: "invalid anonId" }, { status: 400 });
  }
  // Empty string from a client whose localStorage is disabled / errored —
  // treat as missing so the chain isn't claimed by an empty-string owner.
  const dedupAnonId =
    typeof anonId === "string" && anonId.length > 0 ? anonId : null;

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

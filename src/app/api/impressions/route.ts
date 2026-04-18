import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";

const VALID_LOCALES = ["ko", "ja", "en"];

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
      isDeleted: false,
      isHidden: false,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const impressions = rows.map((r) => ({
    id: r.id,
    eventId: r.eventId.toString(),
    content: r.content,
    locale: r.locale,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
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

  const { eventId, content, locale } = body ?? {};

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
    typeof locale === "string" && VALID_LOCALES.includes(locale) ? locale : "ko";

  const created = await prisma.eventImpression.create({
    data: {
      eventId: eid,
      content: trimmed,
      locale: resolvedLocale,
    },
  });

  return NextResponse.json({
    impression: {
      id: created.id,
      eventId: created.eventId.toString(),
      content: created.content,
      locale: created.locale,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
  });
}

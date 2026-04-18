import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";
import { getEditCooldownRemaining } from "@/lib/impression";

type RouteProps = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: RouteProps) {
  const { id } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content } = body ?? {};
  if (typeof content !== "string") {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const trimmed = content.trim();
  if (trimmed.length < 1 || trimmed.length > IMPRESSION_MAX_CHARS) {
    return NextResponse.json(
      { error: `Content must be 1-${IMPRESSION_MAX_CHARS} chars` },
      { status: 400 }
    );
  }

  const existing = await prisma.eventImpression.findFirst({
    where: { id, isDeleted: false },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const remainingSeconds = getEditCooldownRemaining(existing.updatedAt, new Date());
  if (remainingSeconds > 0) {
    return NextResponse.json(
      { error: "Edit cooldown", remainingSeconds },
      { status: 429 }
    );
  }

  const updated = await prisma.eventImpression.update({
    where: { id },
    data: { content: trimmed },
  });

  return NextResponse.json({
    impression: {
      id: updated.id,
      eventId: updated.eventId.toString(),
      content: updated.content,
      locale: updated.locale,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

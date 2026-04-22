import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_MAX_CHARS } from "@/lib/config";
import {
  getEditCooldownRemaining,
  ImpressionCooldownError,
  ImpressionNotFoundError,
  ImpressionStaleEditError,
} from "@/lib/impression";
import { ANON_ID_MAX_LEN } from "@/lib/anonId";

type RouteProps = { params: Promise<{ id: string }> };

// `[id]` is the chain id (rootImpressionId) so that share links and
// localStorage references survive across edits.
export async function PUT(req: NextRequest, { params }: RouteProps) {
  const { id: chainId } = await params;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content, anonId } = body ?? {};
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

  if (anonId !== undefined && (typeof anonId !== "string" || anonId.length > ANON_ID_MAX_LEN)) {
    return NextResponse.json({ error: "invalid anonId" }, { status: 400 });
  }
  const requesterAnonId =
    typeof anonId === "string" && anonId.length > 0 ? anonId : null;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const current = await tx.eventImpression.findFirst({
        where: { rootImpressionId: chainId, supersededAt: null, isDeleted: false },
      });
      if (!current) throw new ImpressionNotFoundError();

      // Ownership check: anon-keyed chains require matching caller anonId.
      // Legacy chains (current.anonId === null, written before this column
      // existed) accept any caller — preserves backward compat for the few
      // pre-feature rows. Mismatch returns 404 (not 403) to hide chain
      // existence from non-owners.
      if (current.anonId !== null && current.anonId !== requesterAnonId) {
        throw new ImpressionNotFoundError();
      }

      const remainingSeconds = getEditCooldownRemaining(current.createdAt, new Date());
      if (remainingSeconds > 0) {
        throw new ImpressionCooldownError(remainingSeconds);
      }

      // updateMany scoped to (id, supersededAt: null) — if a concurrent
      // edit already superseded this row count === 0 and we 409.
      const supersede = await tx.eventImpression.updateMany({
        where: { id: current.id, supersededAt: null },
        data: { supersededAt: new Date() },
      });
      if (supersede.count === 0) throw new ImpressionStaleEditError();

      const newId = randomUUID();
      return tx.eventImpression.create({
        data: {
          id: newId,
          rootImpressionId: chainId,
          eventId: current.eventId,
          content: trimmed,
          locale: current.locale,
          // Inherit anonId from the chain head so ownership stays stable
          // across edits — the anon that owned the previous row owns the
          // new one.
          anonId: current.anonId,
        },
      });
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
  } catch (err) {
    if (err instanceof ImpressionNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ImpressionCooldownError) {
      return NextResponse.json(
        { error: "Edit cooldown", remainingSeconds: err.remainingSeconds },
        { status: 429 }
      );
    }
    if (err instanceof ImpressionStaleEditError) {
      return NextResponse.json({ error: "Stale edit" }, { status: 409 });
    }
    throw err;
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function ensureStageIdentitiesExist(
  ids: string[]
): Promise<NextResponse | null> {
  if (ids.length === 0) return null;
  const unique = Array.from(new Set(ids));
  const found = await prisma.stageIdentity.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  const foundSet = new Set(found.map((r) => r.id));
  const missing = unique.filter((id) => !foundSet.has(id));
  if (missing.length === 0) return null;
  return NextResponse.json(
    { error: "Unknown stageIdentityId(s)", missingIds: missing },
    { status: 400 }
  );
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyAdminAPI } from "@/lib/admin-auth";

type RouteProps = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: RouteProps) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  const { id } = await params;

  let iid: bigint;
  try {
    iid = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.eventImpression.findUnique({
    where: { id: iid },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.eventImpression.update({
    where: { id: iid },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(_req: NextRequest, { params }: RouteProps) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  const { id } = await params;

  let iid: bigint;
  try {
    iid = BigInt(id);
  } catch {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const existing = await prisma.eventImpression.findUnique({
    where: { id: iid },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.eventImpression.update({
    where: { id: iid },
    data: {
      isDeleted: false,
      deletedAt: null,
      isHidden: false,
      reportCount: 0,
    },
  });

  return NextResponse.json({ ok: true });
}

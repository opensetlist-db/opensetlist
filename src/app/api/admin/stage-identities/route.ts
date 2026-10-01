import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { verifyAdminAPI } from "@/lib/admin-auth";

export async function GET() {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const identities = await prisma.stageIdentity.findMany({
    include: {
      translations: true,
      artistLinks: {
        include: { artist: { include: { translations: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(serializeBigInt(identities));
}

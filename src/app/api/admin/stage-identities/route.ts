import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { stageIdentityOrderBy } from "@/lib/memberOrder";
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
    // Official member order (`src/lib/memberOrder.ts`) — the
    // SetlistBuilder / EventForm performer pickers and the artist
    // form's "기존 멤버 연결" list render this order as is.
    orderBy: stageIdentityOrderBy(),
  });
  return NextResponse.json(serializeBigInt(identities));
}

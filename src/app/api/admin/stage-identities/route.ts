import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sortAdminMembers } from "@/lib/adminOfficialOrder";
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
  });
  const artists = await prisma.artist.findMany({
    where: { isDeleted: false },
    select: { id: true, parentArtistId: true, type: true, sortOrder: true },
  });
  return NextResponse.json(serializeBigInt(sortAdminMembers(identities, (identity) => identity, artists)));
}

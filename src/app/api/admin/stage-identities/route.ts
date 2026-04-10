import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function GET() {
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

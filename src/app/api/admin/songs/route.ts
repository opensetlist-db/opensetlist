import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  const where: Record<string, unknown> = { isDeleted: false };
  if (q) {
    where.OR = [
      { originalTitle: { contains: q, mode: "insensitive" } },
      { translations: { some: { title: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const songs = await prisma.song.findMany({
    where,
    include: {
      translations: true,
      artists: {
        include: { artist: { include: { translations: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(serializeBigInt(songs));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    originalTitle,
    variantLabel,
    releaseDate,
    baseVersionId,
    translations,
    artistCredits,
  } = body;

  const song = await prisma.song.create({
    data: {
      originalTitle,
      variantLabel: variantLabel || null,
      releaseDate: releaseDate ? new Date(releaseDate) : null,
      baseVersionId: baseVersionId ? BigInt(baseVersionId) : null,
      translations: {
        create: translations.map(
          (t: { locale: string; title: string }) => ({
            locale: t.locale,
            title: t.title,
          })
        ),
      },
      artists: artistCredits?.length
        ? {
            create: artistCredits.map(
              (ac: { artistId: number; role: string }) => ({
                artistId: BigInt(ac.artistId),
                role: ac.role,
              })
            ),
          }
        : undefined,
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(song), { status: 201 });
}

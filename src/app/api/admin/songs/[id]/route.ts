import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const songId = BigInt(id);
  const body = await request.json();
  const {
    originalTitle,
    variantLabel,
    releaseDate,
    baseVersionId,
    translations,
    artistCredits,
  } = body;

  await prisma.songTranslation.deleteMany({ where: { songId } });
  await prisma.songArtist.deleteMany({ where: { songId } });

  const song = await prisma.song.update({
    where: { id: songId },
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
  return NextResponse.json(serializeBigInt(song));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.song.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}

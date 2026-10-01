import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { revalidatePublicData } from "@/lib/dataCache";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const songId = BigInt(id);
  const body = await request.json();
  const {
    originalTitle,
    originalLanguage,
    variantLabel,
    sourceNote,
    releaseDate,
    baseVersionId,
    translations,
    artistCredits,
  } = body;

  // One transaction for the delete-and-recreate: if the update fails
  // after the deletes ran, the song would be left with no translations
  // or credits — and the cache would never be told, since the
  // revalidate below only runs on success. Batch form is fine here (3
  // statements, well inside the client-level timeout).
  const [, , song] = await prisma.$transaction([
    prisma.songTranslation.deleteMany({ where: { songId } }),
    prisma.songArtist.deleteMany({ where: { songId } }),
    prisma.song.update({
      where: { id: songId },
      data: {
        originalTitle,
        originalLanguage: originalLanguage || undefined,
        variantLabel: variantLabel || null,
        sourceNote: sourceNote || null,
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
    }),
  ]);
  revalidatePublicData();
  return NextResponse.json(serializeBigInt(song));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.song.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}

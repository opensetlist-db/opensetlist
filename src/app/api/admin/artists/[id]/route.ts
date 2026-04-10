import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artist = await prisma.artist.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      parentArtist: { include: { translations: true } },
      groupLinks: {
        include: { group: { include: { translations: true } } },
      },
      stageLinks: {
        include: {
          stageIdentity: {
            include: {
              translations: true,
              voicedBy: {
                include: {
                  realPerson: { include: { translations: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!artist) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(serializeBigInt(artist));
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artistId = BigInt(id);
  const body = await request.json();
  const { type, parentArtistId, hasBoard, translations, groupIds } = body;

  // Update translations
  await prisma.artistTranslation.deleteMany({ where: { artistId } });

  // Update group links
  await prisma.artistGroup.deleteMany({ where: { artistId } });

  const artist = await prisma.artist.update({
    where: { id: artistId },
    data: {
      type,
      parentArtistId: parentArtistId ? BigInt(parentArtistId) : null,
      hasBoard: hasBoard ?? true,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; bio?: string }) => ({
            locale: t.locale,
            name: t.name,
            bio: t.bio || null,
          })
        ),
      },
      groupLinks: groupIds?.length
        ? { create: groupIds.map((gid: string) => ({ groupId: gid })) }
        : undefined,
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(artist));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.artist.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}

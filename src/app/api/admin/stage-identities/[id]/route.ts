import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { revalidatePublicData } from "@/lib/dataCache";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const body = await request.json();
  const { type, color, translations } = body;

  await prisma.stageIdentityTranslation.deleteMany({
    where: { stageIdentityId: id },
  });

  const si = await prisma.stageIdentity.update({
    where: { id },
    data: {
      type: type ?? undefined,
      color: color || null,
      translations: {
        create: translations.map((t: { locale: string; name: string }) => ({
          locale: t.locale,
          name: t.name,
        })),
      },
    },
    include: { translations: true },
  });
  revalidatePublicData();
  return NextResponse.json(serializeBigInt(si));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;

  await prisma.$transaction([
    prisma.realPersonStageIdentity.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentityTranslation.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentityArtist.deleteMany({ where: { stageIdentityId: id } }),
    prisma.setlistItemMember.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentity.delete({ where: { id } }),
  ]);

  revalidatePublicData();
  return NextResponse.json({ ok: true });
}

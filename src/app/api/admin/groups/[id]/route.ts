import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const body = await request.json();
  const { type, category, hasBoard, translations } = body;

  // Delete existing translations and recreate
  await prisma.groupTranslation.deleteMany({ where: { groupId: id } });

  const group = await prisma.group.update({
    where: { id },
    data: {
      type: type || null,
      category: category || null,
      hasBoard: hasBoard ?? false,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; description?: string }) => ({
            locale: t.locale,
            name: t.name,
            description: t.description || null,
          })
        ),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(group));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.groupTranslation.deleteMany({ where: { groupId: id } });
  await prisma.artistGroup.deleteMany({ where: { groupId: id } });
  await prisma.group.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

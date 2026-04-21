import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseLocalizedTranslations,
  requireString,
} from "@/lib/admin-input";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const body = await request.json();
  const { type, category, hasBoard } = body;

  const name = requireString(body.originalName, "originalName");
  if (!name.ok) return badRequest(name.message);

  const shortName = nullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return badRequest(shortName.message);

  const description = nullableString(body.originalDescription, "originalDescription");
  if (!description.ok) return badRequest(description.message);

  const language = parseOriginalLanguage(body.originalLanguage);
  if (!language.ok) return badRequest(language.message);

  const translations = parseLocalizedTranslations(body.translations);
  if (!translations.ok) return badRequest(translations.message);

  await prisma.groupTranslation.deleteMany({ where: { groupId: id } });

  const group = await prisma.group.update({
    where: { id },
    data: {
      type: type || null,
      category: category || null,
      hasBoard: hasBoard ?? false,
      originalName: name.value,
      originalShortName: shortName.value,
      originalDescription: description.value,
      originalLanguage: language.value,
      translations: { create: translations.value },
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

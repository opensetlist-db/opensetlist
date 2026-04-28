import { NextRequest, NextResponse } from "next/server";
import { GroupType, GroupCategory } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  nullableBoolean,
  nullableEnumValue,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
  parseLocalizedTranslations,
  requireString,
} from "@/lib/admin-input";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const slug = requireString(body.slug, "slug");
  if (!slug.ok) return badRequest(slug.message);

  const typeCheck = nullableEnumValue(body.type, "type", Object.values(GroupType));
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const categoryCheck = nullableEnumValue(body.category, "category", Object.values(GroupCategory));
  if (!categoryCheck.ok) return badRequest(categoryCheck.message);

  const hasBoardCheck = nullableBoolean(body.hasBoard, "hasBoard");
  if (!hasBoardCheck.ok) return badRequest(hasBoardCheck.message);

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

  // Atomic delete-then-update: a failed update would otherwise leave
  // the group with no translation rows. Catch P2002 (unique violation
  // on `slug`) and surface as 409 — pre-flight findFirst would race
  // against concurrent edits.
  try {
    const group = await prisma.$transaction(async (tx) => {
      await tx.groupTranslation.deleteMany({ where: { groupId: id } });
      return tx.group.update({
        where: { id },
        data: {
          slug: slug.value,
          type: typeCheck.value,
          category: categoryCheck.value,
          hasBoard: hasBoardCheck.value ?? false,
          originalName: name.value,
          originalShortName: shortName.value,
          originalDescription: description.value,
          originalLanguage: language.value,
          translations: { create: translations.value },
        },
        include: { translations: true },
      });
    });
    return NextResponse.json(serializeBigInt(group));
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `슬러그 "${slug.value}"가 이미 사용 중입니다.` },
        { status: 409 },
      );
    }
    throw e;
  }
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  await prisma.groupTranslation.deleteMany({ where: { groupId: id } });
  await prisma.artistGroup.deleteMany({ where: { groupId: id } });
  await prisma.group.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

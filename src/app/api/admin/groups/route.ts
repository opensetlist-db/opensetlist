import { NextRequest, NextResponse } from "next/server";
import { GroupType, GroupCategory } from "@/generated/prisma/enums";
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

export async function GET() {
  const groups = await prisma.group.findMany({
    include: { translations: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(serializeBigInt(groups));
}

export async function POST(request: NextRequest) {
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
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

  const group = await prisma.group.create({
    data: {
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
  return NextResponse.json(serializeBigInt(group), { status: 201 });
}

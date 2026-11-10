import { checkIdentityNames, identityTranslations } from "@/lib/adminIdentityNames";
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
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const slug = body.slug === undefined ? { ok: true as const, value: undefined } : requireString(body.slug, "slug");
  if (!slug.ok) return badRequest(slug.message);

  const typeCheck = nullableEnumValue(body.type, "type", Object.values(GroupType));
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const categoryCheck = nullableEnumValue(body.category, "category", Object.values(GroupCategory));
  if (!categoryCheck.ok) return badRequest(categoryCheck.message);

  const hasBoardCheck = nullableBoolean(body.hasBoard, "hasBoard");
  if (!hasBoardCheck.ok) return badRequest(hasBoardCheck.message);

  const translations = identityTranslations(body.translations, parseLocalizedTranslations);
  if (!translations.ok) return badRequest(translations.message);

  const name = body.originalName === undefined ? undefined : requireString(body.originalName, "originalName");
  if (name && !name.ok) return badRequest(name.message);
  const shortName = body.originalShortName === undefined ? undefined : nullableString(body.originalShortName, "originalShortName");
  if (shortName && !shortName.ok) return badRequest(shortName.message);
  const language = body.originalLanguage === undefined ? undefined : parseOriginalLanguage(body.originalLanguage);
  if (language && !language.ok) return badRequest(language.message);
  const description = body.originalDescription === undefined ? undefined : nullableString(body.originalDescription, "originalDescription");
  if (description && !description.ok) return badRequest(description.message);
  // The shared parser uses null for omitted optional keys on create.
  const rows = translations.value.map((row, i) => {
    const input = (body.translations as Record<string, unknown>[])[i];
    return { ...row, shortName: "shortName" in input ? row.shortName : undefined,
      description: "description" in input ? row.description : undefined };
  });

  try {
    const group = await prisma.$transaction(async (tx) => {
      const stored = await tx.group.findUnique({
        where: { id: id },
        include: { translations: true },
      });
      if (!stored) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
      const message = checkIdentityNames("그룹", {
        originalName: name?.value ?? stored.originalName,
        originalShortName: shortName ? shortName.value : stored.originalShortName,
        originalLanguage: language?.value ?? stored.originalLanguage,
        translations: rows,
      }, stored);
      if (message) return badRequest(message);
      return tx.group.update({
        where: { id },
        data: {
          slug: slug.value,
          type: "type" in body ? typeCheck.value : undefined,
          category: "category" in body ? categoryCheck.value : undefined,
          hasBoard: "hasBoard" in body ? (hasBoardCheck.value ?? false) : undefined,
          originalName: name?.value,
          originalShortName: shortName?.value,
          originalDescription: description?.value,
          originalLanguage: language?.value,
          translations: { upsert: rows.map(({ locale, ...data }) => ({
            where: { groupId_locale: { groupId: id, locale } },
            create: { locale, ...data },
            update: data,
          })) },
        },
        include: { translations: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (group instanceof NextResponse) return group;
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(group));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return NextResponse.json({ error: "동시에 수정되었습니다. 다시 불러온 뒤 저장하세요." }, { status: 409 });
    }
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
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  // eslint-disable-next-line no-restricted-syntax -- whole-entity DELETE, not a save: every row goes with the entity
  await prisma.groupTranslation.deleteMany({ where: { groupId: id } });
  await prisma.artistGroup.deleteMany({ where: { groupId: id } });
  await prisma.group.delete({ where: { id } });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}

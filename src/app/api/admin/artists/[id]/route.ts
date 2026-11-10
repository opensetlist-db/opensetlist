import { checkIdentityNames, identityTranslations } from "@/lib/adminIdentityNames";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { ArtistType, GroupCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  enumValue,
  nullableBigIntId,
  nullableBoolean,
  nullableEnumValue,
  nullableString,
  nullableStringArray,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
  requireString,
} from "@/lib/admin-input";
import {
  parseArtistDisplayFields,
  parseArtistTranslations,
} from "../_validate";
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { ArtistParentCycleError, validateArtistParent } from "@/lib/adminArtistParent";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

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
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const artistId = BigInt(id);
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const typeCheck = body.type === undefined ? { ok: true as const, value: undefined } : enumValue(body.type, "type", Object.values(ArtistType));
  if (!typeCheck.ok) return badRequest(typeCheck.message);

  const parentArtistIdCheck = nullableBigIntId(body.parentArtistId, "parentArtistId");
  if (!parentArtistIdCheck.ok) return badRequest(parentArtistIdCheck.message);

  const groupIdsCheck = nullableStringArray(body.groupIds, "groupIds");
  if (!groupIdsCheck.ok) return badRequest(groupIdsCheck.message);

  const hasBoardCheck = nullableBoolean(body.hasBoard, "hasBoard");
  if (!hasBoardCheck.ok) return badRequest(hasBoardCheck.message);

  const categoryCheck = nullableEnumValue(
    body.category,
    "category",
    Object.values(GroupCategory),
  );
  if (!categoryCheck.ok) return badRequest(categoryCheck.message);

  const isMainUnitCheck = nullableBoolean(body.isMainUnit, "isMainUnit");
  if (!isMainUnitCheck.ok) return badRequest(isMainUnitCheck.message);

  // Absent keys are left out → those columns stay as stored (see
  // `parseArtistDisplayFields`).
  const display = parseArtistDisplayFields(body);
  if (!display.ok) return badRequest(display.message);

  const translations = identityTranslations(body.translations, parseArtistTranslations);
  if (!translations.ok) return badRequest(translations.message);

  const name = body.originalName === undefined ? undefined : requireString(body.originalName, "originalName");
  if (name && !name.ok) return badRequest(name.message);
  const shortName = body.originalShortName === undefined ? undefined : nullableString(body.originalShortName, "originalShortName");
  if (shortName && !shortName.ok) return badRequest(shortName.message);
  const language = body.originalLanguage === undefined ? undefined : parseOriginalLanguage(body.originalLanguage);
  if (language && !language.ok) return badRequest(language.message);
  const bio = body.originalBio === undefined ? undefined : nullableString(body.originalBio, "originalBio");
  if (bio && !bio.ok) return badRequest(bio.message);
  const rows = translations.value;

  try {
    const artist = await prisma.$transaction(async (tx) => {
      if ("parentArtistId" in body) await validateArtistParent(tx, artistId, parentArtistIdCheck.value);
      const stored = await tx.artist.findUnique({
        where: { id: artistId },
        include: { translations: true, groupLinks: true },
      });
      if (!stored || stored.isDeleted) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
      const message = checkIdentityNames("아티스트", {
        originalName: name?.value ?? stored.originalName,
        originalShortName: shortName ? shortName.value : stored.originalShortName,
        originalLanguage: language?.value ?? stored.originalLanguage,
        translations: rows,
      }, stored, stored.slug);
      if (message) return badRequest(message);
      const storedGroups = new Set(stored.groupLinks.map((link) => link.groupId));
      const nextGroups = new Set(groupIdsCheck.value);
      return tx.artist.update({
        where: { id: artistId },
        data: {
          type: typeCheck.value,
          parentArtistId: "parentArtistId" in body ? parentArtistIdCheck.value : undefined,
          hasBoard: "hasBoard" in body ? (hasBoardCheck.value ?? true) : undefined,
          category: "category" in body ? categoryCheck.value : undefined,
          isMainUnit: (typeCheck.value ?? stored.type) === "unit"
            ? ("isMainUnit" in body ? (isMainUnitCheck.value ?? false) : undefined)
            : false,
          ...display.value,
          originalName: name?.value,
          originalShortName: shortName?.value,
          originalBio: bio?.value,
          originalLanguage: language?.value,
          translations: { upsert: rows.map(({ locale, ...data }) => ({
            where: { artistId_locale: { artistId: artistId, locale } },
            create: { locale, ...data },
            update: data,
          })) },
          groupLinks: "groupIds" in body ? {
            deleteMany: { groupId: { notIn: [...nextGroups] } },
            create: [...nextGroups].filter((groupId) => !storedGroups.has(groupId)).map((groupId) => ({ groupId })),
          } : undefined,
        },
        include: { translations: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (artist instanceof NextResponse) return artist;
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(artist));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "동시에 수정되었습니다. 다시 불러온 뒤 저장하세요." }, { status: 409 });
    }
    if (error instanceof ArtistParentCycleError) return badRequest(error.message);
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await prisma.artist.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}

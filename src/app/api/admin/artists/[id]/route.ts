import { NextRequest, NextResponse } from "next/server";
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
import { parseArtistTranslations } from "../_validate";

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
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const typeCheck = enumValue(body.type, "type", Object.values(ArtistType));
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

  const name = requireString(body.originalName, "originalName");
  if (!name.ok) return badRequest(name.message);

  const shortName = nullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return badRequest(shortName.message);

  const bio = nullableString(body.originalBio, "originalBio");
  if (!bio.ok) return badRequest(bio.message);

  const language = parseOriginalLanguage(body.originalLanguage);
  if (!language.ok) return badRequest(language.message);

  const translations = parseArtistTranslations(body.translations);
  if (!translations.ok) return badRequest(translations.message);

  // Atomic delete-then-update: a failure on the update would otherwise leave the artist with no translations/group links.
  const artist = await prisma.$transaction(async (tx) => {
    await tx.artistTranslation.deleteMany({ where: { artistId } });
    await tx.artistGroup.deleteMany({ where: { artistId } });
    return tx.artist.update({
      where: { id: artistId },
      data: {
        type: typeCheck.value,
        parentArtistId: parentArtistIdCheck.value,
        hasBoard: hasBoardCheck.value ?? true,
        category: categoryCheck.value,
        isMainUnit: isMainUnitCheck.value ?? false,
        originalName: name.value,
        originalShortName: shortName.value,
        originalBio: bio.value,
        originalLanguage: language.value,
        translations: { create: translations.value },
        groupLinks: groupIdsCheck.value.length
          ? { create: groupIdsCheck.value.map((gid) => ({ groupId: gid })) }
          : undefined,
      },
      include: { translations: true },
    });
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

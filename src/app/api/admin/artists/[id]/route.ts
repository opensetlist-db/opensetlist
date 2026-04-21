import { NextRequest, NextResponse } from "next/server";
import type { ArtistType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import {
  badRequest,
  nullableString,
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
  const { type, parentArtistId, hasBoard, groupIds } = body as {
    type?: ArtistType;
    parentArtistId?: string | number | null;
    hasBoard?: boolean;
    groupIds?: string[];
  };

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

  await prisma.artistTranslation.deleteMany({ where: { artistId } });
  await prisma.artistGroup.deleteMany({ where: { artistId } });

  const artist = await prisma.artist.update({
    where: { id: artistId },
    data: {
      type,
      parentArtistId: parentArtistId ? BigInt(parentArtistId) : null,
      hasBoard: hasBoard ?? true,
      originalName: name.value,
      originalShortName: shortName.value,
      originalBio: bio.value,
      originalLanguage: language.value,
      translations: { create: translations.value },
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

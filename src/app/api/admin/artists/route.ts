import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ArtistType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug, resolveAdminSlug } from "@/lib/slug";
import {
  badRequest,
  enumValue,
  nullableBigIntId,
  nullableBoolean,
  nullableString,
  nullableStringArray,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
  requireString,
} from "@/lib/admin-input";
import {
  parseArtistTranslations,
  parseStageIdentities,
} from "./_validate";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  const where: Record<string, unknown> = { isDeleted: false };
  if (q) {
    where.translations = { some: { name: { contains: q, mode: "insensitive" } } };
  }

  const artists = await prisma.artist.findMany({
    where,
    include: {
      translations: true,
      parentArtist: { include: { translations: true } },
      groupLinks: {
        include: { group: { include: { translations: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(serializeBigInt(artists));
}

export async function POST(request: NextRequest) {
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

  const stageIdentities = parseStageIdentities(body.stageIdentities);
  if (!stageIdentities.ok) return badRequest(stageIdentities.message);

  const slug = resolveAdminSlug(body.slug, translations.value[0]?.name ?? "", "artist");

  // Single nested create = one transaction; an artist-insert failure no longer leaves orphan StageIdentity/RealPerson rows.
  const artist = await prisma.artist.create({
    data: {
      slug,
      type: typeCheck.value,
      parentArtistId: parentArtistIdCheck.value,
      hasBoard: hasBoardCheck.value ?? true,
      originalName: name.value,
      originalShortName: shortName.value,
      originalBio: bio.value,
      originalLanguage: language.value,
      translations: { create: translations.value },
      groupLinks: groupIdsCheck.value.length
        ? { create: groupIdsCheck.value.map((gid) => ({ groupId: gid })) }
        : undefined,
      stageLinks: stageIdentities.value.length
        ? {
            create: stageIdentities.value.map((si) => {
              // Two stage identities entered with the same name would otherwise produce identical slugs and fail the @unique constraint; va-${siSlug} inherits the suffix and stays unique too. The "identity" fallback covers names that normalize to "" (e.g. all-symbol input).
              const siBaseSlug =
                generateSlug(si.translations[0]?.name || si.originalName || "identity") ||
                "identity";
              const siSlug = `${siBaseSlug}-${randomUUID().slice(0, 8)}`;
              return {
                stageIdentity: {
                  create: {
                    slug: siSlug,
                    type: si.type,
                    color: si.color,
                    originalName: si.originalName,
                    originalShortName: si.originalShortName,
                    originalLanguage: si.originalLanguage,
                    translations: { create: si.translations },
                    voicedBy: si.realPerson
                      ? {
                          create: {
                            realPerson: {
                              create: {
                                slug: `va-${siSlug}`,
                                originalName: si.realPerson.originalName,
                                originalStageName: si.realPerson.originalStageName,
                                originalLanguage: si.realPerson.originalLanguage,
                                translations: { create: si.realPerson.translations },
                              },
                            },
                          },
                        }
                      : undefined,
                  },
                },
              };
            }),
          }
        : undefined,
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(artist), { status: 201 });
}

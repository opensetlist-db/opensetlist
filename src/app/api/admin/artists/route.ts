import { NextRequest, NextResponse } from "next/server";
import type { ArtistType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import {
  badRequest,
  nullableString,
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
  const { type, parentArtistId, hasBoard, groupIds } = body as {
    type?: ArtistType;
    parentArtistId?: string | number | null;
    hasBoard?: boolean;
    groupIds?: string[];
  };
  if (!type) return badRequest("type is required");

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

  const slug =
    (typeof body.slug === "string" && body.slug) ||
    generateSlug(translations.value[0]?.name || `artist-${Date.now()}`);

  const artist = await prisma.artist.create({
    data: {
      slug,
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
      stageLinks: stageIdentities.value.length
        ? {
            create: await Promise.all(
              stageIdentities.value.map(async (si) => {
                const siSlug = generateSlug(
                  si.translations[0]?.name || si.originalName || "identity"
                );
                const stageIdentity = await prisma.stageIdentity.create({
                  data: {
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
                });
                return { stageIdentityId: stageIdentity.id };
              })
            ),
          }
        : undefined,
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(artist), { status: 201 });
}

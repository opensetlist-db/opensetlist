import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

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

type IncomingStageIdentity = {
  type: string;
  color?: string;
  originalName?: string;
  originalShortName?: string | null;
  originalLanguage?: string;
  translations: { locale: string; name: string }[];
  realPerson?: {
    originalName?: string;
    originalStageName?: string | null;
    originalLanguage?: string;
    translations: { locale: string; name: string; stageName?: string }[];
  };
};

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    type,
    parentArtistId,
    hasBoard,
    translations,
    groupIds,
    stageIdentities,
    originalName,
    originalShortName,
    originalBio,
    originalLanguage,
  } = body;

  const trimmedOriginalName = typeof originalName === "string" ? originalName.trim() : "";
  if (!trimmedOriginalName) {
    return NextResponse.json(
      { error: "originalName is required" },
      { status: 400 }
    );
  }

  let resolvedOriginalLanguage: string;
  try {
    resolvedOriginalLanguage = resolveOriginalLanguage(originalLanguage);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  // Validate every nested SI + RP up front so we don't leave behind a half-built artist.
  const incomingSIs: IncomingStageIdentity[] = stageIdentities ?? [];
  const resolvedSIs: {
    si: IncomingStageIdentity;
    siOriginalName: string;
    siOriginalLanguage: string;
    rpOriginalName: string | null;
    rpOriginalLanguage: string | null;
  }[] = [];
  for (const si of incomingSIs) {
    const siOriginalName = typeof si.originalName === "string" ? si.originalName.trim() : "";
    if (!siOriginalName) {
      return NextResponse.json(
        { error: "stageIdentities[].originalName is required" },
        { status: 400 }
      );
    }
    let siOriginalLanguage: string;
    try {
      siOriginalLanguage = resolveOriginalLanguage(si.originalLanguage);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }

    let rpOriginalName: string | null = null;
    let rpOriginalLanguage: string | null = null;
    if (si.realPerson) {
      const rpName = typeof si.realPerson.originalName === "string"
        ? si.realPerson.originalName.trim()
        : "";
      if (!rpName) {
        return NextResponse.json(
          { error: "stageIdentities[].realPerson.originalName is required" },
          { status: 400 }
        );
      }
      rpOriginalName = rpName;
      try {
        rpOriginalLanguage = resolveOriginalLanguage(si.realPerson.originalLanguage);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : String(err) },
          { status: 400 }
        );
      }
    }

    resolvedSIs.push({ si, siOriginalName, siOriginalLanguage, rpOriginalName, rpOriginalLanguage });
  }

  const slug = body.slug || generateSlug(translations[0]?.name || `artist-${Date.now()}`);

  const artist = await prisma.artist.create({
    data: {
      slug,
      type,
      parentArtistId: parentArtistId ? BigInt(parentArtistId) : null,
      hasBoard: hasBoard ?? true,
      originalName: trimmedOriginalName,
      originalShortName: trimmedOrNull(originalShortName),
      originalBio: trimmedOrNull(originalBio),
      originalLanguage: resolvedOriginalLanguage,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; bio?: string }) => ({
            locale: t.locale,
            name: t.name,
            bio: t.bio || null,
          })
        ),
      },
      groupLinks: groupIds?.length
        ? { create: groupIds.map((gid: string) => ({ groupId: gid })) }
        : undefined,
      stageLinks: resolvedSIs.length
        ? {
            create: await Promise.all(
              resolvedSIs.map(
                async ({ si, siOriginalName, siOriginalLanguage, rpOriginalName, rpOriginalLanguage }) => {
                  // Create StageIdentity first
                  const siSlug = generateSlug(si.translations[0]?.name || siOriginalName || "identity");
                  const stageIdentity = await prisma.stageIdentity.create({
                    data: {
                      slug: siSlug,
                      type: si.type as "character" | "persona",
                      color: si.color || null,
                      originalName: siOriginalName,
                      originalShortName: trimmedOrNull(si.originalShortName),
                      originalLanguage: siOriginalLanguage,
                      translations: {
                        create: si.translations.map((t) => ({
                          locale: t.locale,
                          name: t.name,
                        })),
                      },
                      voicedBy: si.realPerson
                        ? {
                            create: {
                              realPerson: {
                                create: {
                                  slug: `va-${siSlug}`,
                                  originalName: rpOriginalName!,
                                  originalStageName: trimmedOrNull(si.realPerson.originalStageName),
                                  originalLanguage: rpOriginalLanguage!,
                                  translations: {
                                    create: si.realPerson.translations.map(
                                      (t) => ({
                                        locale: t.locale,
                                        name: t.name,
                                        stageName: t.stageName || null,
                                      })
                                    ),
                                  },
                                },
                              },
                            },
                          }
                        : undefined,
                    },
                  });
                  return { stageIdentityId: stageIdentity.id };
                }
              )
            ),
          }
        : undefined,
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(artist), { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

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
  const body = await request.json();
  const {
    type,
    parentArtistId,
    hasBoard,
    translations,
    groupIds,
    stageIdentities,
  } = body;

  const artist = await prisma.artist.create({
    data: {
      type,
      parentArtistId: parentArtistId ? BigInt(parentArtistId) : null,
      hasBoard: hasBoard ?? true,
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
      stageLinks: stageIdentities?.length
        ? {
            create: await Promise.all(
              stageIdentities.map(
                async (si: {
                  type: string;
                  color?: string;
                  translations: { locale: string; name: string }[];
                  realPerson?: {
                    translations: {
                      locale: string;
                      name: string;
                      stageName?: string;
                    }[];
                  };
                }) => {
                  // Create StageIdentity first
                  const stageIdentity = await prisma.stageIdentity.create({
                    data: {
                      type: si.type as "character" | "persona",
                      color: si.color || null,
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

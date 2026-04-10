import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

type Props = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artistId = BigInt(id);
  const body = await request.json();
  const { existingStageIdentityId, type, color, translations, realPerson } = body;

  // Link existing stage identity to this artist
  if (existingStageIdentityId) {
    const link = await prisma.stageIdentityArtist.create({
      data: {
        stageIdentityId: existingStageIdentityId,
        artistId,
      },
    });
    return NextResponse.json(serializeBigInt(link), { status: 201 });
  }

  // Create new stage identity
  const stageIdentity = await prisma.stageIdentity.create({
    data: {
      type,
      color: color || null,
      translations: {
        create: translations.map((t: { locale: string; name: string }) => ({
          locale: t.locale,
          name: t.name,
        })),
      },
      artistLinks: {
        create: { artistId },
      },
      voicedBy: realPerson?.translations?.[0]?.name
        ? {
            create: {
              realPerson: {
                create: {
                  translations: {
                    create: realPerson.translations.map(
                      (t: { locale: string; name: string; stageName?: string }) => ({
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
    include: {
      translations: true,
      voicedBy: {
        include: { realPerson: { include: { translations: true } } },
      },
    },
  });

  return NextResponse.json(serializeBigInt(stageIdentity), { status: 201 });
}

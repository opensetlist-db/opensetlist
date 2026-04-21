import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

type Props = { params: Promise<{ id: string }> };

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artistId = BigInt(id);
  const body = await request.json();
  const {
    existingStageIdentityId,
    type,
    color,
    translations,
    realPerson,
    originalName,
    originalShortName,
    originalLanguage,
  } = body;

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

  const hasRealPerson = realPerson?.translations?.[0]?.name;
  let rpOriginalName = "";
  let rpOriginalLanguage = "ja";
  if (hasRealPerson) {
    rpOriginalName = typeof realPerson.originalName === "string"
      ? realPerson.originalName.trim()
      : "";
    if (!rpOriginalName) {
      return NextResponse.json(
        { error: "realPerson.originalName is required" },
        { status: 400 }
      );
    }
    try {
      rpOriginalLanguage = resolveOriginalLanguage(realPerson.originalLanguage);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 }
      );
    }
  }

  // Create new stage identity
  const siSlug = body.slug || generateSlug(translations?.[0]?.name || trimmedOriginalName || "identity");
  const stageIdentity = await prisma.stageIdentity.create({
    data: {
      slug: siSlug,
      type,
      color: color || null,
      originalName: trimmedOriginalName,
      originalShortName: trimmedOrNull(originalShortName),
      originalLanguage: resolvedOriginalLanguage,
      translations: {
        create: translations.map((t: { locale: string; name: string }) => ({
          locale: t.locale,
          name: t.name,
        })),
      },
      artistLinks: {
        create: { artistId },
      },
      voicedBy: hasRealPerson
        ? {
            create: {
              realPerson: {
                create: {
                  slug: `va-${siSlug}`,
                  originalName: rpOriginalName,
                  originalStageName: trimmedOrNull(realPerson.originalStageName),
                  originalLanguage: rpOriginalLanguage,
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

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artistId = BigInt(id);
  const { stageIdentityId } = await request.json();

  await prisma.stageIdentityArtist.deleteMany({
    where: { stageIdentityId, artistId },
  });

  return NextResponse.json({ ok: true });
}

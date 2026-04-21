import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug } from "@/lib/slug";
import {
  badRequest,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  requireString,
} from "@/lib/admin-input";
import {
  ParsedRealPerson,
  parseRealPerson,
  parseStageIdentityTranslations,
} from "../../_validate";

type Props = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const artistId = BigInt(id);
  const body = await request.json();
  const { existingStageIdentityId, type, color } = body;

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

  if (type !== "character" && type !== "persona") {
    return badRequest('type must be "character" or "persona"');
  }

  const name = requireString(body.originalName, "originalName");
  if (!name.ok) return badRequest(name.message);

  const shortName = nullableString(body.originalShortName, "originalShortName");
  if (!shortName.ok) return badRequest(shortName.message);

  const colorValue = nullableString(color, "color");
  if (!colorValue.ok) return badRequest(colorValue.message);

  const language = parseOriginalLanguage(body.originalLanguage);
  if (!language.ok) return badRequest(language.message);

  const translations = parseStageIdentityTranslations(body.translations, "translations");
  if (!translations.ok) return badRequest(translations.message);

  // Match the bulk-create path: presence of `realPerson` (any non-nullish value)
  // means "create a voicedBy". The nested parser then validates required fields.
  let realPerson: ParsedRealPerson | null = null;
  if (body.realPerson !== undefined && body.realPerson !== null) {
    const parsed = parseRealPerson(body.realPerson, "realPerson");
    if (!parsed.ok) return badRequest(parsed.message);
    realPerson = parsed.value;
  }

  const siSlug = body.slug || generateSlug(translations.value[0]?.name || name.value || "identity");
  const stageIdentity = await prisma.stageIdentity.create({
    data: {
      slug: siSlug,
      type,
      color: colorValue.value,
      originalName: name.value,
      originalShortName: shortName.value,
      originalLanguage: language.value,
      translations: { create: translations.value },
      artistLinks: {
        create: { artistId },
      },
      voicedBy: realPerson
        ? {
            create: {
              realPerson: {
                create: {
                  slug: `va-${siSlug}`,
                  originalName: realPerson.originalName,
                  originalStageName: realPerson.originalStageName,
                  originalLanguage: realPerson.originalLanguage,
                  translations: { create: realPerson.translations },
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

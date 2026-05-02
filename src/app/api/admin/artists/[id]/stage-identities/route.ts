import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { resolveCanonicalSlug } from "@/lib/slug";
import {
  badRequest,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  parseJsonBody,
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
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;
  const { existingStageIdentityId, type, color } = body as {
    existingStageIdentityId?: string;
    type?: string;
    color?: string | null;
  };

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

  // Append randomUUID suffix to match the bulk artists POST path: without it,
  // two stage identities created with the same name (and no explicit slug)
  // would derive identical slugs and trip the @unique constraint. va-${siSlug}
  // inherits the suffix below so the VA RealPerson stays unique too.
  const siBaseResult = await resolveCanonicalSlug(
    body.slug,
    translations.value[0]?.name || name.value,
    "identity"
  );
  if (!siBaseResult.ok) return badRequest(siBaseResult.message);
  const siSlug = `${siBaseResult.slug}-${randomUUID().slice(0, 8)}`;
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
                  originalShortName: realPerson.originalShortName,
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
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const stageIdentityId = requireString(parsed.body.stageIdentityId, "stageIdentityId");
  if (!stageIdentityId.ok) return badRequest(stageIdentityId.message);

  await prisma.stageIdentityArtist.deleteMany({
    where: { stageIdentityId: stageIdentityId.value, artistId },
  });

  return NextResponse.json({ ok: true });
}

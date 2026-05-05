import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { ArtistType, GroupCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { deriveSlug, isSlugUniqueViolation, resolveCanonicalSlug } from "@/lib/slug";
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

  const stageIdentities = parseStageIdentities(body.stageIdentities);
  if (!stageIdentities.ok) return badRequest(stageIdentities.message);

  const slugResult = await resolveCanonicalSlug(
    body.slug,
    // Same fallback chain as event-series/route.ts: when translations
    // is absent or its first entry's name is empty, fall back to
    // `name.value` (validated as required just above) so a JP/KO
    // originalName still feeds `deriveSlug` for transliteration
    // instead of the auto-path emitting `artist-${ts}`.
    translations.value[0]?.name || name.value,
    "artist"
  );
  if (!slugResult.ok) return badRequest(slugResult.message);
  const slug = slugResult.slug;

  // Pre-derive each stage identity's slug via `deriveSlug` so the
  // synchronous `.map()` in the nested-create payload below can stay
  // synchronous. This matches the standalone
  // `/api/admin/artists/[id]/stage-identities` path (which calls
  // `resolveCanonicalSlug` → `deriveSlug`) — without it, JP/KO-named
  // initial members fell through `generateSlug`'s ASCII-only path to
  // "identity-<uuid>" / "va-identity-<uuid>", so the same artist's
  // members got transliterated slugs when added one-by-one but
  // identity-fallback slugs when supplied at parent-create time. The
  // randomUUID(8) suffix is preserved here for the same reason it's
  // there in the standalone path: two members typed with the same
  // name would otherwise collide on the @unique constraint.
  const stageIdentitySlugs = await Promise.all(
    stageIdentities.value.map(async (si) => {
      const baseSource =
        si.translations[0]?.name || si.originalName || "identity";
      const derived = (await deriveSlug(baseSource)) || "identity";
      return `${derived}-${randomUUID().slice(0, 8)}`;
    })
  );

  // Single nested create = one transaction; an artist-insert failure no longer leaves orphan StageIdentity/RealPerson rows.
  try {
    const artist = await prisma.artist.create({
      data: {
        slug,
        type: typeCheck.value,
        parentArtistId: parentArtistIdCheck.value,
        hasBoard: hasBoardCheck.value ?? true,
        category: categoryCheck.value,
        // isMainUnit is meaningless for non-unit artists. Force to
        // false on the server so a stale form value (operator flipped
        // type from unit→solo without unchecking the box) can't poison
        // the chip-strip query later. Strictly speaking the chip query
        // also filters by parentArtistId being set, but a non-unit
        // sub-artist could still slip through; the constraint at the
        // schema layer is permissive, so we enforce it here.
        isMainUnit:
          typeCheck.value === "unit" ? (isMainUnitCheck.value ?? false) : false,
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
              create: stageIdentities.value.map((si, idx) => {
                // `va-${siSlug}` inherits the UUID suffix from the
                // pre-derived `siSlug` so the VA RealPerson stays
                // unique alongside the StageIdentity it belongs to.
                const siSlug = stageIdentitySlugs[idx];
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
                                  originalShortName: si.realPerson.originalShortName,
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
  } catch (e) {
    // P2002 here covers many unique constraints, not just slug: the
    // parent artist slug, the nested StageIdentity / RealPerson slugs
    // (UUID-suffixed so practically never collide), the
    // ArtistTranslation / StageIdentityTranslation locale composites,
    // and the ArtistGroup / StageIdentityArtist join-table uniques.
    // Inspect e.meta?.target so a duplicate-translation-locale or
    // group-link error doesn't get misreported as a slug collision.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      if (isSlugUniqueViolation(e.meta?.target)) {
        return NextResponse.json(
          {
            error: `슬러그 '${slug}'가 이미 사용 중입니다. 다른 슬러그를 입력하세요.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: "중복된 항목이 있습니다. 입력값을 확인해 주세요.",
        },
        { status: 409 }
      );
    }
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { parseSongTranslations, songNameError, songNameSnapshot, songTranslationTitle } from "@/lib/admin/songNames";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const songId = BigInt(id);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "곡 입력값을 확인해 주세요." }, { status: 400 });
  }
  const {
    originalTitle,
    originalLanguage,
    variantLabel,
    sourceNote,
    releaseDate,
    baseVersionId,
    artistCredits,
  } = body;
  const translations = parseSongTranslations(body.translations === undefined ? [] : body.translations);
  if (!translations ||
      (originalTitle !== undefined && typeof originalTitle !== "string") ||
      (originalLanguage !== undefined && typeof originalLanguage !== "string") ||
      (variantLabel != null && typeof variantLabel !== "string") ||
      (artistCredits !== undefined && !Array.isArray(artistCredits))) {
    return NextResponse.json({ error: "곡의 원제, 원어 또는 언어별 표기를 확인해 주세요." }, { status: 400 });
  }

  try {
    // Validate and save against the same snapshot. A concurrent edit can change
    // the source or a required translation after we have checked the pair.
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.song.findUnique({
        where: { id: songId, isDeleted: false },
        include: { translations: true },
      });
      if (!current) return { error: "곡을 찾을 수 없습니다.", status: 404 } as const;
      if (body.expectedNames !== undefined && body.expectedNames !== songNameSnapshot(current)) {
        return { error: "곡 표기가 이미 수정되었습니다. 새로고침 후 다시 시도해 주세요.", status: 409 } as const;
      }

      const originalVariant = variantLabel === undefined
        ? current.variantLabel
        : variantLabel?.trim() ? variantLabel : null;
      const mergedTranslations = new Map<string, { locale: string; title?: string; variantLabel?: string | null }>(
        current.translations.map((row) => [row.locale, row]),
      );
      for (const { locale, title, variantLabel } of translations) {
        const saved = mergedTranslations.get(locale);
        mergedTranslations.set(locale, {
          locale,
          title: title ?? saved?.title ?? "",
          variantLabel: variantLabel === undefined ? saved?.variantLabel ?? null : variantLabel,
        });
      }
      const nextTitle = originalTitle ?? current.originalTitle;
      const nextLanguage = originalLanguage ?? current.originalLanguage;
      const error = songNameError({
        originalTitle: nextTitle,
        originalLanguage: nextLanguage,
        variantLabel: originalVariant,
        translations: [...mergedTranslations.values()],
      }, translations, body.reviewedNames === true, current);
      if (error) return { error, status: 400 } as const;

      if (artistCredits !== undefined) await tx.songArtist.deleteMany({ where: { songId } });
      const song = await tx.song.update({
        where: { id: songId },
        data: {
          originalTitle,
          originalLanguage,
          variantLabel: variantLabel === undefined ? undefined : originalVariant,
          sourceNote,
          releaseDate: releaseDate === undefined ? undefined : releaseDate ? new Date(releaseDate) : null,
          baseVersionId: baseVersionId === undefined ? undefined : baseVersionId ? BigInt(baseVersionId) : null,
          translations: {
            upsert: translations
              .filter((row) => row.title?.trim() || row.variantLabel ||
                current.translations.some((saved) => saved.locale === row.locale))
              .map(({ locale, title, variantLabel }) => ({
                where: { songId_locale: { songId, locale } },
                create: { locale, title: songTranslationTitle(title, nextTitle, nextLanguage, locale), variantLabel },
                update: { title: title === undefined ? undefined : songTranslationTitle(title, nextTitle, nextLanguage, locale), variantLabel },
              })),
          },
          artists: artistCredits?.length ? {
            create: artistCredits.map((ac: { artistId: number; role: string }) => ({
              artistId: BigInt(ac.artistId),
              role: ac.role,
            })),
          } : undefined,
        },
        include: { translations: true },
      });
      return { song };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.error) return NextResponse.json({ error: result.error }, { status: result.status });
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(result.song));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "곡이 동시에 수정되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  await prisma.song.update({
    where: { id: BigInt(id) },
    data: { isDeleted: true, deletedAt: new Date() },
  });
  revalidatePublicData();
  return NextResponse.json({ success: true });
}

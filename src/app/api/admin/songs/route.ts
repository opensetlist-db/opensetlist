import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateUniqueSlug, resolveAdminSlug } from "@/lib/slug";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");

  const where: Record<string, unknown> = { isDeleted: false };
  if (q) {
    where.OR = [
      { originalTitle: { contains: q, mode: "insensitive" } },
      { translations: { some: { title: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const songs = await prisma.song.findMany({
    where,
    include: {
      translations: true,
      artists: {
        include: { artist: { include: { translations: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json(serializeBigInt(songs));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    originalTitle,
    originalLanguage,
    variantLabel,
    sourceNote,
    releaseDate,
    baseVersionId,
    translations,
    artistCredits,
  } = body;

  // Slug resolution. Two failure modes the previous `generateSlug(title)`
  // call hit in production:
  //   1. Japanese/Korean titles (e.g. "ハナムスビ") strip to "" — every song
  //      after the first to claim "" hits P2002 on the @unique slug.
  //   2. Variants legitimately share originalTitle ("Dream Believers" +
  //      "Dream Believers (SAKURA Ver.)") and would collide too.
  // generateUniqueSlug transliterates Japanese via kuroshiro and appends
  // -2/-3 on collision, mirroring the pattern already used by artists.
  // resolveAdminSlug is for the explicit-override path: an admin-supplied
  // slug is taken verbatim and surfaces a 409 below if it collides, so
  // the operator can pick a different one rather than us silently mangling
  // their input.
  const slug = body.slug
    ? resolveAdminSlug(body.slug, originalTitle, "song")
    : await generateUniqueSlug(originalTitle, "song");

  try {
    const song = await prisma.song.create({
      data: {
        slug,
        originalTitle,
        originalLanguage: originalLanguage || "ja",
        variantLabel: variantLabel || null,
        sourceNote: sourceNote || null,
        releaseDate: releaseDate ? new Date(releaseDate) : null,
        baseVersionId: baseVersionId ? BigInt(baseVersionId) : null,
        translations: {
          create: translations.map(
            (t: { locale: string; title: string }) => ({
              locale: t.locale,
              title: t.title,
            })
          ),
        },
        artists: artistCredits?.length
          ? {
              create: artistCredits.map(
                (ac: { artistId: number; role: string }) => ({
                  artistId: BigInt(ac.artistId),
                  role: ac.role,
                })
              ),
            }
          : undefined,
      },
      include: { translations: true },
    });
    return NextResponse.json(serializeBigInt(song), { status: 201 });
  } catch (e) {
    // Defence in depth: a race between generateUniqueSlug's existence
    // check and the create, or an admin-supplied slug that collides,
    // both surface as P2002 here. Return a clear 409 so the form can
    // show a useful message instead of bouncing through a generic 500.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: `슬러그 '${slug}'가 이미 사용 중입니다. 다른 슬러그를 입력하세요.` },
        { status: 409 }
      );
    }
    throw e;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { generateSlug, generateUniqueSlug } from "@/lib/slug";

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

  // Slug resolution. Two paths:
  //
  //   - Admin-supplied (body.slug): treat as verbatim. Validate that
  //     the input is already in canonical slug form (lowercase
  //     alphanumeric + hyphens) by round-tripping through generateSlug
  //     and rejecting if it doesn't match — this avoids silently
  //     normalizing/mangling the operator's input. If the slug
  //     collides on the @unique constraint, surface a 409 so the
  //     operator picks a different one.
  //
  //   - Auto-generated: generateUniqueSlug transliterates Japanese
  //     via kuroshiro ("ハナムスビ" → "hanamusubi"), falls back to
  //     song-{ts} if even that's empty, and appends -2/-3 on
  //     existence checks. The check-then-insert is racy under
  //     concurrent requests, so we wrap the create in a small retry
  //     loop and re-roll the slug on P2002 instead of returning 409.
  //
  // Why two paths share the create call: the body validation and the
  // many nested relations are identical; only the slug source differs.
  let adminSlug: string | null = null;
  if (typeof body.slug === "string" && body.slug.trim().length > 0) {
    const trimmed = body.slug.trim();
    // generateSlug is idempotent on already-canonical input. If the
    // round-trip changes anything, the input wasn't canonical (had
    // uppercase, spaces, non-ASCII, leading/trailing hyphens, etc.)
    // and we reject rather than silently rewriting it.
    const canonical = generateSlug(trimmed);
    if (!canonical || canonical !== trimmed) {
      return NextResponse.json(
        {
          error:
            "슬러그는 영소문자, 숫자, 하이픈으로만 구성된 URL-safe 형식이어야 합니다 (예: my-song-title).",
        },
        { status: 400 }
      );
    }
    adminSlug = canonical;
  }

  // 3 attempts is enough headroom for the auto-gen race without
  // turning a runaway collision into an unbounded loop.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const slug = adminSlug ?? (await generateUniqueSlug(originalTitle, "song"));
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
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        if (adminSlug) {
          return NextResponse.json(
            {
              error: `슬러그 '${adminSlug}'가 이미 사용 중입니다. 다른 슬러그를 입력하세요.`,
            },
            { status: 409 }
          );
        }
        // Auto-gen lost the race — re-roll on the next iteration.
        continue;
      }
      throw e;
    }
  }

  // All attempts collided on auto-gen. Extremely unlikely outside of
  // a test that hammers the same title concurrently, but worth a
  // clear response instead of a hung request.
  return NextResponse.json(
    {
      error:
        "슬러그 생성 중 충돌이 계속 발생했습니다. 잠시 후 다시 시도해 주세요.",
    },
    { status: 409 }
  );
}

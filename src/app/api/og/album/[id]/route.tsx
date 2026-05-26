import { ImageResponse } from "@vercel/og";
import { prisma } from "@/lib/prisma";
import { displayNameWithFallback, resolveLocalizedField } from "@/lib/display";
import { loadOgFonts, OG_FONT_STACK, titleFontSize } from "@/lib/ogFonts";
import { BRAND_GRADIENT, getArtistColor } from "@/lib/artistColor";
import { normalizeOgLocale } from "@/lib/ogLabels";

/*
 * Open Graph image for `/[locale]/albums/[id]/...`. Mirrors the
 * Event/Song OG endpoints' shape but is materially simpler — there's
 * no time-derived status pill to invalidate at (Album has no clock
 * boundary), no palette fingerprint param (the artist color is the
 * single source for the background and changes infrequently), and the
 * cover image itself stays sidebar-only on the page render rather
 * than being embedded in the OG card (Amazon-hosted covers can't be
 * fetched cleanly through ImageResponse's outbound HTTP without a
 * fragile referrer/CORS dance — the brand background + locale-aware
 * type badge + title + artist is enough for the share unfurl).
 *
 * Cache: 1 h max-age + 24 h SWR. The OG URL is self-describing
 * (`?lang=<resolved>` only), so a rename in the underlying Album row
 * needs at most an hour to propagate. No `&v=` fingerprint because
 * we don't derive a palette here yet — when b03/b04 add one, bake it
 * into the URL the same way Event's `&v=${palette.fingerprint}` does.
 */

type Props = { params: Promise<{ id: string }> };

const DEFAULT_HEADERS = {
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
} as const;

// Error fallback must not be cached — a transient Prisma / font-load /
// render blip would otherwise poison CDN + crawler caches for hours
// with the generic brand card even after the underlying cause is fixed.
const ERROR_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const TITLE_FALLBACK = "OPENSETLIST";

export async function GET(req: Request, { params }: Props) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = normalizeOgLocale(url.searchParams.get("lang"));
  // FALLBACK_TITLES in ogLabels.ts is structured by per-locale per-
  // surface (event/song/artist) — there is no Album entry there yet
  // and the brand-string fallback is the right shape for the "page
  // not resolvable" branch anyway. Single literal kept here so it's
  // easy to swap for a localized version once an Album fallback
  // string is added.
  const fallback = TITLE_FALLBACK;

  if (!/^\d+$/.test(id)) {
    return renderDefault(fallback, await loadFontsSafe());
  }

  try {
    const album = await prisma.album.findUnique({
      where: { id: BigInt(id) },
      include: {
        translations: { where: { locale: { in: [lang, "ja"] } } },
        artists: {
          take: 1,
          include: {
            artist: {
              include: {
                translations: { where: { locale: { in: [lang, "ja"] } } },
              },
            },
          },
        },
      },
    });

    if (!album) {
      return renderDefault(fallback, await loadFontsSafe());
    }

    const title =
      resolveLocalizedField(
        album,
        album.translations,
        lang,
        "title",
        "originalTitle",
      ) ?? fallback;

    const primaryArtist = album.artists[0]?.artist ?? null;
    const artistName = primaryArtist
      ? displayNameWithFallback(
          primaryArtist,
          primaryArtist.translations,
          lang,
        )
      : "";
    const accent = primaryArtist
      ? (getArtistColor(primaryArtist) ?? BRAND_GRADIENT)
      : BRAND_GRADIENT;

    const fonts = await loadFontsSafe();

    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "flex-start",
            padding: "80px 96px",
            background: accent,
            color: "white",
            fontFamily: OG_FONT_STACK,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "8px 20px",
              background: "rgba(255, 255, 255, 0.18)",
              borderRadius: 999,
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 28,
            }}
          >
            {album.type}
          </div>
          <div
            style={{
              fontSize: titleFontSize(title).fontSize,
              fontWeight: 800,
              lineHeight: 1.1,
              maxWidth: 1000,
              marginBottom: artistName ? 28 : 0,
            }}
          >
            {title}
          </div>
          {artistName ? (
            <div
              style={{
                fontSize: 38,
                fontWeight: 600,
                opacity: 0.9,
              }}
            >
              {artistName}
            </div>
          ) : null}
        </div>
      ),
      { width: 1200, height: 630, fonts, headers: DEFAULT_HEADERS },
    );
  } catch {
    return renderDefault(fallback, await loadFontsSafe());
  }
}

async function loadFontsSafe() {
  try {
    return await loadOgFonts();
  } catch {
    // loadOgFonts already swallows individual font misses into a
    // partial-load result; this catch is the belt-and-suspenders for
    // the unhappy path where the helper itself throws (e.g. workspace
    // file-system error at lambda cold start). Returning undefined
    // makes Satori fall back to its built-in default — render still
    // succeeds at degraded quality, doesn't 5xx.
    return undefined;
  }
}

function renderDefault(label: string, fonts: Awaited<ReturnType<typeof loadOgFonts>> | undefined) {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          background: BRAND_GRADIENT,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
          fontSize: 96,
          fontWeight: 800,
          letterSpacing: "0.04em",
          fontFamily: OG_FONT_STACK,
        }}
      >
        {label}
      </div>
    ),
    { width: 1200, height: 630, fonts, headers: ERROR_HEADERS },
  );
}

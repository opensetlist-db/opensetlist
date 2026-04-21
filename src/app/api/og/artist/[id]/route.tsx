import { ImageResponse } from "@vercel/og";
import { prisma } from "@/lib/prisma";
import { displayNameWithFallback } from "@/lib/display";
import { deriveOgPaletteFromArtist, buildMeshBackground } from "@/lib/ogPalette";
import { loadOgFonts, OG_FONT_STACK } from "@/lib/ogFonts";
import {
  ARTIST_TYPE_LABELS,
  FALLBACK_TITLES,
  formatMemberCount,
  normalizeOgLocale,
} from "@/lib/ogLabels";

type Props = { params: Promise<{ id: string }> };

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
} as const;

// Error fallback must not be cached — a transient Prisma / font-load / render
// blip would otherwise poison CDN + crawler caches for hours with a generic
// OPENSETLIST card even after the underlying cause is fixed.
const ERROR_HEADERS = {
  "Cache-Control": "no-store",
} as const;

const STAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ffffff"><path d="M12 2l2.4 7.4H22l-6.2 4.5L18.2 22 12 17.3 5.8 22l2.4-8.1L2 9.4h7.6z"/></svg>';
const STAR_URI = `data:image/svg+xml;utf8,${STAR_SVG}`;

export async function GET(req: Request, { params }: Props) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = normalizeOgLocale(url.searchParams.get("lang"));

  if (!/^\d+$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  const artistId = BigInt(id);

  try {
    const [artist, palette, fonts] = await Promise.all([
      prisma.artist.findFirst({
        where: { id: artistId, isDeleted: false },
        include: {
          translations: true,
          parentArtist: { include: { translations: true } },
          stageLinks: { select: { endDate: true } },
        },
      }),
      deriveOgPaletteFromArtist(artistId),
      loadOgFonts(),
    ]);

    if (!artist) {
      return new Response("Not found", { status: 404 });
    }

    const title =
      displayNameWithFallback(artist, artist.translations, lang, "full") ||
      FALLBACK_TITLES[lang].artist;

    let subtitle = "";
    if (artist.parentArtist) {
      subtitle = displayNameWithFallback(
        artist.parentArtist,
        artist.parentArtist.translations,
        lang
      );
    }
    if (!subtitle) {
      const activeCount = artist.stageLinks.filter((s) => !s.endDate).length;
      if (activeCount > 0) {
        subtitle = formatMemberCount(activeCount, lang);
      }
    }

    const pillLabel = ARTIST_TYPE_LABELS[lang][artist.type];

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200px",
            height: "630px",
            display: "flex",
            position: "relative",
            fontFamily: OG_FONT_STACK,
            color: "#ffffff",
            background: palette.base,
            backgroundImage: buildMeshBackground(palette),
          }}
        >
          <img
            src={STAR_URI}
            width={120}
            height={120}
            style={{
              position: "absolute",
              top: 70,
              right: 90,
              opacity: 0.15,
              transform: "rotate(15deg)",
            }}
            alt=""
          />
          <img
            src={STAR_URI}
            width={80}
            height={80}
            style={{
              position: "absolute",
              bottom: 90,
              right: 180,
              opacity: 0.1,
              transform: "rotate(-10deg)",
            }}
            alt=""
          />

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              position: "absolute",
              top: 95,
              left: 80,
              width: 700,
              minHeight: 440,
              padding: "48px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 24,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                alignSelf: "flex-start",
                padding: "6px 14px",
                borderRadius: 999,
                background: "rgba(0, 0, 0, 0.3)",
                fontSize: 18,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: 28,
              }}
            >
              {pillLabel}
            </div>

            <div
              style={{
                display: "-webkit-box",
                fontSize: 72,
                fontWeight: 700,
                lineHeight: 1.1,
                color: "#ffffff",
                overflow: "hidden",
                letterSpacing: "-0.015em",
              }}
            >
              {title}
            </div>

            {subtitle && (
              <div
                style={{
                  display: "flex",
                  marginTop: 20,
                  fontSize: 30,
                  lineHeight: 1.3,
                  color: "rgba(255, 255, 255, 0.8)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {subtitle}
              </div>
            )}

            <div style={{ display: "flex", flex: 1 }} />

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                alignItems: "center",
                marginTop: 32,
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  letterSpacing: "0.12em",
                  color: "rgba(255, 255, 255, 0.5)",
                  textTransform: "uppercase",
                }}
              >
                OPENSETLIST
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
        headers: CACHE_HEADERS,
      }
    );
  } catch (err) {
    console.error("[og/artist] render failed, using bare fallback", err);
    try {
      const fonts = await loadOgFonts();
      return new ImageResponse(
        (
          <div
            style={{
              width: "1200px",
              height: "630px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: OG_FONT_STACK,
              color: "#ffffff",
              background: "#0f172a",
              fontSize: 56,
              letterSpacing: "0.08em",
            }}
          >
            OPENSETLIST
          </div>
        ),
        { width: 1200, height: 630, fonts, headers: ERROR_HEADERS }
      );
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
}

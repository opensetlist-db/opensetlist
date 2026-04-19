import { ImageResponse } from "@vercel/og";
import { prisma } from "@/lib/prisma";
import { pickTranslation, formatDate } from "@/lib/utils";
import { displayName } from "@/lib/display";
import { deriveOgPaletteFromSong, type OgPalette } from "@/lib/ogPalette";
import { loadOgFonts, OG_FONT_STACK } from "@/lib/ogFonts";
import { SONG_PILL_LABEL, normalizeOgLocale } from "@/lib/ogLabels";

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

const NOTE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ffffff"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';
const NOTE_URI = `data:image/svg+xml;utf8,${NOTE_SVG}`;

function buildMeshBackground(palette: OgPalette): string {
  return [
    `radial-gradient(circle at 20% 30%, ${palette.mesh[0]} 0%, transparent 50%)`,
    `radial-gradient(circle at 80% 20%, ${palette.mesh[1]} 0%, transparent 50%)`,
    `radial-gradient(circle at 60% 80%, ${palette.mesh[2]} 0%, transparent 50%)`,
    `radial-gradient(circle at 50% 50%, rgba(2, 119, 189, 0.15) 0%, transparent 60%)`,
  ].join(", ");
}

export async function GET(req: Request, { params }: Props) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = normalizeOgLocale(url.searchParams.get("lang"));

  try {
    const [song, palette, fonts] = await Promise.all([
      prisma.song.findFirst({
        where: { id: BigInt(id), isDeleted: false },
        include: {
          translations: true,
          artists: {
            include: { artist: { include: { translations: true } } },
          },
        },
      }),
      deriveOgPaletteFromSong(BigInt(id)),
      loadOgFonts(),
    ]);

    if (!song) {
      return new Response("Not found", { status: 404 });
    }

    const t = pickTranslation(song.translations, lang);
    const title = t?.title ?? song.originalTitle ?? "Song";

    const firstArtist = song.artists[0];
    const artistT = firstArtist
      ? pickTranslation(firstArtist.artist.translations, lang)
      : null;
    const artistName = artistT ? displayName(artistT) : "";
    const releaseYear = song.releaseDate
      ? String(song.releaseDate.getUTCFullYear())
      : "";
    const subtitle = [artistName, releaseYear].filter(Boolean).join(" · ");

    const dateStr = song.releaseDate ? formatDate(song.releaseDate, lang) : "";
    const pillLabel = SONG_PILL_LABEL[lang];

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
            src={NOTE_URI}
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
            src={NOTE_URI}
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
              backdropFilter: "blur(20px)",
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
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 32,
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  color: "rgba(255, 255, 255, 0.7)",
                }}
              >
                {dateStr}
              </div>
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
    console.error("[og/song] render failed, using bare fallback", err);
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

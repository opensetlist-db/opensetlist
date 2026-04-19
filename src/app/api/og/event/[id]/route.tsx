import { ImageResponse } from "@vercel/og";
import { prisma } from "@/lib/prisma";
import { pickTranslation } from "@/lib/utils";
import { formatVenueDate } from "@/lib/eventDateTime";
import { displayName } from "@/lib/display";
import { getEventStatus } from "@/lib/eventStatus";
import { deriveOgPaletteFromEvent, buildMeshBackground } from "@/lib/ogPalette";
import { loadOgFonts, OG_FONT_STACK } from "@/lib/ogFonts";
import {
  FALLBACK_TITLES,
  STATUS_LABELS,
  STATUS_DOT_COLOR,
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

const AIRPLANE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ffffff"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>';
const AIRPLANE_URI = `data:image/svg+xml;utf8,${AIRPLANE_SVG}`;

export async function GET(req: Request, { params }: Props) {
  const { id } = await params;
  const url = new URL(req.url);
  const lang = normalizeOgLocale(url.searchParams.get("lang"));

  if (!/^\d+$/.test(id)) {
    return new Response("Not found", { status: 404 });
  }
  const eventId = BigInt(id);

  try {
    const [event, palette, fonts] = await Promise.all([
      prisma.event.findFirst({
        where: { id: eventId, isDeleted: false },
        include: {
          translations: true,
          eventSeries: { include: { translations: true } },
        },
      }),
      deriveOgPaletteFromEvent(eventId),
      loadOgFonts(),
    ]);

    if (!event) {
      return new Response("Not found", { status: 404 });
    }

    const t = pickTranslation(event.translations, lang);
    const seriesT = pickTranslation(event.eventSeries?.translations ?? [], lang);
    const title = t ? displayName(t) : FALLBACK_TITLES[lang].event;
    const subtitleParts = [
      seriesT ? displayName(seriesT) : null,
      t?.city,
      t?.venue,
    ].filter(Boolean) as string[];
    const subtitle = subtitleParts.join(" · ");
    const dateStr = formatVenueDate(event.date, lang);

    const resolved = getEventStatus(event, new Date());
    const statusLabel = STATUS_LABELS[lang][resolved];
    const dotColor = STATUS_DOT_COLOR[resolved];

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
          {/* Paper-airplane motifs */}
          <img
            src={AIRPLANE_URI}
            width={120}
            height={120}
            style={{
              position: "absolute",
              top: 70,
              right: 90,
              opacity: 0.15,
              transform: "rotate(25deg)",
            }}
            alt=""
          />
          <img
            src={AIRPLANE_URI}
            width={80}
            height={80}
            style={{
              position: "absolute",
              bottom: 90,
              right: 180,
              opacity: 0.1,
              transform: "rotate(-15deg)",
            }}
            alt=""
          />

          {/* Glass card */}
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
            {/* Status pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                alignSelf: "flex-start",
                padding: "6px 12px",
                borderRadius: 999,
                background: "rgba(0, 0, 0, 0.3)",
                fontSize: 18,
                letterSpacing: "0.02em",
                marginBottom: 28,
              }}
            >
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  background: dotColor,
                }}
              />
              <div>{statusLabel}</div>
            </div>

            {/* Title */}
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

            {/* Subtitle */}
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

            {/* Metadata row */}
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
    console.error("[og/event] render failed, using bare fallback", err);
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

import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { pickTranslation } from "@/lib/utils";
import { displayName } from "@/lib/display";

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params;

  const event = await prisma.event.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: {
      translations: true,
      eventSeries: { include: { translations: true } },
    },
  });

  if (!event) return new Response("Not found", { status: 404 });

  const t = pickTranslation(event.translations, "ko");
  const seriesT = pickTranslation(
    event.eventSeries?.translations ?? [],
    "ko"
  );

  const dateStr = event.date
    ? new Date(event.date).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "";

  const subtitle = [dateStr, t?.city, t?.venue].filter(Boolean).join(" · ");

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background:
            "linear-gradient(135deg, #0f0f1a 0%, #1a1a3e 60%, #2d1b4e 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "70px 90px",
          fontFamily: "sans-serif",
          color: "white",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "0",
            top: "0",
            bottom: "0",
            width: "6px",
            background:
              "linear-gradient(180deg, #FB8A9B 0%, #9b8afb 100%)",
          }}
        />
        {seriesT && (
          <div
            style={{
              fontSize: "26px",
              color: "#FB8A9B",
              marginBottom: "20px",
              letterSpacing: "0.03em",
            }}
          >
            {displayName(seriesT)}
          </div>
        )}
        <div
          style={{
            fontSize: "56px",
            fontWeight: "bold",
            marginBottom: "32px",
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
          }}
        >
          {t ? displayName(t) : "Event"}
        </div>
        {subtitle && (
          <div style={{ fontSize: "26px", color: "#9999bb" }}>
            {subtitle}
          </div>
        )}
        <div
          style={{
            position: "absolute",
            bottom: "44px",
            right: "90px",
            fontSize: "22px",
            color: "#444466",
            letterSpacing: "0.05em",
          }}
        >
          opensetlist.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

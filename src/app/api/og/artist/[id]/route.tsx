import { ImageResponse } from "next/og";
import { prisma } from "@/lib/prisma";
import { pickTranslation } from "@/lib/utils";
import { displayName } from "@/lib/display";

type Props = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Props) {
  const { id } = await params;

  const artist = await prisma.artist.findFirst({
    where: { id: BigInt(id), isDeleted: false },
    include: { translations: true },
  });

  if (!artist) return new Response("Not found", { status: 404 });

  const t = pickTranslation(artist.translations, "ko");
  const name = t ? displayName(t, "full") : "Artist";
  const shortName = t ? displayName(t) : "";

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
        <div
          style={{
            fontSize: "24px",
            color: "#FB8A9B",
            marginBottom: "20px",
            letterSpacing: "0.05em",
          }}
        >
          ARTIST
        </div>
        <div
          style={{
            fontSize: "64px",
            fontWeight: "bold",
            marginBottom: "24px",
            lineHeight: 1.15,
          }}
        >
          {name}
        </div>
        {shortName !== name && (
          <div style={{ fontSize: "30px", color: "#9999bb" }}>
            {shortName}
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

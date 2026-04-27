import Link from "next/link";
import EventStatusTicker from "@/components/EventStatusTicker";
import { colors, radius } from "@/styles/tokens";

interface Props {
  href: string;
  startTimeIso: string | null;
  seriesName: string | null;
  eventName: string;
  venue: string | null;
  liveLabel: string;
  liveSubtitle: string;
  songCountLabel: string;
}

export function LiveHeroCard({
  href,
  startTimeIso,
  seriesName,
  eventName,
  venue,
  liveLabel,
  liveSubtitle,
  songCountLabel,
}: Props) {
  return (
    <Link
      href={href}
      className="relative block overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0277BD 100%)",
        borderRadius: 20,
        padding: "24px 20px",
        boxShadow: "0 8px 32px rgba(2,119,189,0.25)",
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          top: -40,
          right: -40,
          width: 160,
          height: 160,
          borderRadius: "50%",
          background: "rgba(79,195,247,0.08)",
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute"
        style={{
          bottom: -20,
          right: 20,
          width: 80,
          height: 80,
          borderRadius: "50%",
          background: "rgba(79,195,247,0.05)",
        }}
      />

      <div className="mb-4 flex items-center gap-2">
        <span
          className="inline-flex items-center"
          style={{
            background: colors.live,
            borderRadius: radius.badge,
            padding: "4px 12px",
            gap: 6,
          }}
        >
          <span
            aria-hidden="true"
            className="inline-block"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "white",
              animation: "live-pulse 1.2s ease-in-out infinite",
            }}
          />
          <span
            className="text-xs font-bold text-white"
            style={{ letterSpacing: "0.08em" }}
          >
            {liveLabel}
          </span>
        </span>
        <span
          className="text-xs"
          style={{ color: "rgba(255,255,255,0.5)" }}
        >
          {liveSubtitle}
        </span>
      </div>

      {seriesName && (
        <div
          className="mb-1.5 text-[11px] font-semibold"
          style={{ color: colors.primaryLight }}
        >
          {seriesName}
        </div>
      )}

      <div
        className="mb-4 text-[18px] font-bold text-white"
        style={{ lineHeight: 1.35 }}
      >
        {eventName}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {venue && (
          <span
            className="text-xs"
            style={{ color: "rgba(255,255,255,0.6)" }}
          >
            📍 {venue}
          </span>
        )}
        <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
          {songCountLabel}
        </span>
      </div>

      <span
        aria-hidden="true"
        className="absolute text-xl"
        style={{
          bottom: 20,
          right: 20,
          color: "rgba(255,255,255,0.3)",
        }}
      >
        ›
      </span>
      <EventStatusTicker startTime={startTimeIso} />
    </Link>
  );
}

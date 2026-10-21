import type { CSSProperties } from "react";
import Link from "next/link";
import { EventArt } from "@/components/shared/EventArt";
import { ConcertStatusPill } from "@/components/events/ConcertStatusPill";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

/*
 * One concert in a list group (16-v1 `.concert-row`). The whole row is
 * one native link to the canonical detail URL.
 *
 * Three layouts from one grid, matching the approved breakpoints:
 *   ≥1100  art 96×96 | name + venue | date + status (180px) | chevron
 *   700–   art 76×120 spanning two rows | name + venue / date + status
 *          on the second row | chevron spanning both rows
 *   <700   same as above with a 14px chevron column; the date row
 *          spans under the chevron so long dates wrap less
 * Names and venues wrap in full — no clamp or ellipsis, so Day.1/Day.2
 * and long translated titles stay distinguishable. Date is UTC-based
 * (formatted by the page) and keeps the year on every width.
 */

interface Props {
  href: string;
  title: string;
  venueCity: string | null;
  startTimeIso: string;
  dateLabel: string;
  status: ResolvedEventStatus;
  statusLabel: string;
  /** Running/final song count; null for upcoming and cancelled rows. */
  songCountLabel: string | null;
  artTitle: string;
  logoUrl: string | null;
  tint: string | null;
}

export function ConcertRow({
  href,
  title,
  venueCity,
  startTimeIso,
  dateLabel,
  status,
  statusLabel,
  songCountLabel,
  artTitle,
  logoUrl,
  tint,
}: Props) {
  return (
    <Link
      href={href}
      data-status={status}
      className="group mx-4 grid grid-cols-[76px_minmax(0,1fr)_14px] items-start gap-x-3 gap-y-2 border-b py-[18px] last:border-b-0 min-[700px]:mx-[18px] min-[700px]:grid-cols-[76px_minmax(0,1fr)_24px] min-[700px]:items-center min-[700px]:gap-[14px] min-[700px]:py-5 min-[1100px]:mx-6 min-[1100px]:grid-cols-[96px_minmax(0,1fr)_180px_24px] min-[1100px]:gap-5"
      style={
        {
          borderColor: colors.border,
          // Title colours as variables: the hover class must win over
          // the resting colour, which an inline `color` would not allow.
          "--row-title": colors.textPrimary,
          "--row-title-hover": colors.primary,
        } as CSSProperties
      }
    >
      <EventArt
        variant="compact"
        title={artTitle}
        logoUrl={logoUrl}
        tint={tint}
        className="row-span-2 self-center rounded-[10px] min-[1100px]:row-span-1"
      />
      <div className="col-start-2 row-start-1 min-w-0">
        <h4 className="mb-1.5 text-[15px] font-bold leading-[1.65] text-[var(--row-title)] [overflow-wrap:anywhere] group-hover:text-[var(--row-title-hover)] group-hover:underline min-[1100px]:text-[16px] [&:lang(ko)]:break-keep">
          {title}
        </h4>
        {venueCity && (
          <p
            className="m-0 flex items-start gap-[7px] text-[12px] [overflow-wrap:anywhere] min-[700px]:text-[13px]"
            style={{ color: colors.textSecondary }}
          >
            <PinIcon />
            <span>{venueCity}</span>
          </p>
        )}
      </div>
      <div className="col-span-2 col-start-2 row-start-2 flex flex-row flex-wrap items-center gap-2 min-[700px]:col-span-1 min-[1100px]:col-start-3 min-[1100px]:row-start-1 min-[1100px]:flex-col min-[1100px]:items-start">
        <time
          dateTime={startTimeIso}
          className="text-[12px] font-bold min-[700px]:text-[13px] min-[1100px]:text-[15px]"
          style={{ color: colors.primary }}
        >
          {dateLabel}
        </time>
        <div className="flex flex-wrap items-center gap-1.5 min-[700px]:gap-2">
          <ConcertStatusPill status={status} label={statusLabel} />
          {songCountLabel && (
            <span
              className="text-[12px]"
              style={{ color: colors.textSecondary }}
            >
              {songCountLabel}
            </span>
          )}
        </div>
      </div>
      <span
        aria-hidden="true"
        className="col-start-3 row-start-1 self-center min-[700px]:row-span-2 min-[1100px]:col-start-4 min-[1100px]:row-span-1"
        style={{ color: colors.primary }}
      >
        <ChevronIcon />
      </span>
    </Link>
  );
}

function PinIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mt-0.5 h-[19px] w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[14px] w-[14px] min-[700px]:h-6 min-[700px]:w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

"use client";

import { useId, useState, type ReactNode } from "react";
import { ConcertStatusPill } from "@/components/events/ConcertStatusPill";
import { colors, radius, shadows } from "@/styles/tokens";

/*
 * One list group — a root series, an artist's standalone shows, an
 * organizer, or the catch-all (16-v1 `.concert-group`).
 *
 * Collapse: groups start expanded. A group holding a LIVE row cannot
 * collapse — the toggle is not rendered at all, so nothing suggests the
 * live show can be hidden. (The page passes `live=false` when the
 * "upcoming" filter removed the LIVE rows, so the rest collapses.) The
 * rows stay in the DOM under `hidden` when collapsed: they are server
 * rendered and the toggle only flips visibility, so the heading and
 * count remain visible and focus never lands on a removed node.
 */

interface Props {
  title: string;
  /** Representative artist short name (series groups only). */
  artistTag: string | null;
  /** "Tour" / "Festival" from the root series type, if either. */
  typeLabel: string | null;
  countLabel: string;
  live: boolean;
  liveLabel: string;
  collapseLabel: string;
  expandLabel: string;
  children: ReactNode;
}

export function ConcertGroup({
  title,
  artistTag,
  typeLabel,
  countLabel,
  live,
  liveLabel,
  collapseLabel,
  expandLabel,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const expanded = live || !collapsed;
  const id = useId();
  const titleId = `${id}-title`;
  const rowsId = `${id}-rows`;

  return (
    <section
      aria-labelledby={titleId}
      data-live={live || undefined}
      className="mb-6 border"
      style={{
        background: colors.bgCard,
        borderColor: colors.border,
        borderRadius: radius.card,
        boxShadow: shadows.card,
      }}
    >
      <header
        className="flex items-center gap-2 rounded-t-2xl p-4 min-[700px]:gap-4 min-[700px]:p-[18px] min-[1100px]:px-6 min-[1100px]:py-5"
        style={{
          background: live ? colors.listLiveGroupBg : colors.listGroupWash,
          // Collapsed: the header is the whole card, so round every corner.
          borderRadius: expanded ? undefined : radius.card,
        }}
      >
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="m-0 text-[16px] font-bold leading-[1.6] [overflow-wrap:anywhere] min-[700px]:text-[17px] min-[1100px]:text-[18px] [&:lang(ko)]:break-keep"
            style={{ color: colors.textPrimary }}
          >
            {title}
          </h3>
          <p
            className="mt-2 mb-0 flex flex-wrap items-center gap-1.5 text-[12px] min-[700px]:gap-2"
            style={{ color: colors.textSecondary }}
          >
            {artistTag && (
              <span
                className="rounded-[5px] border px-2 py-0.5"
                style={{ background: colors.bgCard, borderColor: colors.border }}
              >
                {artistTag}
              </span>
            )}
            {typeLabel && (
              <>
                <span>{typeLabel}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>{countLabel}</span>
            {live && <ConcertStatusPill status="ongoing" label={liveLabel} />}
          </p>
        </div>
        {!live && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={rowsId}
            aria-label={expanded ? collapseLabel : expandLabel}
            onClick={() => setCollapsed((c) => !c)}
            className="grid h-11 w-9 shrink-0 place-items-center rounded-lg border min-[700px]:w-11"
            style={{
              background: colors.bgCard,
              borderColor: colors.borderStrong,
              color: colors.textPrimary,
            }}
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className={`h-6 w-6 transition-transform motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 5 7 7-7 7" />
            </svg>
          </button>
        )}
      </header>
      <div id={rowsId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}

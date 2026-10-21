import Link from "next/link";
import type { ReactNode } from "react";
import { CoverImage } from "@/components/shared/CoverImage";
import type { SearchType } from "@/lib/globalSearch/params";
import type { ResultRowView } from "@/lib/globalSearch/view";
import { colors, shadows } from "@/styles/tokens";
import { SearchIcon } from "./SearchIcon";
import styles from "./search.module.css";

/*
 * Result groups, rows and state panels of the search page — approved
 * 12-v1.2 composition:
 *
 *   - white 16px-radius group panels with an icon + h2 heading; the
 *     artist/song icons use the pink/lavender accent washes, concerts and
 *     albums the blue one (neutral role accents, not artist colours);
 *   - each row is ONE native link (whole row clickable, title underlines
 *     on hover), chevron at the end; full titles wrap, never clamp;
 *   - an empty group stays compact with a one-line message;
 *   - the overview "more" link sits in a footer band of the panel.
 *
 * Text-led by design: no managed concert logos (12-v1.2 approval); album
 * rows reserve a 56px cover slot with the shared fallback.
 */

const ICON_TONE: Record<SearchType, { bg: string; fg: string }> = {
  events: { bg: colors.accentBlue, fg: colors.primary },
  artists: { bg: colors.accentPink, fg: "#80344f" },
  songs: { bg: colors.accentLavender, fg: "#594392" },
  albums: { bg: colors.accentBlue, fg: colors.primary },
};

export function ResultGroup({
  type,
  heading,
  rows,
  emptyLabel,
  matchedLabel,
  more,
}: {
  type: SearchType;
  heading: string;
  rows: ResultRowView[];
  emptyLabel: string;
  matchedLabel: string;
  more?: { href: string; label: string } | null;
}) {
  const tone = ICON_TONE[type];
  const headingId = `search-group-${type}`;
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-2xl border bg-white"
      style={{ borderColor: colors.border, boxShadow: shadows.card }}
    >
      <div
        className="flex items-center gap-3 border-b px-[18px] pb-3.5 pt-[18px] min-[700px]:px-6 min-[700px]:pb-[18px] min-[700px]:pt-[22px]"
        style={{ borderColor: colors.border }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px]"
          style={{ background: tone.bg, color: tone.fg }}
        >
          <SearchIcon name={type} />
        </span>
        <h2
          id={headingId}
          className="text-[20px] font-bold leading-normal min-[700px]:text-[21px]"
        >
          {heading}
        </h2>
      </div>
      {rows.length > 0 ? (
        <ul className="m-0 list-none px-[18px] py-0 min-[700px]:px-6">
          {rows.map((row, i) => (
            <li
              key={row.key}
              className={i > 0 ? "border-t" : undefined}
              style={i > 0 ? { borderColor: colors.border } : undefined}
            >
              <ResultRow row={row} matchedLabel={matchedLabel} />
            </li>
          ))}
        </ul>
      ) : (
        <p
          className="m-0 px-[18px] py-[22px] text-[14px] min-[700px]:px-6 min-[700px]:py-[26px]"
          style={{ color: colors.textSecondary }}
        >
          {emptyLabel}
        </p>
      )}
      {more && (
        <Link
          href={more.href}
          className={`${styles.more} flex min-h-[50px] items-center justify-between rounded-b-2xl border-t px-[18px] py-[13px] text-[14px] font-bold min-[700px]:px-6 min-[700px]:py-3.5`}
          style={{ borderColor: colors.border, color: colors.primary }}
        >
          <span>{more.label}</span>
          <SearchIcon name="chevron" size={16} />
        </Link>
      )}
    </section>
  );
}

function ResultRow({
  row,
  matchedLabel,
}: {
  row: ResultRowView;
  matchedLabel: string;
}) {
  return (
    <Link
      href={row.href}
      className={`${styles.row} flex min-h-20 items-center gap-2.5 rounded py-4 min-[700px]:gap-3.5 min-[700px]:py-[18px]`}
    >
      {row.initial !== null && (
        <span
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full font-bold"
          style={{ background: colors.accentPink, color: "#80344f" }}
        >
          {row.initial}
        </span>
      )}
      {row.cover !== undefined && <CoverImage src={row.cover} size={56} fallbackLabel={{ size: 12 }} />}
      <span className="min-w-0 flex-1">
        {row.date && (
          <span
            className="mb-[5px] flex flex-wrap items-center gap-2 text-[12px] font-bold"
            style={{ color: colors.primary }}
          >
            {row.date}
            {row.day && (
              <span
                className="rounded-md border px-[7px] py-[3px] text-[11px] leading-normal"
                style={{
                  background: "#edf3ff",
                  borderColor: colors.primaryBorder,
                  color: "#2457a6",
                }}
              >
                {row.day}
              </span>
            )}
          </span>
        )}
        <span
          lang={row.titleLang}
          className={`${styles.title} block text-[15px] font-bold leading-[1.65] [overflow-wrap:anywhere]`}
        >
          {row.title}
        </span>
        {row.sub && (
          <Meta lang={row.subLang}>{row.sub}</Meta>
        )}
        {row.version && (
          <span
            lang={row.version.lang}
            className="mt-1.5 inline-block rounded px-1.5 py-0.5 text-[12px]"
            style={
              row.version.base
                ? { background: "#eef3f9", color: colors.textSecondary }
                : { background: colors.accentLavender, color: "#58417d" }
            }
          >
            {row.version.label}
          </span>
        )}
        {row.meta && <Meta>{row.meta}</Meta>}
        {row.matched && (
          <span
            className="mt-[5px] block text-[12px] [overflow-wrap:anywhere]"
            style={{ color: "#53527d" }}
          >
            {matchedLabel}: <span lang={row.matched.lang}>{row.matched.name}</span>
          </span>
        )}
      </span>
      <span style={{ color: colors.primary }}>
        <SearchIcon name="chevron" size={16} />
      </span>
    </Link>
  );
}

function Meta({ children, lang }: { children: ReactNode; lang?: string }) {
  return (
    <span
      lang={lang}
      className="mt-[5px] block text-[12px] [overflow-wrap:anywhere]"
      style={{ color: colors.textSecondary }}
    >
      {children}
    </span>
  );
}

/**
 * Empty / no-results / error / loading / too-long / out-of-range panel.
 * `alert` is used only for the error state, so assistive tech announces a
 * failure but not routine "type something" guidance.
 */
export function StatePanel({
  title,
  body,
  action,
  tone = "neutral",
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  tone?: "neutral" | "error";
}) {
  const error = tone === "error";
  return (
    <section
      role={error ? "alert" : "status"}
      className="rounded-2xl border px-5 py-8 text-center min-[700px]:px-7 min-[700px]:py-12"
      style={{
        borderColor: error ? "#daa6b7" : colors.border,
        background: error ? "#fff9fb" : colors.bgCard,
      }}
    >
      <div
        className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full"
        style={{
          background: error ? colors.accentPink : colors.accentBlue,
          color: error ? "#80344f" : colors.primary,
        }}
      >
        <SearchIcon size={28} />
      </div>
      <h2 className="mb-3 text-[20px] font-bold leading-normal min-[700px]:text-[21px]">
        {title}
      </h2>
      {body && (
        <p
          className="mb-3 [overflow-wrap:anywhere]"
          style={{ color: colors.textSecondary }}
        >
          {body}
        </p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </section>
  );
}

export function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.secondary}>
      {children}
    </Link>
  );
}

export function DisabledAction({ children }: { children: ReactNode }) {
  return (
    <span aria-disabled="true" className={styles.disabled}>
      {children}
    </span>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { formatTime } from "@/lib/utils";
import type { Freshness } from "@/lib/snapshotFreshness";
import { colors } from "@/styles/tokens";

// HH:MM:SS in the viewer's locale + timezone. 24-hour on purpose: the
// value is a sync clock read at a glance during a show, and "7:02:11
// PM" is wider than the header row has room for on a phone.
// `hourCycle: "h23"` rather than `hour12: false`: the latter resolves
// to h24 in some engines for en-US and renders midnight as "24:05:00".
const SYNC_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
};

interface Props {
  freshness: Freshness;
  locale: string;
}

/**
 * Small "is this browser keeping up" marker beside the LIVE pill.
 *
 * "LIVE" comes from event status — it says the show is on, not that
 * this page is updating. This indicator closes that gap:
 *
 *   - live / retrying → 「最終同期 HH:MM:SS」, the client time of the
 *     last successful snapshot. "retrying" (1–2 consecutive failures)
 *     intentionally looks identical: a single dropped request
 *     recovers within a second or two and shouldn't flash a warning.
 *   - delayed (≥ 3 failures, or realtime fell back and polling hasn't
 *     synced yet) → 「更新が遅れています」.
 *
 * It reflects sync SUCCESS, not data age — a quiet MC with a healthy
 * connection is not stale, so there is no "last change" clock here.
 * No "polling" / "realtime" jargon on the public page.
 *
 * Renders nothing before the first successful sync (SSR + first
 * paint), which also keeps the server HTML free of a client-clock
 * value that would mismatch on hydration.
 */
export function LiveSyncIndicator({ freshness, locale }: Props) {
  const t = useTranslations("Setlist");

  if (freshness.state === "delayed") {
    return (
      <span
        role="status"
        className="inline-flex items-center rounded-full px-2 py-0.5"
        style={{
          fontSize: 11,
          fontWeight: 600,
          background: colors.warningBg,
          color: colors.warning,
          whiteSpace: "nowrap",
        }}
      >
        {t("updatesDelayed")}
      </span>
    );
  }

  if (freshness.lastSyncAt === null) return null;

  return (
    <span
      style={{
        fontSize: 11,
        color: colors.textMuted,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {t("lastSync", {
        time: formatTime(freshness.lastSyncAt, locale, SYNC_TIME_FORMAT),
      })}
    </span>
  );
}

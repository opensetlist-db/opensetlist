"use client";

import { useTranslations } from "next-intl";
import { colors } from "@/styles/tokens";

/**
 * Operator email address for setlist row reports. Hardcoded
 * (rather than env-var-driven) because the address is the project's
 * public help inbox — same one shown in CLAUDE.md and the contact
 * surfaces. Centralized here so a future change to the report
 * pipeline (e.g. a dedicated /admin/reports endpoint, or a Twitter
 * DM handle) only needs the one swap.
 */
const REPORT_EMAIL = "help@opensetlist.com";

interface Props {
  eventId: string;
  position: number;
  /**
   * Resolved (locale-aware) song title for the report body. Caller
   * passes the same `displayOriginalTitle` result it already
   * computed for `<SongTitleBlock>` so we don't duplicate the
   * resolution here. Empty string when the row has no song picked
   * (admin placeholder); the body template renders a sensible
   * placeholder in that case.
   */
  songTitle: string;
}

/**
 * Phase 1C `🚩 신고` link rendered next to `[?]` rumoured rows.
 *
 * At Phase 1C — a `mailto:` link with prefilled subject + body
 * containing event id, row position, and (resolved) song title. The
 * operator handles each report manually. Phase 2 ships
 * threshold-based auto-hide; this component's render contract
 * doesn't change at that point — only the destination href moves
 * from `mailto:` to an internal endpoint.
 *
 * Rendered ONLY for `rowState === "rumoured"` (not for
 * `my-confirmed` — the viewer's already endorsed it, so the flag
 * affordance is contradictory).
 *
 * Placement is inline at the end of the title block in
 * `<SetlistRow>`; sized small (`text-[11px]`, muted) so it reads as
 * a secondary affordance and doesn't compete with the song title
 * for the eye.
 */
export function FlagButton({ eventId, position, songTitle }: Props) {
  const t = useTranslations("Confirm");
  // i18n template substitution renders the values as text in the
  // mailto body. encodeURIComponent on the resolved string handles
  // CJK + special characters cleanly. The resolved title can be an
  // empty string for placeholder rows; substitute a tilde-marked
  // sentinel so the operator can tell "(no title)" from a
  // formatting glitch in the body template.
  const safeTitle = songTitle || "~unknown~";
  const subject = encodeURIComponent(
    t("flagEmailSubject", { eventId, position }),
  );
  const body = encodeURIComponent(
    t("flagEmailBody", {
      eventId,
      position,
      songTitle: safeTitle,
    }),
  );
  return (
    <a
      className="inline-block text-[11px]"
      href={`mailto:${REPORT_EMAIL}?subject=${subject}&body=${body}`}
      style={{ color: colors.textMuted }}
    >
      🚩 {t("flag")}
    </a>
  );
}

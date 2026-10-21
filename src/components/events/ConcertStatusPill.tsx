import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors } from "@/styles/tokens";

/*
 * Status pill of the approved concert-list design (16-v1 `.state-pill`).
 * Deliberately not the shared <StatusBadge>: the list's approved palette
 * (blue upcoming, slate completed, rose cancelled, solid raspberry LIVE
 * with white text) differs from the badge's green/red status semantics
 * that the detail and home surfaces still use. Every pair is ≥4.5:1
 * (16-v1 contrast.json).
 */
const PILL: Record<ResolvedEventStatus, { bg: string; color: string }> = {
  upcoming: { bg: colors.primaryBg, color: colors.primary },
  completed: { bg: colors.listCompletedBg, color: colors.textSecondary },
  cancelled: { bg: colors.accentPink, color: colors.listCancelledText },
  ongoing: { bg: colors.listLive, color: colors.bgCard },
};

interface Props {
  status: ResolvedEventStatus;
  label: string;
}

export function ConcertStatusPill({ status, label }: Props) {
  const { bg, color } = PILL[status];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-[5px] px-2 py-[3px] text-[12px] font-bold"
      style={{ background: bg, color }}
    >
      {status === "ongoing" && <span aria-hidden="true">●</span>}
      {label}
    </span>
  );
}

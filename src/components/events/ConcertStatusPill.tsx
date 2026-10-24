import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { StatusBadge } from "@/components/StatusBadge";
import { colors } from "@/styles/tokens";

/*
 * Status pill of the approved concert-list design (16-v1 `.state-pill`).
 * Upcoming blue, completed slate and cancelled rose retain their 16-v1
 * meanings. LIVE consumes the shared consistency-03-v3 badge so the
 * status stays recognizable alongside home and detail surfaces.
 */
const PILL: Record<Exclude<ResolvedEventStatus, "ongoing">, { bg: string; color: string }> = {
  upcoming: { bg: colors.primaryBg, color: colors.primary },
  completed: { bg: colors.listCompletedBg, color: colors.textSecondary },
  cancelled: { bg: colors.accentPink, color: colors.listCancelledText },
};

interface Props {
  status: ResolvedEventStatus;
  label: string;
}

export function ConcertStatusPill({ status, label }: Props) {
  if (status === "ongoing") {
    return <StatusBadge status={status} label={label} size="md" />;
  }
  const { bg, color } = PILL[status];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-[5px] px-2 py-[3px] text-[12px] font-bold"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  );
}

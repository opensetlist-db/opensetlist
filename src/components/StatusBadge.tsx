import type { ResolvedEventStatus } from "@/lib/eventStatus";
import { colors, radius } from "@/styles/tokens";

/*
 * Per-status visual config — verbatim from shared-components-handoff §5
 * (ongoing red, upcoming green, completed gray, cancelled lighter gray).
 * `dot: true` for ongoing means an extra pulsing dot is rendered before
 * the label, animated via the global `live-pulse` keyframe.
 *
 * Cancelled uses the two literal hex values from handoff §5 directly —
 * not in `tokens.ts` since the redesign treats cancelled as a one-off
 * "muted gray" without a dedicated semantic token.
 */
const CONFIG: Record<
  ResolvedEventStatus,
  {
    dot: boolean;
    bg: string;
    color: string;
    border: string;
  }
> = {
  ongoing: {
    dot: true,
    bg: colors.liveBg,
    color: colors.live,
    border: colors.liveBorder,
  },
  upcoming: {
    dot: false,
    bg: colors.upcomingBg,
    color: colors.upcoming,
    border: colors.upcomingBorder,
  },
  completed: {
    dot: false,
    bg: colors.completedBg,
    color: colors.completed,
    border: colors.completedBorder,
  },
  cancelled: {
    dot: false,
    bg: "#fafafa",
    color: colors.textMuted,
    border: "#e5e7eb",
  },
};

const SIZES = {
  sm: { padding: "2px 8px", fontSize: 10, dotSize: 6, gap: 4 },
  md: { padding: "3px 10px", fontSize: 11, dotSize: 7, gap: 5 },
} as const;

interface Props {
  status: ResolvedEventStatus;
  /**
   * Resolved label string. The caller resolves this via i18n
   * (`getTranslations("Event")(`status.${status}`)` on locale pages, or
   * a hardcoded Korean map on the admin surface), so the badge stays
   * usable both inside and outside the next-intl provider tree without
   * forcing the component to be a client component or split into two.
   */
  label: string;
  size?: "sm" | "md";
}

export function StatusBadge({ status, label, size = "sm" }: Props) {
  const cfg = CONFIG[status];
  const s = SIZES[size];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: s.gap,
        padding: s.padding,
        fontSize: s.fontSize,
        fontWeight: 600,
        lineHeight: 1,
        borderRadius: radius.badge,
        background: cfg.bg,
        color: cfg.color,
        border: `1px solid ${cfg.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.dot && (
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: s.dotSize,
            height: s.dotSize,
            borderRadius: "50%",
            background: cfg.color,
            animation: "live-pulse 1.2s ease-in-out infinite",
          }}
        />
      )}
      {label}
    </span>
  );
}

import { colors } from "@/styles/tokens";

/*
 * Right-aligned [count + unit] cell. The number sits inside a fixed-
 * width column (right-aligned, tabular numerals) so when a parent
 * stacks several CountCell instances vertically — e.g. the member
 * page's top-songs list, or the series page's songs tab — the
 * digits align in a column regardless of digit count:
 *
 *      5  회 등장
 *     12  회 등장
 *    105  회 등장
 *
 * The unit label sits to the right of the number column. Both stay
 * on a single baseline-aligned row so a long unit string ("appearances")
 * doesn't push the number cell out of position.
 *
 * Operator feedback (2026-04-29): originally each surface stacked
 * the count above its unit on two lines, plus the member SongRow
 * was double-rendering (large bare number + small "{count}회 공연"
 * pluralized line). This unifies both surfaces on one pattern.
 */

interface Props {
  count: number;
  /** Unit-only label (e.g. "회 등장", "회 공연", "performances"). The
   *  count goes in the bare-number slot — don't pre-format it into
   *  the label. */
  unit: string;
}

export function CountCell({ count, unit }: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 4,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: colors.textPrimary,
          // tabular-nums + fixed minWidth: digits in different rows
          // sit at the same x even when one row is single-digit and
          // another is triple-digit. 28px is sized for 3 digits at
          // fontSize 14 bold + a hair of breathing room.
          fontVariantNumeric: "tabular-nums",
          minWidth: 28,
          textAlign: "right",
        }}
      >
        {count}
      </span>
      <span
        style={{
          fontSize: 11,
          color: colors.textMuted,
        }}
      >
        {unit}
      </span>
    </div>
  );
}

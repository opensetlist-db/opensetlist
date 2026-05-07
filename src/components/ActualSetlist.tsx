"use client";

import { useTranslations } from "next-intl";
import { SetlistRow } from "@/components/SetlistRow";
import type { RowState } from "@/components/NumberSlot";
import type {
  LiveSetlistItem,
  ReactionCountsMap,
} from "@/lib/types/setlist";
import { colors } from "@/styles/tokens";
import {
  SETLIST_DESKTOP_GRID_COLS,
  SETLIST_DESKTOP_GRID_GAP,
} from "@/components/setlistLayout";
import { getConfirmStatus } from "@/lib/confirmStatus";
import { useLocalConfirm } from "@/hooks/useLocalConfirm";

interface Props {
  items: LiveSetlistItem[];
  reactionCounts: ReactionCountsMap;
  locale: string;
  eventId: string;
}

/**
 * Renders the actual-setlist body for the SETLIST surface — the
 * column header + main rows + encore divider + encore rows. Carved
 * out of `<LiveSetlist>` as part of the Stage B tab refactor so
 * `<SetlistSection>` can swap this for `<PredictedSetlist>` when
 * the Predicted tab is active.
 *
 * Behavior is **byte-equivalent** to the pre-refactor inline
 * rendering in `<LiveSetlist>` — the load-bearing constraint of
 * this refactor is that events without predictions render
 * identical HTML to Phase 1A.
 *
 * Empty-state ("no setlist") rendering stays in `<LiveSetlist>`
 * because it predates the tab structure and shouldn't change shape
 * just because the tab system was added.
 */
export function ActualSetlist({
  items,
  reactionCounts,
  locale,
  eventId,
}: Props) {
  const t = useTranslations("Event");
  const ct = useTranslations("Common");

  // Stage C — own the per-viewer localStorage-confirmed set ONCE
  // here so every row sees the same Set instance. Mounted-gated
  // hydration inside the hook keeps SSR + first client render
  // matching (set is empty until after mount). The hook also fires
  // the (gated) POST when a row toggles.
  const { confirmedItemIds, toggleConfirm } = useLocalConfirm(eventId);

  const mainItems = items.filter((item) => !item.isEncore);
  const encoreItems = items.filter((item) => item.isEncore);

  return (
    <>
      <SetlistColumnHeader
        labels={{
          position: t("colPosition"),
          song: t("colSong"),
          performers: t("colPerformers"),
          reactions: t("colReactions"),
        }}
      />
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {mainItems.map((item, index) => (
          <SetlistRow
            key={item.id}
            item={item}
            index={index}
            reactionCounts={reactionCounts}
            locale={locale}
            eventId={eventId}
            rowState={deriveRowState(item, confirmedItemIds)}
            onConfirmTap={() => toggleConfirm(item.id)}
          />
        ))}
      </ol>
      {encoreItems.length > 0 && (
        <>
          <EncoreDivider label={ct("encore")} />
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {encoreItems.map((item, index) => (
              <SetlistRow
                key={item.id}
                item={item}
                index={index}
                reactionCounts={reactionCounts}
                locale={locale}
                eventId={eventId}
                rowState={deriveRowState(item, confirmedItemIds)}
                onConfirmTap={() => toggleConfirm(item.id)}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * Stage C row-state derivation, three-state composition:
 *
 *   getConfirmStatus(item, now)         localConfirmedIds.has(id)        rowState
 *   "confirmed"                          either                           "confirmed"
 *   "rumoured"                           true                             "my-confirmed"
 *   "rumoured"                           false                            "rumoured"
 *
 * `getConfirmStatus` (`src/lib/confirmStatus.ts`) handles the DB-
 * level decision (`status === "confirmed" | "live"` always wins;
 * `rumoured` rows past 1-min auto-promote to confirmed too). The
 * local-set check then chooses between the two "still rumoured"
 * visual variants — `[?]` for someone else's row, `[✓]` for the
 * viewer's own confirm.
 *
 * Read-time evaluation: `getConfirmStatus` reads `now` per call,
 * so each render sees the current bucket. The 5s `useSetlistPolling`
 * cadence on ongoing events triggers a re-render every poll — a
 * row crossing the 60s mark mid-session promotes within ≤ 5s of
 * the boundary without an extra timer.
 */
function deriveRowState(
  item: LiveSetlistItem,
  localConfirmedIds: Set<number>,
): RowState {
  const confirmStatus = getConfirmStatus(item);
  if (confirmStatus === "confirmed") return "confirmed";
  return localConfirmedIds.has(item.id) ? "my-confirmed" : "rumoured";
}

// Lifted verbatim from `<LiveSetlist>` so `<ActualSetlist>` stays
// self-contained. Single source of truth for the column template +
// gap is `setlistLayout.ts`.
function SetlistColumnHeader({
  labels,
}: {
  labels: {
    position: string;
    song: string;
    performers: string;
    reactions: string;
  };
}) {
  const headerStyle = {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
  };
  return (
    <div
      aria-hidden="true"
      className="hidden lg:grid"
      style={{
        gridTemplateColumns: SETLIST_DESKTOP_GRID_COLS,
        columnGap: SETLIST_DESKTOP_GRID_GAP,
        padding: "8px 20px",
        background: colors.bgFaint,
        borderBottom: `2px solid ${colors.border}`,
      }}
    >
      <span style={headerStyle}>{labels.position}</span>
      <span style={headerStyle}>{labels.song}</span>
      <span style={headerStyle}>{labels.performers}</span>
      <span style={headerStyle}>{labels.reactions}</span>
    </div>
  );
}

function EncoreDivider({ label }: { label: string }) {
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-zinc-200" />
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

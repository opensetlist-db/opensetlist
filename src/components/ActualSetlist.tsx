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
            rowState={deriveRowState(item)}
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
                rowState={deriveRowState(item)}
              />
            ))}
          </ol>
        </>
      )}
    </>
  );
}

/**
 * Stage B row-state derivation: only `item.status === "rumoured"`
 * flips a row out of the default confirmed state. The
 * `my-confirmed` state requires reading per-viewer localStorage
 * (`confirm-{eventId}`) which is Stage C territory — until then,
 * a viewer who has confirmed a rumoured row sees the rumoured
 * styling, not the my-confirmed styling. Same `[?]` button, no
 * tap behavior change.
 *
 * `item.status` values per the SetlistItemStatus Prisma enum:
 * `rumoured | live | confirmed`. Phase 1A rows are all confirmed
 * (the schema default); rumoured first appears with Stage C's
 * Confirm UI on 5/30 Kanagawa onwards. `live` is treated as
 * confirmed for visual purposes — the row is happening now but
 * still verified by the system.
 */
function deriveRowState(item: LiveSetlistItem): RowState {
  return item.status === "rumoured" ? "rumoured" : "confirmed";
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

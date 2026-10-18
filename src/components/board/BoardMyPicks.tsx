"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { SongPickerSheet } from "@/components/predict/SongPickerSheet";
import {
  BOARD_PICKS_PER_GROUP,
  BOARD_WISHES_PER_GROUP,
} from "@/lib/board/config";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import type { AvailableSong } from "@/lib/types/predict";
import { colors } from "@/styles/tokens";

/**
 * "My picks" for the open group on the fan board (n15): the rows I
 * added, an "N/3" counter, the add control (disabled with an
 * explanation at the cap) and the group-scoped picker.
 *
 * The picker is the existing predict `<SongPickerSheet>`, fed only this
 * group's base songs, so a fan picks from exactly the catalog the
 * server validates against. Toggling a selected song off removes the
 * pick. All writes go through `onAdd` / `onRemove` (the parent owns the
 * ballot and the feedback).
 *
 * Used for both columns (n15): `kind` picks the copy and the cap —
 * "my picks" under "expect", "my wishes" under "want". The two caps are
 * the same number today; each is read from its own constant so they
 * can't silently couple.
 */

const COPY = {
  pick: { mine: "mine", add: "add", max: BOARD_PICKS_PER_GROUP },
  wish: { mine: "mineWish", add: "addWish", max: BOARD_WISHES_PER_GROUP },
} as const;

export function BoardMyPicks({
  kind = "pick",
  groupId,
  groupName,
  locale,
  picks,
  groupSongs,
  locked,
  playedSongIds = null,
  pending,
  onAdd,
  onRemove,
}: {
  /** Which column this is "mine" for. */
  kind?: "pick" | "wish";
  groupId: string;
  groupName: string;
  locale: string;
  /** My picks (or wishes) in THIS group. */
  picks: readonly StoredBoardPick[];
  /** This group's base-song catalog (empty when the page has none —
   *  completed events, or a festival with no roster). */
  groupSongs: readonly AvailableSong[];
  locked: boolean;
  /** After the show (n15): every song id the final setlist counts
   *  as played. My picks in it are highlighted — whether or not they
   *  made the crowd's shortlist. Null/omitted = no result yet. */
  playedSongIds?: ReadonlySet<string> | null;
  pending: ReadonlySet<string>;
  onAdd: (song: AvailableSong) => void;
  onRemove: (pick: StoredBoardPick) => void;
}) {
  const t = useTranslations("Board");
  const [pickerOpen, setPickerOpen] = useState(false);
  const copy = COPY[kind];
  const max = copy.max;
  const atCap = picks.length >= max;
  const catalogById = new Map(groupSongs.map((s) => [String(s.songId), s]));
  const canAdd = !locked && groupSongs.length > 0;
  const capNoteId = `board-cap-${kind}-${groupId}`;

  const handleToggle = (songId: number) => {
    const id = String(songId);
    if (pending.has(id)) return;
    const mine = picks.find((p) => p.songId === id);
    if (mine) {
      onRemove(mine);
      return;
    }
    const song = catalogById.get(id);
    if (song) onAdd(song);
  };

  return (
    <div
      className="mt-3"
      data-testid={kind === "pick" ? "board-my-picks" : "board-my-wishes"}
    >
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[12px] font-medium" style={{ color: colors.textSecondary }}>
          {t(copy.mine)}
        </h4>
        <span
          data-testid="board-pick-counter"
          className="text-[11px] tabular-nums"
          style={{ color: colors.textMuted }}
        >
          {t("counter", { count: picks.length, max })}
        </span>
      </div>

      {picks.length > 0 && (
        <ul className="mb-1.5 space-y-1">
          {picks.map((p) => {
            // Live catalog wins over the stored flag while the page has
            // one: a song moderated after it was picked drops out of the
            // catalog, and must render unavailable even though the local
            // copy still says otherwise.
            const available =
              p.available && (groupSongs.length === 0 || catalogById.has(p.songId));
            // A song credited to several groups shows where it counts.
            const crossGroup =
              (catalogById.get(p.songId)?.festivalGroupIds.length ?? 0) > 1;
            const played = playedSongIds?.has(p.songId) ?? false;
            return (
              <li
                key={p.id}
                data-testid="board-my-pick"
                data-played={played || undefined}
                className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-[13px]"
                style={
                  played
                    ? { background: colors.primaryBg, borderColor: colors.primaryBorder }
                    : { background: colors.bgSubtle }
                }
              >
                <span className="min-w-0 flex-1">
                  {available ? (
                    <Link
                      href={`/${locale}/songs/${p.songId}`}
                      className="block truncate"
                      style={{ color: colors.textPrimary }}
                    >
                      {p.title}
                    </Link>
                  ) : (
                    <span
                      className="block truncate"
                      style={{ color: colors.textMuted }}
                    >
                      {p.title}{" "}
                      <span className="text-[10px]">({t("unavailable")})</span>
                    </span>
                  )}
                  {crossGroup && (
                    <span
                      className="block text-[10px]"
                      style={{ color: colors.textSubtle }}
                    >
                      {t("countedUnder", { group: groupName })}
                    </span>
                  )}
                </span>
                {played && (
                  <span
                    className="flex-shrink-0 rounded px-1.5 text-[10px]"
                    style={{ color: colors.primary }}
                  >
                    ✓ {t("minePlayed")}
                  </span>
                )}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => onRemove(p)}
                    disabled={pending.has(p.songId)}
                    aria-label={t("removeAria", { title: p.title })}
                    className="flex-shrink-0 px-1 text-[14px] leading-none disabled:opacity-40"
                    style={{ color: colors.textMuted }}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canAdd && (
        <>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={atCap}
            aria-describedby={atCap ? capNoteId : undefined}
            className="rounded-full px-3 py-1 text-[12px] disabled:opacity-50"
            style={{
              border: `1px dashed ${colors.border}`,
              color: colors.textPrimary,
            }}
          >
            {t(copy.add, { group: groupName })}
          </button>
          {atCap && (
            <p
              id={capNoteId}
              className="mt-1 text-[11px]"
              style={{ color: colors.textMuted }}
            >
              {t("capReached", { max })}
            </p>
          )}
          <SongPickerSheet
            locale={locale}
            songs={groupSongs as AvailableSong[]}
            selectedIds={picks.map((p) => Number(p.songId))}
            unitFilters={[]}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onToggle={handleToggle}
          />
        </>
      )}
    </div>
  );
}

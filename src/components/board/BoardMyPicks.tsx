"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { entityPath } from "@/lib/seo/entityUrl";
import { SongPickerSheet } from "@/components/predict/SongPickerSheet";
import {
  BOARD_PICKS_PER_GROUP,
  BOARD_WISHES_PER_GROUP,
} from "@/lib/board/config";
import type { StoredBoardPick } from "@/lib/board/pickStorage";
import { deriveUnitFilters } from "@/lib/predict/unitFilters";
import type { AvailableSong } from "@/lib/types/predict";
import { colors } from "@/styles/tokens";
import styles from "@/components/event/eventDetail.module.css";

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
 * Unit chips: the same `deriveUnitFilters` the single-artist Predicted
 * Setlist uses, with THIS group as the primary artist — so the sheet
 * offers "all / the group / its main units (+ big solo catalogs) /
 * others" exactly like the prediction picker on that group's own event.
 * The festival chip set (`deriveFestivalFilters`) would be wrong here:
 * the list is already one group, so a per-group chip is a no-op. On a
 * festival a crossover song's `unit` / `creditedArtistIds` were
 * computed relative to the FIRST group that listed it
 * (`mergeFestivalCatalog`), so under a later group it matches none of
 * that group's unit chips and lands in "others" — still reachable, and
 * the search box finds it regardless.
 *
 * Used for both columns (n15): `kind` picks the copy and the cap —
 * "my picks" under "expect", "my wishes" under "want". The two caps are
 * the same number today; each is read from its own constant so they
 * can't silently couple.
 */

const COPY = {
  pick: {
    mine: "mine",
    add: "add",
    pickerTitle: "pickerTitle",
    max: BOARD_PICKS_PER_GROUP,
  },
  wish: {
    mine: "mineWish",
    add: "addWish",
    pickerTitle: "pickerTitleWish",
    max: BOARD_WISHES_PER_GROUP,
  },
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
  const tPredict = useTranslations("Predict");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const copy = COPY[kind];
  const unitFilters = useMemo(() => {
    const groupArtistId = Number(groupId);
    if (groupSongs.length === 0 || !Number.isSafeInteger(groupArtistId)) {
      return [];
    }
    // `deriveUnitFilters` drops the group chip when no song is credited
    // to the group directly — e.g. a single-artist series run by a
    // sub-unit, whose catalog is scoped to that unit while the board's
    // group is its root — so the group id is always safe to pass.
    return deriveUnitFilters(
      groupSongs,
      groupArtistId,
      groupName,
      tPredict("picker.filterAll"),
      tPredict("picker.filterOthers"),
      colors.primary,
    );
  }, [groupSongs, groupId, groupName, tPredict]);
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
    // 18-v3 `.my-choices`: my picks as tinted chips (pink in the want
    // ballot, blue in the expect one — the ballot sets the tone), then
    // the full-width "add" button. Played picks (results mode) get an
    // ink-blue ring plus the ✓ label, not colour alone.
    <div
      className={styles.myChoices}
      data-testid={kind === "pick" ? "board-my-picks" : "board-my-wishes"}
      tabIndex={-1}
      role="group"
      aria-label={t(copy.mine)}
    >
      <div className={styles.myChoicesHead}>
        <h4 className={styles.myChoicesTitle}>{t(copy.mine)}</h4>
        <span data-testid="board-pick-counter" className={styles.myChoicesCounter}>
          {t("counter", { count: picks.length, max })}
        </span>
      </div>

      {picks.length > 0 && (
        <ul className={styles.myChoiceList}>
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
                className={`${styles.myChoice} ${played ? styles.myChoicePlayed : ""}`}
              >
                <span className="min-w-0">
                  {available ? (
                    // Bare-id song URL: a stored pick carries no slug;
                    // the song page's canonical 308 adds it.
                    <Link href={entityPath("songs", locale, p.songId, "")}>{p.title}</Link>
                  ) : (
                    <span style={{ color: colors.textMuted }}>
                      {p.title}{" "}
                      <span className="text-[11px]">({t("unavailable")})</span>
                    </span>
                  )}
                  {crossGroup && (
                    <span className={styles.myChoiceNote}>
                      {t("countedUnder", { group: groupName })}
                    </span>
                  )}
                </span>
                {played && (
                  <span className="flex-shrink-0 px-1 text-[11px] font-bold">
                    ✓ {t("minePlayed")}
                  </span>
                )}
                {!locked && (
                  <button
                    type="button"
                    onClick={() => onRemove(p)}
                    disabled={pending.has(p.songId)}
                    aria-label={t("removeAria", { title: p.title })}
                    className={`${styles.myChoiceRemove} disabled:opacity-40`}
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
            ref={pickerTrigger}
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={atCap}
            aria-describedby={atCap ? capNoteId : undefined}
            className={styles.pickButton}
          >
            {t(copy.add, { group: groupName })}
          </button>
          {atCap && (
            <p id={capNoteId} className={styles.capNote}>
              {t("capReached", { max })}
            </p>
          )}
          <SongPickerSheet
            locale={locale}
            songs={groupSongs as AvailableSong[]}
            selectedIds={picks.map((p) => Number(p.songId))}
            unitFilters={unitFilters}
            title={t(copy.pickerTitle, { group: groupName })}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onToggle={handleToggle}
            triggerRef={pickerTrigger}
          />
        </>
      )}
    </div>
  );
}

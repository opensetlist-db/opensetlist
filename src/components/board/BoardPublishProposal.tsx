"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ANON_TOKEN_HEADER, readExistingAnonId } from "@/lib/anonId";
import { trackEvent } from "@/lib/analytics";
import { BOARD_PICKS_PER_GROUP } from "@/lib/board/config";
import {
  boardGroupsBySong,
  deriveBoardProposal,
  previewPublish,
  type ProposalPick,
} from "@/lib/board/proposal";
import {
  readBoardPicks,
  writeBoardPicks,
  type StoredBoardPick,
} from "@/lib/board/pickStorage";
import { pickTitle } from "@/lib/board/pickTitle";
import { pickFailureKey, publishBallot } from "@/components/board/useBoardPicks";
import type { BoardChip, BoardMineResponse } from "@/lib/board/types";
import type { PredictionEntry } from "@/lib/predictionsStorage";
import type { AvailableSong } from "@/lib/types/predict";
import { colors } from "@/styles/tokens";

/**
 * "Put on the board" (n15-09b): the fan's ordered full setlist turned
 * into an editable proposal of expected songs, with a preview of what
 * publishing does to their current board picks, and the confirm that
 * publishes it.
 *
 *   - The proposal is derived once, when the panel opens
 *     (`deriveBoardProposal`): per group, the first three of that
 *     group's songs in list order. From then on it is the fan's to
 *     edit — remove a song, add another from the group's catalog (a
 *     swap is the two), move a crossover to its other group.
 *   - The preview compares against "mine": the local copy of the
 *     ballot, or `/board/mine` once when that copy is empty (another
 *     device, cleared storage), so a fan is never told "nothing will
 *     be removed" about picks they made elsewhere.
 *   - Confirm sends the whole set (`PUT /board/picks`); the server
 *     replaces the ballot atomically. On success the local copy is
 *     rewritten from the server's answer and the parent refreshes the
 *     board. On failure nothing changed, on either side.
 *
 * One-way and one-shot: nothing links the list to the board after
 * this. A later edit to the list leaves the published picks alone
 * until the fan publishes again.
 */
export function BoardPublishProposal({
  eventId,
  locale,
  groups,
  catalog,
  draft,
  onPublished,
  onCancel,
}: {
  eventId: string;
  locale: string;
  /** The board's groups, in board order (the page's board chips). */
  groups: readonly BoardChip[];
  catalog: readonly AvailableSong[];
  /** The full setlist as it stands when the panel opens. */
  draft: readonly PredictionEntry[];
  /** After a successful publish, with the number of picks published. */
  onPublished: (count: number) => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Board");
  const groupIds = useMemo(() => groups.map((g) => g.groupId), [groups]);
  const catalogById = useMemo(
    () => new Map(catalog.map((s) => [String(s.songId), s])),
    [catalog],
  );
  const groupsOfSong = useMemo(
    () => boardGroupsBySong(groupIds, catalog),
    [groupIds, catalog],
  );
  // Derived once at open; edits below are the fan's.
  const [proposal, setProposal] = useState<ProposalPick[]>(() =>
    deriveBoardProposal(draft, groupIds, catalog),
  );
  const [mine, setMine] = useState<StoredBoardPick[]>(() => readBoardPicks(eventId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Mine" fallback for the preview, mirroring `useBoardPicks`: only
  // when the local copy is empty and this browser has an anon id. One
  // try — a failure just leaves the preview on the local copy.
  useEffect(() => {
    if (readBoardPicks(eventId).length > 0) return;
    const anonId = readExistingAnonId();
    if (!anonId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/events/${eventId}/board/mine?${new URLSearchParams({ locale })}`,
          { headers: { [ANON_TOKEN_HEADER]: anonId }, cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as BoardMineResponse;
        if (cancelled || !Array.isArray(body.picks)) return;
        setMine(
          body.picks.map((p) => ({
            id: p.id,
            groupId: p.groupId,
            songId: p.songId,
            title: p.title,
            available: p.available,
          })),
        );
      } catch {
        // Preview stays on the (empty) local copy.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, locale]);

  const titleOf = (songId: string) => {
    const song = catalogById.get(songId);
    if (song) return pickTitle(song, locale);
    return mine.find((p) => p.songId === songId)?.title ?? songId;
  };
  const countIn = (groupId: string) =>
    proposal.filter((p) => p.groupId === groupId).length;
  const preview = previewPublish(proposal, mine);
  const changes = preview.added.length + preview.removed.length;

  const remove = (songId: string) =>
    setProposal((cur) => cur.filter((p) => p.songId !== songId));
  const add = (groupId: string, songId: string) =>
    setProposal((cur) =>
      cur.some((p) => p.songId === songId) || countIn(groupId) >= BOARD_PICKS_PER_GROUP
        ? cur
        : [...cur, { songId, groupId, choices: groupsOfSong.get(songId) ?? [groupId] }],
    );
  const move = (songId: string, groupId: string) =>
    setProposal((cur) =>
      cur.map((p) => (p.songId === songId ? { ...p, groupId } : p)),
    );

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const outcome = await publishBallot(eventId, proposal);
    setPending(false);
    if (!outcome.ok) {
      setError(t(pickFailureKey(outcome.reason), { max: BOARD_PICKS_PER_GROUP }));
      return;
    }
    writeBoardPicks(
      eventId,
      outcome.picks.map((p) => ({
        id: p.id,
        groupId: p.groupId,
        songId: p.songId,
        title: titleOf(p.songId),
        available: true,
      })),
    );
    trackEvent("board_publish", {
      event_id: eventId,
      pick_count: outcome.picks.length,
    });
    onPublished(outcome.picks.length);
  };

  const songsList = (ids: string[]) => ids.map(titleOf).join(t("copySongSeparator"));

  return (
    <div
      data-testid="board-publish-proposal"
      className="text-[12px]"
      style={{
        padding: "10px 14px",
        borderBottom: `0.5px solid ${colors.borderLight}`,
        background: colors.bgSubtle,
      }}
    >
      <h4 className="font-medium" style={{ color: colors.textPrimary }}>
        {t("proposalTitle")}
      </h4>
      <p className="mb-2 text-[11px]" style={{ color: colors.textMuted }}>
        {t("proposalExplainer", { max: BOARD_PICKS_PER_GROUP })}
      </p>

      <ul className="space-y-2">
        {groups.map((g) => {
          const inGroup = proposal.filter((p) => p.groupId === g.groupId);
          const full = inGroup.length >= BOARD_PICKS_PER_GROUP;
          const addable = catalog.filter(
            (s) =>
              groupsOfSong.get(String(s.songId))?.includes(g.groupId) &&
              !proposal.some((p) => p.songId === String(s.songId)),
          );
          return (
            <li key={g.groupId} data-testid="proposal-group" data-group={g.groupId}>
              <div className="mb-0.5 flex items-center justify-between">
                <span style={{ color: g.color ?? colors.textPrimary }}>{g.label}</span>
                <span className="tabular-nums" style={{ color: colors.textMuted }}>
                  {t("counter", { count: inGroup.length, max: BOARD_PICKS_PER_GROUP })}
                </span>
              </div>
              {inGroup.length === 0 && (
                <p className="text-[11px]" style={{ color: colors.textSubtle }}>
                  {t("proposalSkipped")}
                </p>
              )}
              <ul className="flex flex-wrap gap-1">
                {inGroup.map((p) => {
                  const title = titleOf(p.songId);
                  return (
                    <li
                      key={p.songId}
                      data-testid="proposal-chip"
                      className="flex items-center gap-1 rounded-full px-2 py-0.5"
                      style={{ background: colors.bgCard, border: `1px solid ${colors.border}` }}
                    >
                      <span>{title}</span>
                      {p.choices.length > 1 && (
                        <select
                          aria-label={t("proposalCountUnderAria", { title })}
                          value={p.groupId}
                          onChange={(e) => move(p.songId, e.target.value)}
                          className="text-[11px]"
                        >
                          {p.choices.map((c) => {
                            const chip = groups.find((x) => x.groupId === c);
                            return (
                              <option
                                key={c}
                                value={c}
                                // A group already at the cap can't take
                                // one more; staying put is always fine.
                                disabled={c !== p.groupId && countIn(c) >= BOARD_PICKS_PER_GROUP}
                              >
                                {chip?.label ?? c}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => remove(p.songId)}
                        aria-label={t("removeAria", { title })}
                        className="px-0.5 leading-none"
                        style={{ color: colors.textMuted }}
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!full && addable.length > 0 && (
                <select
                  aria-label={t("add", { group: g.label })}
                  value=""
                  onChange={(e) => {
                    if (e.target.value) add(g.groupId, e.target.value);
                  }}
                  className="mt-1 text-[11px]"
                >
                  <option value="">{t("add", { group: g.label })}</option>
                  {addable.map((s) => (
                    <option key={s.songId} value={String(s.songId)}>
                      {pickTitle(s, locale)}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>

      <div data-testid="proposal-preview" className="mt-2 text-[11px]" style={{ color: colors.textSecondary }}>
        {changes === 0 ? (
          <p>{t("previewNoChange")}</p>
        ) : (
          <>
            {preview.removed.length > 0 && (
              <p data-testid="preview-removed">
                {t("previewRemoved", { songs: songsList(preview.removed.map((p) => p.songId)) })}
              </p>
            )}
            {preview.added.length > 0 && (
              <p data-testid="preview-added">
                {t("previewAdded", { songs: songsList(preview.added.map((p) => p.songId)) })}
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-1 text-[11px]" style={{ color: colors.error }}>
          {error}
        </p>
      )}

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={pending}
          className="rounded-full px-3 py-1 text-[12px] disabled:opacity-50"
          style={{ background: colors.primary, color: colors.bgCard }}
        >
          {t("publish")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-full px-3 py-1 text-[12px]"
          style={{ border: `1px solid ${colors.border}`, color: colors.textPrimary }}
        >
          {t("proposalCancel")}
        </button>
      </div>
    </div>
  );
}

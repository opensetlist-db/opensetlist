/**
 * Wire types of the fan board (n15) — shared by the read route, the
 * event page and the client block. Type-only module: safe to import
 * from client code.
 *
 * Ids cross the wire as decimal strings (BigInt-safe — the same reason
 * `boardStarterSongIds` stores strings); every timestamp is a UTC ISO
 * instant. The response carries nothing personal: "my picks" never
 * travel in a board read.
 */

/** How a column should be presented.
 *   - `operator`: zero fan submissions — show the operator's starter
 *     picks (labelled, never counted) or the empty invitation.
 *   - `early`: some submissions but fewer than the participant
 *     threshold — titles and counts only, flagged "early sample".
 *   - `ok`: enough participants for a plain TOP3. */
export type BoardColumnLabel = "operator" | "early" | "ok";

export interface BoardSongRef {
  songId: string;
  /** Localized display title (variant label already folded in). */
  title: string;
}

export interface BoardTopEntry extends BoardSongRef {
  count: number;
  /** False when the song was soft-deleted after it was picked: the
   *  vote stays, the title renders without a link. */
  available: boolean;
}

export interface BoardColumn {
  top: BoardTopEntry[];
  /** Rows submitted to this column (legacy rows included). */
  submissions: number;
  /** Distinct non-null anon ids behind those rows. */
  participants: number;
  label: BoardColumnLabel;
}

export interface BoardGroupView {
  groupId: string;
  slug: string;
  name: string;
  /** `Artist.color`; null = primary colour. */
  color: string | null;
  /** "Songs fans want to hear" — per-group wishes (n15-08). Legacy
   *  wishes (no anon id, no stored group) are counted under the group
   *  their song resolves to: submissions, never participants. */
  wishes: BoardColumn;
  /** "Songs fans expect" — empty until fan picks exist (n15-03/04). */
  expects: BoardColumn;
  /** Operator starter picks, shown in whichever column is `operator`. */
  starters: BoardSongRef[];
}

/** One song of a group's shortlist, graded after the show (n15-06). */
export interface BoardShortlistEntry extends BoardTopEntry {
  /** The final setlist holds the song, a variant of it, or a medley
   *  including it. */
  played: boolean;
}

/** One group's graded shortlist: "N of K played", K ≤ 3. */
export interface BoardGroupTally {
  groupId: string;
  /** The group's expect-column TOP3 over the picks that existed at the
   *  lock — never the operator's starters. Empty when nobody picked. */
  shortlist: BoardShortlistEntry[];
  played: number;
  size: number;
}

/** The post-show tally (n15-06), sent only once the event is
 *  completed. */
export interface BoardTally {
  /** Over the DISTINCT songs of every shortlist — a song shortlisted
   *  under two groups counts once. */
  played: number;
  size: number;
  /** Same order as `groups` in the response. */
  groups: BoardGroupTally[];
  /** Every song id the final setlist counts as played (each setlist
   *  song and the base of each variant), so the client can highlight
   *  the viewer's own picks that were played — "my picks" never
   *  travel in a board read. */
  playedSongIds: string[];
}

/** The board read response. Four shapes, discriminated by the
 *  control state, so a client can never mistake a stub for an empty
 *  board:
 *   - disabled (or the flag was turned off): `{ enabled: false }`
 *   - locked stub (ongoing / cancelled): no aggregate was computed
 *   - upcoming: the aggregate
 *   - completed: the aggregate + the post-show tally */
export type BoardReadResponse =
  | { enabled: false }
  | {
      enabled: true;
      status: "ongoing" | "cancelled";
      locked: true;
      lockAt: string;
    }
  | {
      enabled: true;
      status: "upcoming";
      locked: boolean;
      lockAt: string;
      asOf: string;
      groups: BoardGroupView[];
    }
  | {
      enabled: true;
      status: "completed";
      locked: true;
      lockAt: string;
      asOf: string;
      groups: BoardGroupView[];
      tally: BoardTally;
    };

/** What the event page hands the client block: the flag (implicit —
 *  null when disabled), the lock time and the chips. Nothing from the
 *  aggregate; the block fetches that itself after mount. */
export interface BoardChip {
  groupId: string;
  slug: string;
  label: string;
  color: string | null;
}

/** What "copy my picks" (n15-05) needs from the page: the localized
 *  event name with its day (series short + event name, the same
 *  composition as the page title) and the canonical event path from
 *  `entityPath` — never rebuilt client-side from a display name. */
export interface BoardShareSeed {
  eventName: string;
  path: string;
}

export interface BoardBlockSeed {
  lockAt: string;
  chips: BoardChip[];
  share: BoardShareSeed;
}

/** One of the viewer's own expected-song picks, as `/board/mine`
 *  returns it (n15-03). Personal — never part of a board read. */
export interface BoardMinePick {
  /** Server row id — what a delete names. */
  id: string;
  groupId: string;
  songId: string;
  /** Localized display title at read time. */
  title: string;
  /** False when the song was soft-deleted after it was picked: shown
   *  without a link, still removable, still holding its slot. */
  available: boolean;
  createdAt: string;
}

/** One of the viewer's own per-group wishes (n15-08) — same shape as
 *  a pick. Only rows written with this anon id; legacy wishes are
 *  never returned (they have no owner on record). */
export type BoardMineWish = BoardMinePick;

export interface BoardMineResponse {
  picks: BoardMinePick[];
  wishes: BoardMineWish[];
}

/** Stable machine codes of the pick (and board wish) write routes' 4xx/503 bodies
 *  (`{ error: code }`). The client maps each to an i18n key. */
export type BoardPickErrorCode =
  | "invalid_event_id"
  | "invalid_body"
  | "invalid_anon_id"
  /** `/board/mine` called with the id in the URL (refused, see route). */
  | "anon_in_query"
  | "invalid_group"
  | "invalid_song"
  | "invalid_pick_id"
  | "invalid_wish_id"
  | "song_outside_group"
  | "not_found"
  | "song_not_found"
  | "pick_not_found"
  | "wish_not_found"
  | "board_disabled"
  | "board_locked"
  | "not_owner"
  | "cap_reached"
  /** A publish (n15-09b) listed one song twice. */
  | "duplicate_song"
  | "group_conflict"
  | "busy";

/** Body of a successful pick create (201 new / 200 exact retry). A
 *  board wish create (n15-08) answers with the same shape. */
export interface BoardPickCreated {
  id: string;
  groupId: string;
  songId: string;
  createdAt: string;
}

/** Body of a successful publish (n15-09b): the whole resulting
 *  ballot, oldest first. */
export interface BoardPublishResponse {
  picks: BoardPickCreated[];
}

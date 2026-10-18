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
  /** "Songs fans expect" — empty until fan picks exist (n15-03/04). */
  expects: BoardColumn;
  /** Operator starter picks, shown only while a column is `operator`. */
  starters: BoardSongRef[];
}

/** The board read response. Three shapes, discriminated by the
 *  control state, so a client can never mistake a stub for an empty
 *  board:
 *   - disabled (or the flag was turned off): `{ enabled: false }`
 *   - locked stub (ongoing / cancelled): no aggregate was computed
 *   - open / completed: the aggregate */
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
      status: "upcoming" | "completed";
      locked: boolean;
      lockAt: string;
      asOf: string;
      groups: BoardGroupView[];
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

export interface BoardBlockSeed {
  lockAt: string;
  chips: BoardChip[];
}

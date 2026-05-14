import type { ArtistType, SetlistItemStageType } from "@/generated/prisma/enums";

// Stage-type classification for user-submitted setlist rows
// (AddItemBottomSheet, Phase 1C).
//
// This helper is intentionally tiny and stateless so the client (to
// pre-check the performer list when the user picks a song) and the
// server (to write the authoritative DB row) can call it with the
// same inputs and get the same output. The server-side call is the
// authoritative one — the API route MUST recompute from DB rows,
// never trust a client-passed `stageType` (defense against tampering
// + drift between the client's loaded songArtists and the actual
// SongArtist rows that may have changed mid-session).
//
// Rules (per task-week3-add-item-bottom-sheet.md §"Type-specific
// auto-fill rules" + raw/20260503-user-setlist-confirm-system.md
// §"항목 유형별 자동 처리"):
//
//   itemType !== 'song'             → 'special'
//                                       (MC / video / interval rows
//                                       have no performers per spec)
//   exactly 1 credit, type='unit'   → 'unit'    (carries unitArtistId)
//   exactly 1 credit, type='solo'   → 'solo'
//   otherwise (multi-credit, or     → 'full_group'
//     single group credit)
//
// "Otherwise" includes:
//   - a song credited to a top-level group (full-group song)
//   - a collab between multiple artists (e.g. "Link to the FUTURE"
//     has three primary credits — each is a sub-unit but the song
//     itself is full-group from the event's perspective)
//
// `unitArtistId` is returned alongside so the caller can resolve the
// unit's current members via /api/artists/[id]/current-members. For
// non-unit results it's null.

export interface SongArtistRef {
  artistId: number;
  type: ArtistType;
}

export interface DerivedStage {
  stageType: SetlistItemStageType;
  unitArtistId: number | null;
}

export type ItemType = "song" | "mc" | "video" | "interval";

export function deriveStageType(
  itemType: ItemType,
  songArtists: SongArtistRef[],
): DerivedStage {
  if (itemType !== "song") {
    return { stageType: "special", unitArtistId: null };
  }
  if (songArtists.length === 1) {
    const only = songArtists[0];
    if (only.type === "unit") {
      return { stageType: "unit", unitArtistId: only.artistId };
    }
    if (only.type === "solo") {
      return { stageType: "solo", unitArtistId: null };
    }
    // single 'group' credit → full_group (the canonical full-group song).
  }
  return { stageType: "full_group", unitArtistId: null };
}

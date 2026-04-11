type StageIdentityRef = {
  id: string;
  translations: { locale: string; name: string; shortName: string | null }[];
};

type SetlistItemPerformer = {
  stageIdentity: StageIdentityRef;
};

type EventPerformerRow = {
  isGuest: boolean;
  stageIdentity: StageIdentityRef;
};

type SetlistItemWithPerformers = {
  performers: SetlistItemPerformer[];
  artists: { artist: { parentArtistId: bigint | null } }[];
};

/**
 * Resolves performers for a setlist item.
 *
 * Unit songs: always use SetlistItemMember (explicitly entered).
 * Full group songs: use SetlistItemMember if filled, otherwise fall back
 * to EventPerformer (regular only, excluding guests).
 */
export function getPerformers(
  setlistItem: SetlistItemWithPerformers,
  eventPerformers: EventPerformerRow[]
): StageIdentityRef[] {
  // Unit/solo songs — always use explicit performers
  if (isUnitSong(setlistItem)) {
    return setlistItem.performers.map((p) => p.stageIdentity);
  }

  // Full group songs with explicit performers (e.g. guest joins)
  if (setlistItem.performers.length > 0) {
    return setlistItem.performers.map((p) => p.stageIdentity);
  }

  // Full group songs — fallback to event regular performers
  return eventPerformers
    .filter((p) => !p.isGuest)
    .map((p) => p.stageIdentity);
}

/**
 * Checks if a setlist item is a unit song (artist has a parentArtistId).
 */
export function isUnitSong(setlistItem: SetlistItemWithPerformers): boolean {
  return setlistItem.artists.some((a) => a.artist.parentArtistId !== null);
}

import "./env";

/*
 * Sample-album ID resolver for the b06 spec. We resolve IDs through
 * env vars (E2E_LIVE_ALBUM_ID / E2E_ALBUM_ID / E2E_SINGLE_ID) rather
 * than a runtime Prisma lookup because the Prisma 7 generated client
 * is published as an ESM module, and the Playwright test runner
 * loads spec files through a CJS shim that can't `require()` an ESM
 * module mid-file without bundler help. Routing the IDs through
 * env keeps the spec runtime CJS-clean — and the operator can pin a
 * known-good catalog row per type rather than depending on the
 * dev DB's row ordering at test time.
 *
 * Each env var is optional. Missing entries cause the relevant test
 * cases to skip with a TODO-style message; the rest of the suite
 * still runs. The operator populates the missing entries from the
 * admin UI (b05) and the next run picks them up automatically.
 *
 * IDs ship as strings (never coerced to bigint) so they slot
 * straight into URL composition without an intermediate Number()
 * that would silently truncate >2^53.
 */
export interface AlbumSampleIds {
  liveAlbumId: string | null;
  albumId: string | null;
  singleId: string | null;
}

/*
 * Normalize empty / whitespace-only env values to `null` so the
 * spec's `requireSample(id, ...)` skip guard fires the same way
 * whether the operator left the var off entirely or set it to "".
 * A literal empty-string id would otherwise slip through the
 * `id === null` check and the spec would compose `/ko/albums/`
 * (no id), 404, and fail noisily on what was intended to be a skip.
 */
function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readSampleIds(): AlbumSampleIds {
  return {
    liveAlbumId: normalize(process.env.E2E_LIVE_ALBUM_ID),
    albumId: normalize(process.env.E2E_ALBUM_ID),
    singleId: normalize(process.env.E2E_SINGLE_ID),
  };
}

/*
 * Sample IDs for the b11 Sprint B2 cross-link + BD specs. Same
 * env-var + skip-if-missing contract as readSampleIds (the operator
 * pins known-good catalog rows from the admin UI; missing vars skip
 * the relevant cases). Each id is the kind of row its spec needs:
 *
 *   crossLinkSongId  — a Song that appears on ≥1 Album (drives the
 *                      Song page 수록 앨범 section, b08).
 *   discographyArtistId — an Artist with ≥1 credited Album (drives the
 *                      Artist overview 최신 앨범 + discography, b09).
 *   bdSeriesId       — an EventSeries with ≥1 live_album BD reachable
 *                      via its events' bdAlbumId (drives 투어 BD 목록, b09).
 *   relatedAlbumId   — an Album whose artist has ≥1 OTHER album (drives
 *                      the Album sidebar 관련 앨범 section, b09).
 *   bonusAlbumId     — an Album with ≥1 active store listing (drives the
 *                      매장특전 tab — b10's public output, b03 render).
 *   bdEventId        — an Event with a linked BD album whose section
 *                      currently renders (b07 EventBdSection).
 *   plainEventId     — an Event with no bdAlbumId (BD section absent).
 */
export interface CrossLinkSampleIds {
  crossLinkSongId: string | null;
  discographyArtistId: string | null;
  bdSeriesId: string | null;
  relatedAlbumId: string | null;
  bonusAlbumId: string | null;
}

export function readCrossLinkSampleIds(): CrossLinkSampleIds {
  return {
    crossLinkSongId: normalize(process.env.E2E_MULTI_ALBUM_SONG_ID),
    discographyArtistId: normalize(process.env.E2E_DISCOGRAPHY_ARTIST_ID),
    bdSeriesId: normalize(process.env.E2E_BD_SERIES_ID),
    relatedAlbumId: normalize(process.env.E2E_RELATED_ALBUM_ID),
    bonusAlbumId: normalize(process.env.E2E_BONUS_ALBUM_ID),
  };
}

export interface BdEventSampleIds {
  bdEventId: string | null;
  plainEventId: string | null;
}

export function readBdEventSampleIds(): BdEventSampleIds {
  return {
    bdEventId: normalize(process.env.E2E_BD_EVENT_ID),
    plainEventId: normalize(process.env.E2E_PLAIN_EVENT_ID),
  };
}

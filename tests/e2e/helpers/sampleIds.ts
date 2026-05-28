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

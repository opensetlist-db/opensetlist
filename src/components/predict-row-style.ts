/**
 * Dimmed-row opacity for `<PredictSongRow>`'s "matched-out-of-rank" +
 * "below-divider" states. Shared so the unit-test assertion (and any
 * future consumer that needs to mirror this look) references the same
 * value rather than hardcoding `0.4` independently.
 *
 * A plain module: the "use client" component that uses it may export
 * only components and hooks (`local/use-client-exports`).
 */
export const DIMMED_ROW_OPACITY = 0.4;

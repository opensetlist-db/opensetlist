// Single source of truth for "what counts as a song" in roll-up
// badges (home page sidebars, events list). The event-detail header
// uses the same predicate but inlined in JS over an already-loaded
// `setlistItems` array — see
// `src/app/[locale]/events/[id]/[[...slug]]/page.tsx` (`songsCount`).
// If you change this filter, update that JS predicate too.
//
// Why each clause:
//   isDeleted: false       — SetlistItem is soft-delete only.
//   type: "song"           — exclude mc / video / interval rows.
//   songs: { some: {} }    — exclude song-typed placeholders that an
//                            admin saved without picking a song yet.
//
// Typed via inline use at the Prisma `_count.select.setlistItems.where`
// position, so a schema change to any of these fields fails the call
// site at compile time without us importing `Prisma.*` types here.
export const SONG_COUNT_WHERE = {
  isDeleted: false,
  type: "song",
  songs: { some: {} },
} as const;

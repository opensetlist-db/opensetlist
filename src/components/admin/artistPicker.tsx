// Shared pieces for the admin artist <select>s (song credits, album
// artists, parent artist, event series, event). No hooks, so no
// "use client" — server and client modules can both import it.

/**
 * Fetch the full admin artist list (`GET /api/admin/artists`, no `q`).
 * Resolves to `[]` on a network error or a non-array body (`{ error }`
 * on a DB failure) so the caller's `.map` over the list can't crash the
 * whole form.
 */
export async function fetchAdminArtists<T>(): Promise<T[]> {
  try {
    const res = await fetch("/api/admin/artists");
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Option for a select value the fetched list doesn't contain.
 *
 * A <select> whose value matches no option renders its first option as
 * if it were selected — another artist, or the "없음" placeholder. The
 * operator then sees the wrong link, and touching the select saves it
 * (song PUT replaces every SongArtist row from form state). The current
 * value gets an option of its own whenever the list lacks it: a
 * soft-deleted artist (the route filters `isDeleted`), or a list that
 * is still loading or failed to load.
 */
export function UnlistedArtistOption({
  value,
  options,
  label,
}: {
  value: string | number | null | undefined;
  options: { id: string | number }[];
  label?: string;
}) {
  if (value === null || value === undefined || value === "") return null;
  if (options.some((a) => String(a.id) === String(value))) return null;
  return (
    <option value={value}>
      {label ?? `ID: ${value}`} (목록에 없음)
    </option>
  );
}

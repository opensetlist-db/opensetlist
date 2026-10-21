/*
 * Outlined icons used by the search page (approved 12-v1.2 icon set:
 * 24px grid, 1.7 stroke, round caps — the same treatment as the header
 * search icon). Decorative: every icon sits next to a visible or
 * accessible label.
 */

const PATHS = {
  search: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m15 15 5 5" />
    </>
  ),
  events: (
    <>
      <rect x="4" y="6" width="16" height="15" rx="2" />
      <path d="M8 3v6M16 3v6M4 11h16M8 15h3" />
    </>
  ),
  artists: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  songs: (
    <>
      <path d="M9 18V5l11-2v13M9 8l11-2" />
      <ellipse cx="6" cy="18" rx="3" ry="2" />
      <ellipse cx="17" cy="16" rx="3" ry="2" />
    </>
  ),
  albums: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
} as const;

export type SearchIconName = keyof typeof PATHS;

export function SearchIcon({
  name = "search",
  size = 20,
}: {
  name?: SearchIconName;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block shrink-0"
    >
      {PATHS[name]}
    </svg>
  );
}

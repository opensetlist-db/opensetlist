import { GroupCategory } from "@/generated/prisma/enums";

export const ADMIN_UNKNOWN_NAME = "이름 없음";

/**
 * `#rgb` / `#rrggbb` — the colour shapes every colour consumer accepts
 * (`ogPalette`'s `isValidHex`, CSS). Anything else would reach a
 * `style={{ background }}` as an invalid value and silently render as
 * no colour, so admin writes refuse it. Lives here, not in
 * `admin-input.ts` (server-only: it imports `next/server`), so the
 * client ArtistForm can run the same check before submitting.
 */
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Single source of `GroupCategory` enum values for admin UI
// dropdowns (ArtistForm + GroupForm). Derived from the generated
// Prisma enum so a schema-side change auto-propagates.
export const GROUP_CATEGORY_VALUES: readonly GroupCategory[] =
  Object.values(GroupCategory);

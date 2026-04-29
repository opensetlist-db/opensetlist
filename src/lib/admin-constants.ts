import { GroupCategory } from "@/generated/prisma/enums";

export const ADMIN_UNKNOWN_NAME = "이름 없음";

// Single source of `GroupCategory` enum values for admin UI
// dropdowns (ArtistForm + GroupForm). Derived from the generated
// Prisma enum so a schema-side change auto-propagates.
export const GROUP_CATEGORY_VALUES: readonly GroupCategory[] =
  Object.values(GroupCategory);

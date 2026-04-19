import type { ResolvedEventStatus } from "@/lib/eventStatus";
import type { ArtistType } from "@/generated/prisma/enums";

export type OgLocale = "ko" | "ja" | "en";

export const OG_LOCALES: readonly OgLocale[] = ["ko", "ja", "en"] as const;

export function normalizeOgLocale(raw: string | null | undefined): OgLocale {
  if (raw === "ja" || raw === "en" || raw === "ko") return raw;
  return "ko";
}

export const STATUS_LABELS: Record<OgLocale, Record<ResolvedEventStatus, string>> = {
  ko: {
    ongoing: "공연 중",
    upcoming: "업데이트 예정",
    completed: "아카이브",
    cancelled: "취소됨",
  },
  ja: {
    ongoing: "開催中",
    upcoming: "更新予定",
    completed: "アーカイブ",
    cancelled: "中止",
  },
  en: {
    ongoing: "LIVE NOW",
    upcoming: "UPDATING",
    completed: "ARCHIVED",
    cancelled: "CANCELLED",
  },
};

export const STATUS_DOT_COLOR: Record<ResolvedEventStatus, string> = {
  ongoing: "#EF4444",
  upcoming: "#F59E0B",
  completed: "#6B7280",
  cancelled: "#6B7280",
};

export const SONG_PILL_LABEL: Record<OgLocale, string> = {
  ko: "곡",
  ja: "曲",
  en: "SONG",
};

export const ARTIST_TYPE_LABELS: Record<OgLocale, Record<ArtistType, string>> = {
  ko: {
    solo: "솔로",
    group: "그룹",
    unit: "유닛",
  },
  ja: {
    solo: "ソロ",
    group: "グループ",
    unit: "ユニット",
  },
  en: {
    solo: "SOLO",
    group: "GROUP",
    unit: "UNIT",
  },
};

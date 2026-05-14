"use client";

import { useTranslations } from "next-intl";
import type { ItemType } from "@/lib/setlistStageType";

interface Props {
  value: ItemType;
  onChange: (next: ItemType) => void;
}

/**
 * 4-button pill row for the item-type axis of a user-submitted
 * setlist row: 🎵 곡 / 🎤 MC / 🎬 영상 / ⏸ 인터벌. Controlled.
 *
 * Per the task spec (§"항목 유형별 자동 처리"), only `song` triggers
 * the SongSearch + performer-checklist subsections. MC/video/interval
 * hide both — the parent does the conditional rendering, this
 * component just owns the type selection.
 *
 * Pill styling mirrors `<SetlistTabs>` (actual/predicted tabs) so
 * the surface reads as a sibling control even though it's a
 * different family of choice.
 */
export function ItemTypeSelector({ value, onChange }: Props) {
  const t = useTranslations("AddItem");
  const options: Array<{ value: ItemType; labelKey: string }> = [
    { value: "song", labelKey: "itemTypeSong" },
    { value: "mc", labelKey: "itemTypeMc" },
    { value: "video", labelKey: "itemTypeVideo" },
    { value: "interval", labelKey: "itemTypeInterval" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("sheetTitle")}
      className="flex gap-1.5 flex-wrap"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={
              active
                ? "px-3 py-1.5 text-sm font-medium rounded-full bg-gray-900 text-white"
                : "px-3 py-1.5 text-sm font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
            }
          >
            {t(opt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

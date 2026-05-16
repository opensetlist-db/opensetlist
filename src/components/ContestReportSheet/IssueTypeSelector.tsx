"use client";

import { useTranslations } from "next-intl";
import type { ContestReportType } from "@/generated/prisma/enums";

interface Props {
  value: ContestReportType;
  onChange: (next: ContestReportType) => void;
}

/**
 * 4-pill radio-group for the ContestReport issue type. Same visual
 * shape as `<ItemTypeSelector>` (AddItemBottomSheet) — pill row
 * with active-state styling. Type-driven conditional fields below
 * the selector handle the per-type input collection.
 */
export function IssueTypeSelector({ value, onChange }: Props) {
  const t = useTranslations("IssueReport");
  const options: Array<{ value: ContestReportType; labelKey: string }> = [
    { value: "wrong_song", labelKey: "wrong_song" },
    { value: "missing_performer", labelKey: "missing_performer" },
    { value: "wrong_variant", labelKey: "wrong_variant" },
    { value: "other", labelKey: "other" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("typeSection")}
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
            {t(`typeLabel.${opt.labelKey}`)}
          </button>
        );
      })}
    </div>
  );
}

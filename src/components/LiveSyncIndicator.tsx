"use client";

import { useTranslations } from "next-intl";
import type { Freshness } from "@/lib/snapshotFreshness";
import { colors } from "@/styles/tokens";

interface Props {
  freshness: Freshness;
}

export function LiveSyncIndicator({ freshness }: Props) {
  const t = useTranslations("Setlist");

  if (freshness.state !== "delayed") return null;

  return (
    <span
      role="status"
      className="mb-3 inline-flex items-center rounded-full px-2 py-0.5"
      style={{
        fontSize: 11,
        fontWeight: 600,
        background: colors.warningBg,
        color: colors.warning,
        whiteSpace: "nowrap",
      }}
    >
      {t("updatesDelayed")}
    </span>
  );
}

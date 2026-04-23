"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatEventDateTime } from "@/lib/eventDateTime";
import { useMounted } from "@/hooks/useMounted";

interface Props {
  date: string | Date | null;
  startTime: string | Date | null;
  variant?: "inline" | "stacked";
  className?: string;
}

export function EventDateTime({
  date,
  startTime,
  variant = "inline",
  className,
}: Props) {
  const locale = useLocale();
  const t = useTranslations("EventDateTime");
  const mounted = useMounted();

  if (!date && !startTime) return null;

  const f = formatEventDateTime({
    date,
    startTime,
    locale,
    viewerTimeZone: mounted ? undefined : "UTC",
  });

  const wrapperClass =
    variant === "stacked"
      ? "flex flex-col gap-0.5"
      : "flex flex-wrap items-center gap-x-2 gap-y-0.5";

  return (
    <div className={className ? `${wrapperClass} ${className}` : wrapperClass}>
      <span>{f.venueDateLabel}</span>
      {mounted && f.viewerTimeLabel && (
        <span className="text-zinc-500">
          · {t("localTime")} {f.viewerTimeLabel}
          {f.viewerDateParens && <> {f.viewerDateParens}</>}
        </span>
      )}
    </div>
  );
}

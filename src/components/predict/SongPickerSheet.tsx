"use client";

import { useTranslations } from "next-intl";
import { Drawer } from "vaul";
import { SongPickerContent } from "@/components/predict/SongPickerContent";
import { colors } from "@/styles/tokens";
import type { AvailableSong, UnitFilter } from "@/lib/types/predict";

interface Props {
  locale: string;
  songs: AvailableSong[];
  selectedIds: number[];
  unitFilters: UnitFilter[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (songId: number) => void;
}

/**
 * Mobile bottom-sheet wrapper around `<SongPickerContent>`. Uses
 * `vaul`'s `Drawer` primitive — same reference pattern as
 * `<CopyPastSetlistSheet>` and `<AddItemBottomSheet>`, with the
 * height / borderRadius / shadow overrides that match the
 * `event-page-mobile-predict-mockup.jsx` spec (82vh, 20px top
 * radius, soft elevated shadow).
 *
 * The desktop side-panel mounts `<SongPickerContent>` directly
 * without this wrapper — bottom-sheet semantics only make sense at
 * narrow viewports. Caller decides via `useIsDesktop()` which
 * surface to mount.
 *
 * Lock guard lives in the parent's `onToggle` callback (mirrors
 * `handleAdd` / `handleRemove`); the sheet itself doesn't take an
 * `isLocked` prop.
 */
export function SongPickerSheet({
  locale,
  songs,
  selectedIds,
  unitFilters,
  open,
  onOpenChange,
  onToggle,
}: Props) {
  const t = useTranslations("Predict");

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay
          className="fixed inset-0 z-[200]"
          style={{
            background: "rgba(15, 23, 42, 0.5)",
            backdropFilter: "blur(2px)",
          }}
        />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[210] flex flex-col bg-white outline-none"
          style={{
            height: "82vh",
            borderRadius: "20px 20px 0 0",
            boxShadow: "0 -8px 32px rgba(0, 0, 0, 0.15)",
          }}
        >
          {/* Drag handle — decorative pill. `vaul` provides swipe-
              to-dismiss natively; this is the visual affordance. */}
          <div
            style={{ padding: "12px 0 4px", flexShrink: 0 }}
            className="flex justify-center"
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: colors.border,
              }}
            />
          </div>

          {/* Sheet header — visible title (mockup-spec) + close × */}
          <div
            className="flex items-center justify-between"
            style={{
              padding: "4px 16px 10px",
              borderBottom: `1px solid ${colors.borderLight}`,
              flexShrink: 0,
            }}
          >
            <Drawer.Title
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: colors.textPrimary,
              }}
            >
              {t("picker.sheetTitle")}
            </Drawer.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label={t("picker.closeAria")}
              className="text-gray-500 hover:text-gray-900 text-xl leading-none"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ×
            </button>
          </div>

          <SongPickerContent
            songs={songs}
            selectedIds={selectedIds}
            unitFilters={unitFilters}
            onToggle={onToggle}
            locale={locale}
            onClose={() => onOpenChange(false)}
            autoFocus
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

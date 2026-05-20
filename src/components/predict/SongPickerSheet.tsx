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
    // `closeThreshold={0.5}` requires dragging the sheet half-way
    // down before vaul commits the close. Default vaul threshold
    // (~0.25) was too sensitive — operator-spotted on iPhone 13: a
    // small downward scroll inside the song list (trying to scroll
    // further down the catalog) triggered drag-to-dismiss and
    // closed the sheet. Bumping the threshold restores the natural
    // swipe-down-to-close gesture while ignoring incidental small
    // drags. `dismissible` stays default (true) — overlay tap +
    // Escape + drag-past-threshold all close as expected.
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      closeThreshold={0.5}
    >
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
            // 82vh per the mockup. Earlier dropped to 70vh to make
            // room for the prediction list underneath, but with
            // drag-to-dismiss back on (closeThreshold tuned), the
            // user can swipe down to peek and 82vh is the right
            // default again.
            height: "82vh",
            // Block horizontal scroll on narrow viewports — without
            // this, a long unit chip label or song title that
            // doesn't wrap can push the content past the right edge
            // on iPhone 13 (390pt) and the user sees a horizontal
            // scrollbar / cut-off content. `maxWidth: 100vw` defends
            // the iOS Safari focus-resize case where the layout
            // viewport briefly reports a wider width when the soft
            // keyboard opens — without the cap, vaul's
            // `width: 100%` on Drawer.Content can stretch past the
            // visual viewport's right edge.
            maxWidth: "100vw",
            overflowX: "hidden",
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
            // autoFocus intentionally OFF on mobile. Operator-spotted
            // on iPhone 13: opening the sheet would auto-pop the
            // soft keyboard, eating ~40% of the already-truncated
            // 70vh height + leaving the picker visually cramped.
            // User taps the search input to focus when they want
            // to type, which is the natural touch-first flow.
            autoFocus={false}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

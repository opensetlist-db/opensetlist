"use client";

import { useTranslations } from "next-intl";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
}

/**
 * Encore on/off switch for a user-submitted setlist row. The
 * `isEncore` flag is the single source of truth for the encore-
 * divider rendering (see `<ActualSetlist>` — the divider is
 * derived from `item.isEncore` boundaries, not a separate DB
 * record).
 *
 * A native checkbox styled as a switch (no library) keeps the
 * component < 30 LOC and avoids pulling in a Radix or Headless UI
 * dep for one toggle. `role="switch" aria-checked` carries the
 * correct accessibility semantics (a checkbox would announce
 * "checkbox checked"; a switch announces "switch on" — friendlier
 * for the on/off mental model).
 */
export function EncoreToggleRow({ checked, onChange }: Props) {
  const t = useTranslations("AddItem");
  return (
    <label className="flex items-center justify-between cursor-pointer select-none">
      <span className="text-sm text-gray-900">{t("encoreToggle")}</span>
      <button
        type="button"
        role="switch"
        // `aria-label` is required here even though the wrapping
        // `<label>` reads "앙코르" beside the switch: a `<label>` only
        // supplies an accessible name to native form controls
        // (`<input>`, `<select>`, etc.). For a `<button role="switch">`
        // the label association doesn't propagate, so screen readers
        // would announce an empty name without this attribute. Same
        // text as the label so visual + AT users hear the same thing.
        aria-label={t("encoreToggle")}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={
          checked
            ? "relative inline-flex h-6 w-11 items-center rounded-full bg-gray-900 transition-colors"
            : "relative inline-flex h-6 w-11 items-center rounded-full bg-gray-300 transition-colors"
        }
      >
        <span
          className={
            checked
              ? "inline-block h-5 w-5 transform rounded-full bg-white transition-transform translate-x-5"
              : "inline-block h-5 w-5 transform rounded-full bg-white transition-transform translate-x-0.5"
          }
        />
      </button>
    </label>
  );
}

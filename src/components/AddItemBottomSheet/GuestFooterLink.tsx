"use client";

import { useTranslations } from "next-intl";

/**
 * Footer link in `<AddItemBottomSheet>` — the spec's "out-of-event
 * guest handling" affordance. Phase 1C disallows users adding new
 * performers (no new-StageIdentity creation flow); when the user
 * notices a performer who DID appear but isn't in the checklist,
 * they're directed to the operator.
 *
 * `mailto:` is the affordance (no in-product DM at 1C); the operator
 * email is the project's canonical `help@opensetlist.com` from
 * CLAUDE.md. Subject is pre-filled so the operator's inbox is
 * filterable on first glance.
 */
export function GuestFooterLink() {
  const t = useTranslations("AddItem");
  const subject = encodeURIComponent("출연자 추가 제보");
  return (
    <a
      href={`mailto:help@opensetlist.com?subject=${subject}`}
      className="block text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
    >
      {t("guestFooter")}
    </a>
  );
}

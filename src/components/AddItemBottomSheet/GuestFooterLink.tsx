"use client";

import { useTranslations } from "next-intl";
import { CONTACT_EMAIL } from "@/lib/config";

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
  // i18n-keyed so a ja/en viewer doesn't get a Korean email subject
  // landing in the operator's inbox alongside their non-Korean body.
  const subject = encodeURIComponent(t("guestReportSubject"));
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}
      className="block text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
    >
      {t("guestFooter")}
    </a>
  );
}

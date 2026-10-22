import Link from "next/link";
import { colors } from "@/styles/tokens";

export interface BreadcrumbItem {
  label: string;
  /**
   * Omit `href` to mark this entry as the current page — it renders as
   * a non-clickable span. Per handoff §4 the current page is always the
   * last item in the list, but the component doesn't enforce that
   * (callers can render any subset; this keeps the API permissive).
   *
   * Hrefs must be **fully locale-prefixed** (e.g. `/ko/series/7/...`).
   * Earlier this component used the auto-prefixing `Link` from
   * `@/i18n/navigation`, but the prefix-on-render contract was hard to
   * audit (every static-analysis pass on every PR misread it as a
   * locale-stripping bug). Switched to `next/link` — callers pass
   * `/${locale}/...` explicitly, matching every other detail-page
   * link convention in the codebase.
   */
  href?: string;
}

interface Props {
  items: BreadcrumbItem[];
  /**
   * Translated `aria-label` for the wrapping `<nav>`. Required (not
   * defaulted to a literal "Breadcrumb") so the label is always
   * locale-correct — screen readers expose the value verbatim, so a
   * default English string would leak through on ko/ja pages.
   * Callers resolve via `getTranslations("Common")` → `ct("breadcrumb")`.
   */
  ariaLabel: string;
}

/**
 * WCAG 2.2 target size (24×24) for a crumb link. The 12px label alone is
 * far smaller (the ko "홈" is 11×16), so the link gets a padded hit area,
 * and an equal negative margin cancels it: the visual position and the
 * line height stay what the approved designs show. 5px, not 4px,
 * vertically — 16px text + 8px measured just under 24px in WebKit
 * (sub-pixel rounding). `min-w-6` covers labels narrower than 12px.
 * The link is a flex item of its `flex` wrapper span, so the box model
 * applies without an explicit `display`.
 *
 * Utility classes, not an inline style: Tailwind's utilities sit in a
 * cascade layer, so a page module can still override one property
 * (legal's 32px row resets the vertical margin) — an inline style would
 * beat every page rule.
 */
const LINK_HIT_AREA = "min-w-6 -mx-1.5 -my-[5px] px-1.5 py-[5px] text-center";

/**
 * Page breadcrumb — `Home › Series › Current page` style. Padding lives
 * on the parent `<main>` (currently `px-4 py-8` across pages); the
 * component just contributes a bottom margin so it sits cleanly above
 * the page header.
 */
export function Breadcrumb({ items, ariaLabel }: Props) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label={ariaLabel}
      className="mb-4 flex flex-wrap items-center text-xs"
      style={{ color: colors.textMuted }}
    >
      {items.map((item, i) => (
        <span key={i} className="flex items-center">
          {i > 0 && (
            <span aria-hidden="true" className="mx-1.5">
              ›
            </span>
          )}
          {item.href ? (
            <Link
              href={item.href}
              className={`${LINK_HIT_AREA} hover:underline`}
              style={{ color: colors.primary }}
            >
              {item.label}
            </Link>
          ) : (
            <span
              style={{ color: colors.textPrimary }}
              aria-current="page"
            >
              {item.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

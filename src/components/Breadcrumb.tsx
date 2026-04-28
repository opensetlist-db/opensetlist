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
              className="hover:underline"
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

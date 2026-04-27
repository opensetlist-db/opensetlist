import { Link } from "@/i18n/navigation";
import { colors } from "@/styles/tokens";

export interface BreadcrumbItem {
  label: string;
  /**
   * Omit `href` to mark this entry as the current page — it renders as
   * a non-clickable span. Per handoff §4 the current page is always the
   * last item in the list, but the component doesn't enforce that
   * (callers can render any subset; this keeps the API permissive).
   */
  href?: string;
}

interface Props {
  items: BreadcrumbItem[];
}

/**
 * Page breadcrumb — `Home › Series › Current page` style. Padding lives
 * on the parent `<main>` (currently `px-4 py-8` across pages); the
 * component just contributes a bottom margin so it sits cleanly above
 * the page header.
 */
export function Breadcrumb({ items }: Props) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center"
      style={{
        fontSize: 12,
        color: colors.textMuted,
      }}
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

import Link from "next/link";
import { colors } from "@/styles/tokens";

/*
 * Past-group pagination of the concert list (16-v1 `.pagination`).
 * 44px targets, text Previous/Next (omitted on the first/last page
 * rather than shown disabled), a numbered window of ±2 around the
 * current page with first/last + ellipsis beyond it, and a "n / N"
 * status line. Links keep `otherParams` (the active filter) so paging
 * never resets the filter.
 */

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  pageParamKey: string;
  otherParams?: Record<string, string>;
  labels: {
    /** Accessible name of the pagination landmark. */
    nav: string;
    prev: string;
    next: string;
    /** Already-formatted "current / total" line. */
    status: string;
  };
};

const ITEM =
  "grid min-h-11 min-w-11 place-items-center rounded-lg border px-2 py-2 text-[14px]";

export function Pagination({
  currentPage,
  totalPages,
  pageParamKey,
  otherParams = {},
  labels,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  function buildHref(page: number) {
    const params = new URLSearchParams({
      ...otherParams,
      [pageParamKey]: String(page),
    });
    return `?${params.toString()}`;
  }

  const delta = 2;
  const start = Math.max(1, currentPage - delta);
  const end = Math.min(totalPages, currentPage + delta);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  // `isPageNumber` false = Previous/Next: they point at a page but are
  // never the current-page marker.
  const link = (page: number, label: string | number, isPageNumber = true) => {
    const current = isPageNumber && page === currentPage;
    return (
      <Link
        key={`${page}-${label}`}
        href={buildHref(page)}
        aria-current={current ? "page" : undefined}
        className={ITEM}
        style={{
          background: current ? colors.primary : colors.bgCard,
          borderColor: current ? colors.primary : colors.borderStrong,
          color: current ? colors.bgCard : colors.textPrimary,
        }}
      >
        {label}
      </Link>
    );
  };
  const gap = (key: string) => (
    <span
      key={key}
      aria-hidden="true"
      className="px-1 text-[14px]"
      style={{ color: colors.textSecondary }}
    >
      …
    </span>
  );

  return (
    <>
      <nav
        aria-label={labels.nav}
        className="mt-7 flex flex-wrap items-center justify-center gap-2"
      >
        {currentPage > 1 && link(currentPage - 1, labels.prev, false)}
        {start > 1 && link(1, 1)}
        {start > 2 && gap("gap-start")}
        {pages.map((page) => link(page, page))}
        {end < totalPages - 1 && gap("gap-end")}
        {end < totalPages && link(totalPages, totalPages)}
        {currentPage < totalPages && link(currentPage + 1, labels.next, false)}
      </nav>
      <p
        className="mt-3 text-center text-[13px]"
        style={{ color: colors.textSecondary }}
      >
        {labels.status}
      </p>
    </>
  );
}

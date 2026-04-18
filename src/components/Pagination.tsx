import Link from "next/link";

type PaginationProps = {
  currentPage: number;
  totalPages: number;
  pageParamKey: string;
  otherParams?: Record<string, string>;
};

export function Pagination({
  currentPage,
  totalPages,
  pageParamKey,
  otherParams = {},
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

  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
      {currentPage > 1 ? (
        <Link
          href={buildHref(currentPage - 1)}
          className="font-dm-sans rounded px-3 py-1.5 text-[13px] text-[#555] hover:bg-[#f0f0f0]"
        >
          ←
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-[13px] text-[#ccc]">←</span>
      )}

      {start > 1 && (
        <>
          <Link
            href={buildHref(1)}
            className="font-dm-sans rounded px-3 py-1.5 text-[13px] text-[#555] hover:bg-[#f0f0f0]"
          >
            1
          </Link>
          {start > 2 && (
            <span className="px-1 text-[13px] text-[#ccc]">...</span>
          )}
        </>
      )}

      {pages.map((page) => (
        <Link
          key={page}
          href={buildHref(page)}
          className="font-dm-sans rounded px-3 py-1.5 text-[13px]"
          style={{
            background: page === currentPage ? "#4FC3F7" : "transparent",
            color: page === currentPage ? "#fff" : "#555",
            fontWeight: page === currentPage ? 500 : 400,
          }}
        >
          {page}
        </Link>
      ))}

      {end < totalPages && (
        <>
          {end < totalPages - 1 && (
            <span className="px-1 text-[13px] text-[#ccc]">...</span>
          )}
          <Link
            href={buildHref(totalPages)}
            className="font-dm-sans rounded px-3 py-1.5 text-[13px] text-[#555] hover:bg-[#f0f0f0]"
          >
            {totalPages}
          </Link>
        </>
      )}

      {currentPage < totalPages ? (
        <Link
          href={buildHref(currentPage + 1)}
          className="font-dm-sans rounded px-3 py-1.5 text-[13px] text-[#555] hover:bg-[#f0f0f0]"
        >
          →
        </Link>
      ) : (
        <span className="px-3 py-1.5 text-[13px] text-[#ccc]">→</span>
      )}
    </div>
  );
}

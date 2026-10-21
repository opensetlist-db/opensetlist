import { getLocale, getTranslations } from "next-intl/server";
import { QUERY_MAX_LENGTH } from "@/lib/globalSearch/params";

/*
 * Pre-redesign home Hero — not mounted by the current home page. Its
 * search field follows the search entry contract from ticket 13 so it
 * is never a dead control if mounted: a plain GET form to
 * `/{locale}/search?q=…` (overview, page 1 — same as the header form).
 * Ticket 15 builds the approved 14 Hero and wires its search with this
 * contract.
 */
export async function HomeHero() {
  const locale = await getLocale();
  const t = await getTranslations("Hero");
  const ts = await getTranslations("Search");

  return (
    <section
      className="px-4 py-8 md:py-10"
      style={{ background: "#f8f9fa" }}
    >
      <div className="mx-auto max-w-3xl text-center">
        <h1
          className="font-josefin uppercase text-[22px] md:text-[28px]"
          style={{ color: "#1a1a1a", letterSpacing: "1px" }}
        >
          {t("heading")}
        </h1>

        <form
          role="search"
          action={`/${locale}/search`}
          method="get"
          className="mx-auto mt-6 flex w-full max-w-[420px] items-center rounded-lg bg-white"
          style={{
            border: "1px solid #dddddd",
            borderRadius: "8px",
          }}
        >
          <label htmlFor="hero-search" className="sr-only">
            {ts("inputLabel")}
          </label>
          <input
            id="hero-search"
            type="search"
            name="q"
            maxLength={QUERY_MAX_LENGTH}
            autoComplete="off"
            placeholder={ts("placeholder")}
            className="font-dm-sans min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px]"
            style={{ color: "#1a1a1a" }}
          />
          <button
            type="submit"
            aria-label={ts("submit")}
            className="font-dm-sans flex min-h-11 items-center justify-center self-stretch rounded-r-[7px] px-4 py-2 text-white"
            style={{
              fontSize: "12px",
              fontWeight: 500,
              background: "linear-gradient(135deg, #4FC3F7, #0277BD)",
            }}
          >
            {/* Search icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </form>
      </div>
    </section>
  );
}

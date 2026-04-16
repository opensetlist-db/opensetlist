import { getTranslations } from "next-intl/server";

export async function HomeHero() {
  const t = await getTranslations("Hero");

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
        <p
          className="font-dm-sans mt-3 text-[14px]"
          style={{ color: "#777777" }}
        >
          {t("subtext")}
        </p>

        {/* TODO: wire up search in Phase 1C */}
        <div
          className="mx-auto mt-6 flex w-full max-w-[420px] items-center overflow-hidden rounded-lg bg-white"
          style={{
            border: "1px solid #dddddd",
            borderRadius: "8px",
          }}
        >
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            disabled
            aria-disabled="true"
            className="font-dm-sans flex-1 bg-transparent px-3 py-2 text-[13px] outline-none"
            style={{ color: "#1a1a1a" }}
          />
          <button
            type="button"
            aria-label={t("searchPlaceholder")}
            aria-disabled="true"
            tabIndex={-1}
            className="font-dm-sans flex items-center justify-center px-4 py-2 text-white cursor-default"
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
        </div>
      </div>
    </section>
  );
}

import * as Sentry from "@sentry/nextjs";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EditQueryButton } from "@/components/search/EditQueryButton";
import { SearchForm } from "@/components/search/SearchForm";
import {
  ActionLink,
  DisabledAction,
  ResultGroup,
  StatePanel,
} from "@/components/search/SearchResults";
import styles from "@/components/search/search.module.css";
import {
  OVERVIEW_LIMIT,
  PAGE_SIZE,
  QUERY_MAX_LENGTH,
  SEARCH_TYPES,
  parseSearchParams,
  searchHref,
  type ParsedSearch,
  type SearchParamsInput,
  type SearchType,
} from "@/lib/globalSearch/params";
import { rankIds, searchType, type SearchSlice } from "@/lib/globalSearch/service";
import { buildRowView, type RowLabels } from "@/lib/globalSearch/view";
import { colors } from "@/styles/tokens";

/*
 * `/[locale]/search` — global search over concerts, artists, songs and
 * albums (redesign ticket 13; approved design 12-v1.2).
 *
 * Server-rendered from the GET query alone (`parseSearchParams`), so
 * every state — overview, type page N, empty, no results, too long, out
 * of range, error — is a shareable URL that survives reload, back/forward
 * and a locale switch (the LanguageSwitcher keeps the query string).
 *
 *   no type   overview: four groups × at most 5, "more" link per group
 *             when a sixth match exists
 *   ?type=    one group, 20 per page, previous / next; no totals
 *
 * Results are `noindex` (query permutations are not content) and the
 * route is absent from the sitemap; entity pages keep their own SEO.
 * A database failure renders the error panel with a retry link to the
 * same URL instead of the route error boundary, so the typed query
 * stays on screen.
 */

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParamsInput>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale } = await params;
  const { q, tooLong } = parseSearchParams(await searchParams);
  const t = await getTranslations({ locale, namespace: "Search" });
  return {
    title: q && !tooLong ? t("metaTitle", { q }) : t("title"),
    robots: { index: false, follow: true },
  };
}

type Outcome =
  | { kind: "overview"; slices: SearchSlice[] }
  | { kind: "type"; slice: SearchSlice; anyMatch: boolean }
  | { kind: "error" };

async function runSearch(state: ParsedSearch): Promise<Outcome> {
  try {
    if (state.type) {
      const slice = await searchType(
        state.type,
        state.q,
        PAGE_SIZE,
        (state.page - 1) * PAGE_SIZE,
      );
      // An empty page past the first is "out of range" only when the type
      // has matches at all; otherwise it is plain "no results".
      const anyMatch =
        slice.hits.length > 0 ||
        state.page === 1 ||
        (await rankIds(state.type, state.q, 1, 0)).length > 0;
      return { kind: "type", slice, anyMatch };
    }
    const slices = await Promise.all(
      SEARCH_TYPES.map((type) => searchType(type, state.q, OVERVIEW_LIMIT, 0)),
    );
    return { kind: "overview", slices };
  } catch (err) {
    // The query text stays out of the event: it is user input.
    Sentry.captureException(err, { tags: { area: "global-search" } });
    return { kind: "error" };
  }
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const state = parseSearchParams(await searchParams);
  const t = await getTranslations({ locale, namespace: "Search" });
  const href = (s: { q?: string; type?: SearchType | null; page?: number }) =>
    `/${locale}${searchHref({ q: state.q, type: state.type, page: state.page, ...s })}`;

  const labels: RowLabels = {
    artistType: (type) => (t.has(`artistType.${type}`) ? t(`artistType.${type}`) : type),
    albumType: (type) => (t.has(`albumType.${type}`) ? t(`albumType.${type}`) : type),
    base: t("base"),
    variant: t("variant"),
  };
  const groupLabel = (type: SearchType) => t(type);

  let results: React.ReactNode;
  if (state.tooLong) {
    results = (
      <StatePanel
        title={t("longTitle")}
        body={t("longBody", { max: QUERY_MAX_LENGTH })}
        action={<EditQueryButton label={t("edit")} />}
      />
    );
  } else if (!state.q) {
    results = <StatePanel title={t("emptyTitle")} body={t("emptyBody")} />;
  } else {
    const outcome = await runSearch(state);
    const rowsOf = (slice: SearchSlice) =>
      slice.hits.map((hit) => buildRowView(hit, locale, state.q, labels));
    const summary = (
      <div className="mb-4 flex items-baseline justify-between gap-4 min-[700px]:mb-[18px]">
        <p
          className="m-0 text-[14px] [overflow-wrap:anywhere]"
          style={{ color: colors.textSecondary }}
        >
          {t("results", { q: state.q })}
        </p>
        {state.type && (
          <p className="m-0 shrink-0 text-[14px]" style={{ color: colors.textSecondary }}>
            {t("page", { page: state.page })}
          </p>
        )}
      </div>
    );

    if (outcome.kind === "error") {
      results = (
        <StatePanel
          tone="error"
          title={t("errorTitle")}
          body={t("errorBody")}
          action={<ActionLink href={href({})}>{t("retry")}</ActionLink>}
        />
      );
    } else if (outcome.kind === "type") {
      const { slice } = outcome;
      if (slice.hits.length === 0 && outcome.anyMatch && state.page > 1) {
        results = (
          <StatePanel
            title={t("rangeTitle")}
            body={t("rangeBody")}
            action={<ActionLink href={href({ page: 1 })}>{t("first")}</ActionLink>}
          />
        );
      } else if (slice.hits.length === 0) {
        results = <StatePanel title={t("noneTitle")} body={t("noneBody")} />;
      } else {
        results = (
          <>
            {summary}
            <div className="max-w-[900px]">
              <ResultGroup
                type={slice.type}
                heading={groupLabel(slice.type)}
                rows={rowsOf(slice)}
                emptyLabel={t("noGroup")}
                matchedLabel={t("matched")}
              />
              <nav
                aria-label={t("pagination")}
                className="mt-7 flex flex-wrap items-center justify-center gap-3"
              >
                {state.page > 1 ? (
                  <ActionLink href={href({ page: state.page - 1 })}>← {t("prev")}</ActionLink>
                ) : (
                  <DisabledAction>← {t("prev")}</DisabledAction>
                )}
                <span className="text-[14px]" aria-current="page">
                  {t("page", { page: state.page })}
                </span>
                {slice.hasMore ? (
                  <ActionLink href={href({ page: state.page + 1 })}>{t("next")} →</ActionLink>
                ) : (
                  <DisabledAction>{t("next")} →</DisabledAction>
                )}
              </nav>
            </div>
          </>
        );
      }
    } else {
      const { slices } = outcome;
      if (slices.every((s) => s.hits.length === 0)) {
        results = <StatePanel title={t("noneTitle")} body={t("noneBody")} />;
      } else {
        results = (
          <>
            {summary}
            {/* Two columns from 700px; one column below, in the fixed
                order concerts → artists → songs → albums. */}
            <div className="grid grid-cols-1 items-start gap-5 min-[700px]:grid-cols-2 min-[700px]:gap-6">
              {slices.map((slice) => (
                <ResultGroup
                  key={slice.type}
                  type={slice.type}
                  heading={groupLabel(slice.type)}
                  rows={rowsOf(slice)}
                  emptyLabel={t("noGroup")}
                  matchedLabel={t("matched")}
                  more={
                    slice.hasMore
                      ? {
                          href: href({ type: slice.type, page: 1 }),
                          label: t("more", { type: groupLabel(slice.type) }),
                        }
                      : null
                  }
                />
              ))}
            </div>
          </>
        );
      }
    }
  }

  return (
    <main className="w-full flex-1" style={{ background: colors.bgPage }}>
      <div className="mx-auto w-full max-w-[1200px] px-4 pb-10 pt-[30px] min-[700px]:px-8 min-[700px]:pb-16 min-[700px]:pt-[46px] min-[1264px]:px-0">
        <div className="mb-[22px] min-[700px]:mb-7">
          <h1 className="mb-3 text-[27px] font-bold leading-[1.35] tracking-[-0.035em] min-[700px]:text-[34px]">
            {t("title")}
          </h1>
          <p
            className="m-0 text-[14px] min-[700px]:text-[15px]"
            style={{ color: colors.textSecondary }}
          >
            {t("subtitle")}
          </p>
          <SearchForm
            // Remount on navigation so the field shows the new URL's query.
            key={`${state.q}\u0000${state.type ?? ""}`}
            locale={locale}
            q={state.q}
            type={state.type}
            labels={{
              form: t("formLabel"),
              input: t("inputLabel"),
              placeholder: t("placeholder"),
              submit: t("submit"),
              clear: t("clear"),
            }}
          />
        </div>
        <nav
          aria-label={t("typesLabel")}
          className="my-[22px] flex flex-wrap gap-1.5 min-[700px]:mb-[30px] min-[700px]:mt-[26px] min-[700px]:gap-2"
        >
          {[null, ...SEARCH_TYPES].map((type) => {
            const current = type === state.type;
            return (
              <Link
                key={type ?? "all"}
                // Changing type keeps the query and resets to page 1.
                href={href({ type, page: 1 })}
                aria-current={current ? "page" : undefined}
                className={`${current ? "" : styles.typeLink} inline-flex min-h-11 items-center rounded-lg border px-3 py-2.5 text-[13px] min-[700px]:px-[18px] min-[700px]:text-[14px]`}
                style={
                  current
                    ? {
                        background: colors.primary,
                        borderColor: colors.primary,
                        color: colors.bgCard,
                        fontWeight: 700,
                      }
                    : { background: colors.bgCard, borderColor: colors.borderStrong }
                }
              >
                {type ? groupLabel(type) : t("all")}
              </Link>
            );
          })}
        </nav>
        <div id="search-results">{results}</div>
      </div>
    </main>
  );
}

import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import { AlbumPurchasePanel, type AlbumForPurchase } from "@/components/albums/detail/AlbumPurchasePanel";
import { locales, type Locale } from "@/i18n/routing";

const messages = { en, ja, ko };
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: "Album" }) =>
    createTranslator({ locale, namespace, messages: messages[locale] }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
});

const amazonBonus = "https://www.amazon.co.jp/dp/B012345678?th=1";
const amazonPlain = "https://www.amazon.co.jp/dp/B012345679?psc=1";
const other = "https://example.com/product?tag=other";
const disclosures = {
  en: "We earn from qualifying Amazon purchases.",
  ja: "Amazonの対象購入で紹介料を得ます。",
  ko: "Amazon 적격 구매 시 수수료를 받습니다.",
};
const officialUrl = "https://example.com/official";
const bonusImageUrl = "https://example.com/poster.png";
const benefit = (name: string, endsAt: string | null = null) => ({
  id: name, originalBonusType: name, translations: [], startsAt: null, endsAt, endedAt: null,
});
const listing = (id: string, overrides: Record<string, unknown>) => ({
  id, originalStoreName: "Amazon", status: "active", originalEditionLabel: null,
  includesPerformanceVideo: true, isBonusOption: true, storeKey: null, officialOrder: null,
  startsAt: null, endsAt: null, sourceUrl: null, selectionGuide: null,
  productUrl: amazonBonus, translations: [], bonuses: [], ...overrides,
});

it.each(locales)("simplifies %s options while preserving benefits, links and tracking", async (locale) => {
  const disclosure = disclosures[locale];
  const album = {
    id: "135",
    slug: "dream",
    listings: [
      listing("bonus", {
        productUrl: amazonBonus + "&tag=old-22&tag=other-22",
        sourceUrl: officialUrl,
        selectionGuide: "Includes live shows A and B",
        originalEditionLabel: "Blu-ray Memorial BOX",
        bonuses: [{ ...benefit("Poster"), bonusImageUrl, originalBonusDescription: "Store exclusive poster" }],
      }),
      listing("plain", { productUrl: amazonPlain + "&tag=old-22", isBonusOption: false }),
      listing("other", { originalStoreName: "Example store", productUrl: other, bonuses: [benefit("Card")] }),
      listing("cd", { includesPerformanceVideo: false, bonuses: [benefit("CD bonus")] }),
      listing("expired", { bonuses: [benefit("Timed bonus", "2026-11-09T15:00:00Z")] }),
    ],
  } as unknown as AlbumForPurchase;

  const beforeCutoff = render(await AlbumPurchasePanel({
    album, locale, now: new Date("2026-11-09T14:59:59Z"),
  }));
  expect(beforeCutoff.getByText("CD bonus")).toBeTruthy();
  expect(beforeCutoff.getByText("Timed bonus")).toBeTruthy();
  const deadlinePrefix = messages[locale].Album.bonus.deadline.split("{time}")[0];
  expect(beforeCutoff.getByText((text) => text.startsWith(deadlinePrefix) && text.endsWith(" UTC"))).toBeTruthy();
  beforeCutoff.unmount();

  for (const tag of ["test-22", ""]) {
    vi.stubEnv("AMAZON_JP_ASSOCIATE_TAG", tag);
    const gtag = vi.fn();
    window.gtag = gtag;
    const { container, getByText, queryByText, queryAllByText, unmount } = render(await AlbumPurchasePanel({
      album, locale, now: new Date("2026-11-09T15:00:00Z"), performanceOnly: true,
    }));
    expect(getByText("Store exclusive poster")).toBeTruthy();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(bonusImageUrl);
    expect(queryAllByText(disclosure)).toHaveLength(tag ? 1 : 0);
    expect(queryByText("Includes live shows A and B")).toBeNull();
    expect(queryByText("Blu-ray Memorial BOX")).toBeNull();
    expect(queryByText("CD bonus")).toBeNull();
    expect(queryByText("Timed bonus")).toBeNull();
    expect(container.querySelector(`a[href="${officialUrl}"]`)).toBeNull();
    const options = [...container.querySelectorAll('[data-testid="purchase-option"]')];
    const expected = [
      { href: tag ? amazonBonus + "&tag=test-22" : amazonBonus, affiliated: Boolean(tag) },
      { href: other, affiliated: false },
      { href: tag ? amazonPlain + "&tag=test-22" : amazonPlain, affiliated: Boolean(tag) },
    ];
    expect(options).toHaveLength(expected.length);
    options.forEach((option, index) => {
      const link = within(option as HTMLElement).getByRole<HTMLAnchorElement>("link");
      const { href, affiliated } = expected[index];
      expect(link.getAttribute("href")).toBe(href);
      expect(link.relList.contains("sponsored")).toBe(affiliated);
      expect(within(option as HTMLElement).queryByText(disclosure)).toBeNull();
      fireEvent.click(link);
      expect(gtag).toHaveBeenCalledTimes(index + 1);
      expect(gtag).toHaveBeenLastCalledWith("event", "store_click", expect.objectContaining({
        album_id: "135", album_slug: "dream", surface: "album_page", is_affiliate: affiliated,
        purchase_option: index === 2 ? "without_bonus" : "with_bonus",
        store_key: index === 1 ? "other" : "amazon_jp",
        store_status: "active",
      }));
    });
    unmount();
  }
});

it("omits the disclosure when Amazon options are unsafe or ineligible", async () => {
  vi.stubEnv("AMAZON_JP_ASSOCIATE_TAG", "test-22");
  const active = listing("amazon", { bonuses: [benefit("Poster")] });
  const album = {
    id: "135",
    listings: [active],
  } as unknown as AlbumForPurchase;
  const { getByText, getByRole, queryByText, queryByRole, rerender } = render(
    await AlbumPurchasePanel({ album, locale: "en" }),
  );
  expect(getByRole("link").getAttribute("href")).toBe(amazonBonus + "&tag=test-22");
  expect(getByText(disclosures.en)).toBeTruthy();
  const unavailableAlbum = {
    ...album,
    listings: [
      listing("unsafe", { productUrl: "javascript://www.amazon.co.jp", bonuses: [benefit("Unsafe")] }),
      { ...active, status: "ended" },
    ],
  } as unknown as AlbumForPurchase;
  rerender(await AlbumPurchasePanel({ album: unavailableAlbum, locale: "en" }));
  expect(getByText(en.Album.bonus.empty)).toBeTruthy();
  expect(queryByRole("link")).toBeNull();
  expect(queryByText(disclosures.en)).toBeNull();
});

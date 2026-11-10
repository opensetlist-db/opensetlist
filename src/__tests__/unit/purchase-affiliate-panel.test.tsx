import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import ko from "../../../messages/ko.json";
import { AlbumPurchasePanel, type AlbumForPurchase } from "@/components/albums/detail/AlbumPurchasePanel";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: "Album" }) =>
    createTranslator({ locale, namespace, messages: ko }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.gtag;
});

const amazonBonus = "https://www.amazon.co.jp/dp/B012345678?th=1";
const amazonPlain = "https://www.amazon.co.jp/dp/B012345679?psc=1";
const other = "https://example.com/product?tag=other";
const benefit = (name: string, endsAt: string | null = null) => ({
  id: name, originalBonusType: name, translations: [], startsAt: null, endsAt, endedAt: null,
});
const listing = (id: string, overrides: Record<string, unknown>) => ({
  id, originalStoreName: "Amazon", status: "active", originalEditionLabel: null,
  includesPerformanceVideo: true, isBonusOption: true, storeKey: null, officialOrder: null,
  startsAt: null, endsAt: null, sourceUrl: null, selectionGuide: null,
  productUrl: amazonBonus, translations: [], bonuses: [], ...overrides,
});

it("keeps eligible choices, selection parameters and affiliate attribution aligned", async () => {
  const album = {
    id: "135",
    listings: [
      listing("bonus", { productUrl: amazonBonus + "&tag=old-22&tag=other-22", selectionGuide: "Choose poster", bonuses: [benefit("Poster")] }),
      listing("plain", { productUrl: amazonPlain + "&tag=old-22", isBonusOption: false }),
      listing("other", { productUrl: other, bonuses: [benefit("Card")] }),
      listing("cd", { selectionGuide: "CD only", includesPerformanceVideo: false, bonuses: [benefit("CD bonus")] }),
      listing("expired", { selectionGuide: "Expired choice", bonuses: [benefit("Expired bonus", "2026-11-09T15:00:00Z")] }),
    ],
  } as unknown as AlbumForPurchase;

  const beforeCutoff = render(await AlbumPurchasePanel({
    album, locale: "ko", now: new Date("2026-11-09T14:59:59Z"),
  }));
  expect(beforeCutoff.getByText("CD only")).toBeTruthy();
  expect(beforeCutoff.getByText("Expired choice")).toBeTruthy();
  beforeCutoff.unmount();

  for (const tag of ["test-22", ""]) {
    vi.stubEnv("AMAZON_JP_ASSOCIATE_TAG", tag);
    const gtag = vi.fn();
    window.gtag = gtag;
    const { container, queryByText, unmount } = render(await AlbumPurchasePanel({
      album, locale: "ko", now: new Date("2026-11-09T15:00:00Z"), performanceOnly: true,
    }));
    expect(queryByText("Choose poster")).toBeTruthy();
    expect(queryByText("CD only")).toBeNull();
    expect(queryByText("Expired choice")).toBeNull();
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
      expect(Boolean(within(option as HTMLElement).queryByText(ko.Album.bonus.affiliateDisclosure))).toBe(affiliated);
      fireEvent.click(link);
      expect(gtag).toHaveBeenCalledTimes(index + 1);
      expect(gtag).toHaveBeenLastCalledWith("event", "store_click", expect.objectContaining({
        album_id: "135", surface: "album_page", is_affiliate: affiliated,
      }));
    });
    unmount();
  }
});

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

it("keeps the purchase href, disclosure and click attribution aligned across tag settings", async () => {
  const album = {
    id: "135",
    listings: [
      {
        id: "bonus", originalStoreName: "Amazon", status: "active",
        productUrl: amazonBonus + "&tag=old-22&tag=other-22",
        translations: [],
        bonuses: [{ id: "b", originalBonusType: "Poster", translations: [] }],
      },
      {
        id: "plain", originalStoreName: "Amazon", status: "active",
        productUrl: amazonPlain + "&tag=old-22", translations: [], bonuses: [],
      },
      {
        id: "other", originalStoreName: "Amazon", status: "active",
        productUrl: other, translations: [], bonuses: [],
      },
    ],
  } as unknown as AlbumForPurchase;

  for (const tag of ["test-22", ""]) {
    vi.stubEnv("AMAZON_JP_ASSOCIATE_TAG", tag);
    const gtag = vi.fn();
    window.gtag = gtag;
    const { container, unmount } = render(await AlbumPurchasePanel({ album, locale: "ko" }));
    const cards = container.querySelectorAll("article");
    const expectedHrefs = tag
      ? [amazonBonus + "&tag=test-22", amazonPlain + "&tag=test-22", other]
      : [amazonBonus, amazonPlain, other];
    expect(cards).toHaveLength(expectedHrefs.length);

    cards.forEach((card, index) => {
      const link = within(card).getByRole<HTMLAnchorElement>("link");
      const affiliated = Boolean(tag) && index < 2;
      expect(link.getAttribute("href")).toBe(expectedHrefs[index]);
      expect(link.relList.contains("sponsored")).toBe(affiliated);
      expect(Boolean(within(card).queryByText(ko.Album.bonus.affiliateDisclosure))).toBe(affiliated);
      fireEvent.click(link);
      expect(gtag).toHaveBeenCalledTimes(index + 1);
      expect(gtag).toHaveBeenLastCalledWith("event", "store_click", {
        album_id: "135",
        store_key: "amazon_jp",
        store_status: "active",
        surface: "album_page",
        is_affiliate: affiliated,
      });
    });
    unmount();
  }
});

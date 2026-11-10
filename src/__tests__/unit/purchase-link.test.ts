import { describe, expect, it } from "vitest";
import { resolvePurchaseLink } from "@/lib/purchaseLink";

const product = "https://www.amazon.co.jp/dp/B012345678";
const selection = "th=1&psc=1&style=with%20bonus&option=a&option=b";
const stored = `${product}?${selection}&tag=old-22&%74ag=duplicate-22#details`;

describe("resolvePurchaseLink", () => {
  it.each([undefined, "", "   "])("removes all legacy tags with setting %j", (tag) => {
    expect(new URL(stored).searchParams.getAll("tag")).toEqual(["old-22", "duplicate-22"]);
    const link = resolvePurchaseLink(stored, tag);
    expect(link?.isAffiliate).toBe(false);
    const url = new URL(link!.href);
    expect(url.searchParams.has("tag")).toBe(false);
    expect([...url.searchParams]).toEqual([...new URLSearchParams(selection)]);
    expect(url.pathname).toBe("/dp/B012345678");
    expect(url.hash).toBe("#details");
  });

  it("replaces duplicate tags while retaining the product and selection", () => {
    const link = resolvePurchaseLink(stored, " test-22 ");
    expect(link?.isAffiliate).toBe(true);
    const url = new URL(link!.href);
    expect(url.searchParams.getAll("tag")).toEqual(["test-22"]);
    url.searchParams.delete("tag");
    expect([...url.searchParams]).toEqual([...new URLSearchParams(selection)]);
    expect(url.origin + url.pathname + url.hash).toBe(`${product}#details`);
  });

  it("accepts a verified direct product destination after short-link collection", () => {
    expect(resolvePurchaseLink("https://amazon.co.jp/gp/product/B012345678?th=1", "test-22"))
      .toEqual({
        href: "https://amazon.co.jp/gp/product/B012345678?th=1&tag=test-22",
        isAffiliate: true,
      });
  });

  it.each([
    "https://amzn.to/opaque",
    "https://www.amazon.co.jp.example.com/dp/B012345678?tag=untouched",
    "https://fakeamazon.co.jp/dp/B012345678",
    "https://www.amazon.co.jp@other.example/dp/B012345678",
    "https://other.example@www.amazon.co.jp/dp/B012345678",
    "https://www.amazon.co.jp:8443/dp/B012345678",
    "https://www.amazon.com/dp/B012345678",
    "https://www.animate.example/item?tag=their-tag",
  ])("leaves a non-approved destination unchanged: %s", (href) => {
    expect(resolvePurchaseLink(href, "test-22")).toEqual({ href, isAffiliate: false });
  });

  it.each([null, "", "not a URL", "javascript:alert(1)"])("rejects unusable href %j", (href) => {
    expect(resolvePurchaseLink(href, "test-22")).toBeNull();
  });
});

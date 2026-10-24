import { describe, it, expect } from "vitest";
import { classifyImageSource } from "@/lib/imageSourceBadge";

// The admin cover badge: a server-provided R2 host (derived from
// R2_PUBLIC_BASE_URL, which uploads build their URLs from) must classify
// an uploaded cover as R2 even when the badge-only env vars are unset.
describe("classifyImageSource", () => {
  it("uses the server-provided R2 host", () => {
    expect(classifyImageSource("https://img.opensetlist.com/prod/album-cover/1/a.png", { r2Host: "img.opensetlist.com" }))
      .toMatchObject({ label: "R2", warn: false });
  });

  it("(control) the same URL without a known R2 host is External", () => {
    expect(classifyImageSource("https://img.opensetlist.com/prod/album-cover/1/a.png", { r2Host: null }).label).not.toBe(
      "R2",
    );
  });

  it("keeps Amazon and empty classifications", () => {
    expect(classifyImageSource("https://m.media-amazon.com/images/I/x.jpg").label).toBe("Amazon");
    expect(classifyImageSource("").label).toBe("비어있음");
  });
});

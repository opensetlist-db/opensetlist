import { describe, it, expect, vi, beforeEach } from "vitest";

// `permanentRedirect` throws a NEXT_REDIRECT control-flow error in the
// real runtime; mock it to a throwing spy so the tests can assert the
// target without depending on Next internals.
const redirectSpy = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => redirectSpy(url),
}));

import { BASE_URL } from "@/lib/config";
import {
  entityAlternates,
  entityPath,
  enforceCanonicalSlug,
  staticAlternates,
} from "@/lib/seo/entityUrl";
import { eventHref } from "@/lib/eventHref";

beforeEach(() => {
  redirectSpy.mockClear();
});

describe("entityPath", () => {
  it("builds /{locale}/{kind}/{id}/{slug} for every id shape", () => {
    expect(entityPath("events", "ja", BigInt(8), "hasunosora-6th-saitama-day2")).toBe(
      "/ja/events/8/hasunosora-6th-saitama-day2",
    );
    expect(entityPath("songs", "ko", 17, "deepness")).toBe(
      "/ko/songs/17/deepness",
    );
    expect(entityPath("members", "en", "uuid-1", "kaho")).toBe(
      "/en/members/uuid-1/kaho",
    );
  });
});

describe("entityAlternates", () => {
  const alt = entityAlternates("events", "ko", BigInt(8), "slug-x");

  it("uses an absolute canonical for the requested locale", () => {
    expect(alt.canonical).toBe(`${BASE_URL}/ko/events/8/slug-x`);
  });

  it("lists every locale plus x-default, all absolute, all on the DB slug", () => {
    expect(alt.languages).toEqual({
      ko: `${BASE_URL}/ko/events/8/slug-x`,
      ja: `${BASE_URL}/ja/events/8/slug-x`,
      en: `${BASE_URL}/en/events/8/slug-x`,
      "x-default": `${BASE_URL}/ja/events/8/slug-x`,
    });
  });
});

describe("staticAlternates", () => {
  it("handles the home page (empty subpath) with x-default = ja", () => {
    const alt = staticAlternates("en", "");
    expect(alt.canonical).toBe(`${BASE_URL}/en`);
    expect(alt.languages["x-default"]).toBe(`${BASE_URL}/ja`);
  });

  it("handles list pages", () => {
    expect(staticAlternates("ko", "/events").languages.ja).toBe(
      `${BASE_URL}/ja/events`,
    );
  });
});

describe("enforceCanonicalSlug", () => {
  it("does nothing when the incoming slug is exactly the DB slug", () => {
    expect(() =>
      enforceCanonicalSlug("events", "ja", "8", "good", ["good"]),
    ).not.toThrow();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["bare id", undefined],
    ["empty catch-all", []],
    ["wrong slug", ["wrong"]],
    ["localized CJK slug", ["도쿄-공연-day1"]],
    ["extra segments", ["good", "extra"]],
  ])("308s on %s", (_label, incoming) => {
    expect(() =>
      enforceCanonicalSlug("events", "ja", "8", "good", incoming),
    ).toThrow("REDIRECT:/ja/events/8/good");
  });

  it("carries the query string across the redirect", () => {
    expect(() =>
      enforceCanonicalSlug("songs", "ko", "17", "deepness", undefined, {
        tab: "variations",
        unused: undefined,
      }),
    ).toThrow("REDIRECT:/ko/songs/17/deepness?tab=variations");
  });
});

describe("eventHref", () => {
  it("uses the DB slug verbatim instead of slugifying a display name", () => {
    expect(eventHref("ja", 14, "niji-8th-live-tokyo-day1")).toBe(
      "/ja/events/14/niji-8th-live-tokyo-day1",
    );
  });
});

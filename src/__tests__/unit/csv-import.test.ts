import { describe, it, expect } from "vitest";
import { resolveSongTranslations } from "@/lib/csv-parse";
import { catalogDisplayIssues } from "@/lib/catalog-import-display";
import { reviewCatalog, verifyReviewedCsv } from "../../../scripts/catalog-display-review.mjs";

describe("song CSV translation patches", () => {
  it("includes only supplied fields, even within the same locale", () => {
    expect(resolveSongTranslations({
      ja_title: "眩耀夜行",
      ja_variantLabel: "",
      ko_title: "",
      ko_variantLabel: "104기 Ver.",
      en_title: "",
    })).toEqual([
      { locale: "ja", title: "眩耀夜行", variantLabel: undefined },
      { locale: "ko", title: undefined, variantLabel: "104기 Ver." },
    ]);
  });
});

it("holds dependents but keeps an independent excluded title ready, then counts actual missing values in audit", () => {
  const title = {
    field: "title", kind: "title", original: "Day.1", originalLanguage: "ja",
    originalSource: "fixed:source", translations: [],
  };
  const mixed = { ...title, original: "Say Good-Bye 涙" };
  const candidates = [
    { key: "dependent", fields: [title], dependsOn: ["pending"] },
    { key: "pending", fields: [mixed] },
    { key: "ready", fields: [title] },
  ];
  const review = reviewCatalog(candidates);
  expect(review.ready).toEqual(["ready"]);
  expect(review.held.map(({ key }: { key: string }) => key)).toEqual(["dependent", "pending"]);
  expect(review.statuses).toEqual({ exempt: 3 });

  const audit = reviewCatalog([
    { ...candidates[0] },
    { ...candidates[1], hold: "source conflict", sourceCandidates: ["fixed:source"] },
    ...candidates.slice(2),
    { key: "stored", fields: [mixed] },
  ], { audit: true });
  expect(audit.held.map(({ key }: { key: string }) => key)).toEqual(["dependent", "pending"]);
  expect(audit.incomplete).toHaveLength(1);
  expect(audit.statuses).toEqual({ exempt: 3, missing: 2, "original-language": 1 });
});

it("checks actual CSV values against the reviewed field and follows a pending parent from the CSV", () => {
  const field = {
    field: "title", kind: "title", original: "Day.1", originalLanguage: "ja",
    originalSource: "fixed:source", translations: [],
  };
  const entry = {
    key: "song:variant",
    fields: [field],
    csv: [{
      file: "songs.csv",
      header: ["slug", "baseVersion_slug", "originalTitle"],
      row: ["variant", "parent", "Day.1"],
    }],
  };
  expect(() => verifyReviewedCsv(entry)).not.toThrow();
  expect(() => verifyReviewedCsv({
    ...entry, csv: [{ ...entry.csv[0], row: ["variant", "parent", "別の題名"] }],
  })).toThrow("CSV original differs");
  expect(reviewCatalog([entry, { key: "song:parent", hold: "pending source", fields: [] }]).ready).toEqual([]);
});

describe("catalog display completeness", () => {
  const title = [["originalTitle", "title", "title"]] as const;
  const mixed = { originalTitle: "Say Good-Bye 涙", originalLanguage: "ja" };
  const ko = { locale: "ko", title: "Say Good-Bye 눈물" };
  const en = { locale: "en", title: "Say Good-Bye Namida" };

  it("requires exact locales, accepts complete and exempt titles, and flags punctuation-only titles", () => {
    expect(catalogDisplayIssues({}, null, mixed, [ko], title)).toEqual(["en_title: missing"]);
    expect(catalogDisplayIssues({}, null, mixed, [ko, en], title)).toEqual([]);
    expect(catalogDisplayIssues({}, null, { ...mixed, originalTitle: "Ｄａｙ １！" }, [], title)).toEqual([]);
    expect(catalogDisplayIssues({}, null, { ...mixed, originalTitle: "？？？" }, [], title))
      .toEqual(["ko_title: title-review", "en_title: title-review"]);
  });

  it("requires independent confirmation for copied names, even for Latin names", () => {
    const fields = [["originalName", "name", "required"]] as const;
    const original = { originalName: "Liella!", originalLanguage: "ja" };
    const copies = [{ locale: "ko", name: "Liella!" }, { locale: "en", name: "Liella!" }];
    const source = "https://example.com/verified-fixture";
    expect(catalogDisplayIssues({}, null, original, copies, fields))
      .toEqual(["ko_name: unconfirmed-same", "en_name: unconfirmed-same"]);
    expect(catalogDisplayIssues({ ko_name_same_source: source }, null, original, copies, fields))
      .toEqual(["en_name: unconfirmed-same"]);
    expect(catalogDisplayIssues({ ko_name_same_source: source, en_name_same_source: source }, null, original, copies, fields))
      .toEqual([]);
  });

  it("requires a name before adding a short name to a new locale row", () => {
    const fields = [["originalName", "name", "required"]] as const;
    const existing = {
      originalName: "藍", originalLanguage: "ja",
      translations: [{ locale: "ko", name: "아이" }, { locale: "en", name: "Ai" }],
    };
    const patch = { locale: "ja", shortName: "あい" };
    expect(catalogDisplayIssues({}, existing, {}, [patch], fields))
      .toEqual(["ja_name: 번역 행에 이름이 필요합니다"]);
    expect(catalogDisplayIssues({}, existing, {}, [{ ...patch, name: "藍" }], fields)).toEqual([]);
  });

  it("applies the importer's source URL requirement in offline review", () => {
    const field = {
      field: "name", original: "Liella!", originalLanguage: "ja", originalSource: "fixed:original",
      translations: [
        { locale: "ko", value: "리에라!", source: "fixed:ko" },
        { locale: "en", value: "Liella!", source: "fixed:en", sameValueConfirmed: true },
      ],
    };
    expect(reviewCatalog([{ key: "artist:liella", fields: [field] }]).ready).toEqual([]);
    field.translations[1].source = "https://example.com/confirmed-fixture";
    expect(reviewCatalog([{ key: "artist:liella", fields: [field] }]).ready).toEqual(["artist:liella"]);
  });

  it("requires a name in a new group locale row even when CSV only patches its description", () => {
    const stored = {
      original: "藍", originalLanguage: "ja",
      translations: [{ locale: "ko", value: "아이" }, { locale: "en", value: "Ai" }],
    };
    const csv = [{ file: "groups.csv", header: ["slug", "ja_description"], row: ["ai", "説明"] }];
    expect(() => verifyReviewedCsv({ key: "group:ai", fields: [{ field: "name", stored, ...stored }], csv }))
      .toThrow("ja_name is required");
    const translations = [...stored.translations, { locale: "ja", value: "藍" }];
    expect(() => verifyReviewedCsv({
      key: "group:ai", fields: [{ field: "name", ...stored, stored: { ...stored, translations }, translations }], csv,
    })).not.toThrow();
  });

  it("checks the merged state for changed fields and lets unrelated legacy edits through", () => {
    const legacy = { ...mixed, translations: [ko] };
    const complete = { ...mixed, translations: [ko, en] };
    expect(catalogDisplayIssues({}, legacy, {}, [], title)).toEqual([]);
    expect(catalogDisplayIssues({}, legacy, {}, [{ ...ko, title: "다른 제목" }], title))
      .toEqual(["en_title: missing"]);
    expect(catalogDisplayIssues({}, complete, {}, [{ ...ko, title: "다른 제목" }], title)).toEqual([]);
    expect(catalogDisplayIssues({}, legacy, { originalTitle: "別の題名" }, [], title))
      .toEqual(["en_title: missing"]);
  });
});

import { describe, expect, it } from "vitest";
import { eventLanguageFields, prepareEventLanguageWrite, seriesLanguageFields } from "@/lib/adminEventLanguage";

const source = {
  originalLanguage: "ja", originalName: "冬の公演", originalVenue: "東京ドーム",
};
const translations = [
  { locale: "ko", name: "겨울 공연", venue: "도쿄돔" },
  { locale: "en", name: "Winter Show", venue: "Tokyo Dome" },
];

describe("manual event and series language writes", () => {
  it("rejects a missing local title and accepts both locales or an exempt day", () => {
    expect(prepareEventLanguageWrite({ translations }, eventLanguageFields, source).ok).toBe(true);
    expect(prepareEventLanguageWrite({ translations: translations.slice(0, 1) }, eventLanguageFields, source))
      .toMatchObject({ ok: false, message: expect.stringContaining("translations.en.name") });
    expect(prepareEventLanguageWrite({}, eventLanguageFields, {
      originalLanguage: "ja", originalName: "Day.1",
    }).ok).toBe(true);
  });

  it("stores local venues without requiring translations for a Roman title", () => {
    const day = { ...source, originalName: "Day.1", originalShortName: "Day.1" };
    const venueOnly = translations.map(({ locale, venue }) => ({ locale, venue }));
    expect(prepareEventLanguageWrite({ translations: venueOnly }, eventLanguageFields, day))
      .toMatchObject({ ok: true, value: { rows: [
        { locale: "ko", name: "", venue: "도쿄돔" },
        { locale: "en", name: "", venue: "Tokyo Dome" },
      ] } });
    expect(prepareEventLanguageWrite({ translations: venueOnly }, eventLanguageFields, {
      ...day, originalShortName: "Tour",
    })).toMatchObject({ ok: false, message: expect.stringContaining("translations.ko.shortName") });
  });

  it("requires locale rows for a changed description even when an approved wording stays identical", () => {
    const series = { originalName: "Tour", originalLanguage: "ja", originalDescription: "2027" };
    const rows = [{ locale: "ko", description: "2027" }, { locale: "en", description: "2027" }];
    expect(prepareEventLanguageWrite({ translations: rows }, seriesLanguageFields, series).ok).toBe(true);
    expect(prepareEventLanguageWrite({}, seriesLanguageFields, series, {
      ...series, originalDescription: "2026",
      translations: [{ locale: "ko", name: "", description: "2026" }, { locale: "en", name: "", description: "2026" }],
    })).toMatchObject({ ok: false, message: expect.stringContaining("translations.ko.description") });
  });

  it("patches only supplied fields and preserves an untranslated legacy record on unrelated edits", () => {
    const stored = { ...source, translations };
    const result = prepareEventLanguageWrite({
      translations: [{ locale: "ko", name: "겨울 라이브" }],
    }, eventLanguageFields, source, stored);
    expect(result).toMatchObject({ ok: true, value: {
      changed: [{ locale: "ko", name: "겨울 라이브", venue: "도쿄돔" }],
      rows: [{ locale: "ko", name: "겨울 라이브" }, translations[1]],
    } });
    const legacy = { ...source, translations: [] };
    expect(prepareEventLanguageWrite({}, eventLanguageFields, source, legacy).ok).toBe(true);
    expect(prepareEventLanguageWrite({}, eventLanguageFields, {
      ...source, originalName: "冬の公演2027",
    }, legacy).ok).toBe(false);
  });

  it("requires operator confirmation for identical organizer spellings, and rejects losing a required locale", () => {
    const series = {
      originalLanguage: "ja", originalName: "Live 2026", organizerName: "Bandai Namco",
    };
    const rows = [
      { locale: "ko", name: "Live 2026", organizerName: "반다이남코" },
      { locale: "en", name: "Live 2026", organizerName: "Bandai Namco", confirmedSame: ["organizerName"] },
    ];
    expect(prepareEventLanguageWrite({ translations: rows }, seriesLanguageFields, series).ok).toBe(true);
    expect(prepareEventLanguageWrite({ translations: [rows[0], { ...rows[1], confirmedSame: [] }] },
      seriesLanguageFields, series)).toMatchObject({ ok: false, message: expect.stringContaining("translations.en.organizerName") });
    expect(prepareEventLanguageWrite({ removeTranslations: ["ko"] }, seriesLanguageFields, series,
      { ...series, translations: rows }).ok).toBe(false);
  });
});

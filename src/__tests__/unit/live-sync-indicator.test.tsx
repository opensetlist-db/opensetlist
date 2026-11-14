import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LiveSyncIndicator } from "@/components/LiveSyncIndicator";
import type { Freshness } from "@/lib/snapshotFreshness";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";

const MESSAGES = { en, ja, ko } as const;

const SYNC_AT = new Date("2026-11-14T10:02:11Z");

function indicator(locale: keyof typeof MESSAGES, freshness: Freshness) {
  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <LiveSyncIndicator freshness={freshness} />
    </NextIntlClientProvider>
  );
}

describe("<LiveSyncIndicator>", () => {
  const cases = [
    { locale: "ja", delayed: "更新が遅れています" },
    { locale: "ko", delayed: "업데이트 지연 중" },
    { locale: "en", delayed: "Updates delayed" },
  ] as const;

  for (const { locale, delayed } of cases) {
    it(`[${locale}] shows the warning only while updates are delayed`, () => {
      const view = render(indicator(locale, { lastSyncAt: null, state: "delayed" }));
      expect(screen.getByRole("status").textContent).toBe(delayed);
      for (const state of ["retrying", "live"] as const) {
        view.rerender(indicator(locale, { lastSyncAt: SYNC_AT, state }));
        expect(view.container).toBeEmptyDOMElement();
      }
    });
  }
});

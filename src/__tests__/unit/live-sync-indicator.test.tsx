import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { LiveSyncIndicator } from "@/components/LiveSyncIndicator";
import type { Freshness } from "@/lib/snapshotFreshness";
import en from "../../../messages/en.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";

const MESSAGES = { en, ja, ko } as const;

// Built from LOCAL components on purpose: this is a display-layer test
// (the indicator renders in the viewer's timezone), so 19:02:11 local
// must read back as 19:02:11 regardless of the CI machine's TZ.
const SYNC_AT = new Date(2026, 10, 14, 19, 2, 11);

function renderIndicator(locale: keyof typeof MESSAGES, freshness: Freshness) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <LiveSyncIndicator freshness={freshness} locale={locale} />
    </NextIntlClientProvider>,
  );
}

describe("<LiveSyncIndicator>", () => {
  const cases = [
    { locale: "ja", sync: "最終同期 19:02:11", delayed: "更新が遅れています" },
    { locale: "ko", sync: "마지막 동기화 19:02:11", delayed: "업데이트 지연 중" },
    { locale: "en", sync: "Last sync 19:02:11", delayed: "Updates delayed" },
  ] as const;

  for (const { locale, sync, delayed } of cases) {
    it(`[${locale}] live → last sync time`, () => {
      renderIndicator(locale, { lastSyncAt: SYNC_AT, state: "live" });
      expect(screen.getByText(sync)).toBeTruthy();
    });

    it(`[${locale}] retrying → still the last sync time (no warning flash)`, () => {
      renderIndicator(locale, { lastSyncAt: SYNC_AT, state: "retrying" });
      expect(screen.getByText(sync)).toBeTruthy();
      expect(screen.queryByText(delayed)).toBeNull();
    });

    it(`[${locale}] delayed → replaces the sync time with the delayed notice`, () => {
      renderIndicator(locale, { lastSyncAt: SYNC_AT, state: "delayed" });
      expect(screen.getByRole("status").textContent).toBe(delayed);
      expect(screen.queryByText(sync)).toBeNull();
    });
  }

  it("renders nothing before the first successful sync", () => {
    const { container } = renderIndicator("ja", {
      lastSyncAt: null,
      state: "live",
    });
    expect(container.textContent).toBe("");
  });

  it("shows delayed even before any sync has succeeded", () => {
    renderIndicator("ja", { lastSyncAt: null, state: "delayed" });
    expect(screen.getByRole("status").textContent).toBe("更新が遅れています");
  });
});

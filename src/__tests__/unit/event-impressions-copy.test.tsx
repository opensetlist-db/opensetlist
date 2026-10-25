import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { EventImpressions } from "@/components/EventImpressions";
import type { Impression } from "@/lib/types/impression";
import type { ResolvedEventStatus } from "@/lib/eventStatus";
import ko from "../../../messages/ko.json";
import ja from "../../../messages/ja.json";
import en from "../../../messages/en.json";

vi.mock("@/hooks/useImpressionPolling", () => ({ useImpressionPolling: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/anonId", () => ({ getAnonId: () => "test-anon" }));

const START = "2026-11-14T07:30:00.000Z";
const catalogs = { ko, ja, en };
type Locale = keyof typeof catalogs;

function row(id: string, createdAt: string): Impression {
  return { id, rootImpressionId: id, eventId: "1", content: id, locale: "ko", createdAt };
}

function view({
  locale = "ko",
  status = "upcoming",
  startTime = START,
  rows = [],
  cursor = null,
  total = rows.length,
}: {
  locale?: Locale;
  status?: ResolvedEventStatus;
  startTime?: string | null;
  rows?: Impression[];
  cursor?: string | null;
  total?: number;
} = {}) {
  return (
    <NextIntlClientProvider locale={locale} messages={catalogs[locale]} timeZone="UTC">
      <EventImpressions
        eventId="1"
        status={status}
        startTime={startTime}
        initialImpressions={rows}
        initialNextCursor={cursor}
        initialTotalCount={total}
      />
    </NextIntlClientProvider>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("event impressions copy", () => {
  it.each(["ko", "ja", "en"] as const)("uses actual %s catalog copy and updates an open draft on every status change", (locale) => {
    const normal = catalogs[locale].Impression;
    const pre = normal.preShow;
    const { rerender } = render(view({ locale }));
    expect(screen.getByRole("heading", { name: pre.title })).toBeTruthy();
    expect(screen.getByPlaceholderText(pre.placeholder)).toBeTruthy();
    expect(screen.getByText(pre.empty)).toBeTruthy();
    expect(screen.getByRole("button", { name: pre.submit })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: pre.myLabel }), { target: { value: "draft survives" } });

    for (const status of ["ongoing", "completed", "cancelled"] as const) {
      rerender(view({ locale, status }));
      expect(screen.getByRole("heading", { name: normal.title })).toBeTruthy();
      expect(screen.getByRole("textbox", { name: normal.myLabel })).toHaveValue("draft survives");
      expect(screen.getByPlaceholderText(normal.placeholder)).toBeTruthy();
      expect(screen.getByText(normal.empty)).toBeTruthy();
      expect(screen.getByRole("button", { name: normal.submit })).toBeTruthy();
      expect(screen.queryByText(pre.empty)).toBeNull();
      expect(screen.queryByRole("heading", { name: pre.title })).toBeNull();
    }
    rerender(view({ locale }));
    expect(screen.getByRole("heading", { name: pre.title })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: pre.myLabel })).toHaveValue("draft survives");
    expect(screen.queryByText(normal.empty)).toBeNull();
  });

  it.each(["ko", "ja", "en"] as const)("localizes the populated list, pagination and badge in %s", (locale) => {
    const messages = catalogs[locale].Impression;
    const rows = [row("before", "2026-11-14T07:29:59.999Z")];
    const { rerender } = render(view({ locale, rows, cursor: "older", total: 2 }));
    expect(screen.getByRole("list", { name: messages.preShow.allLabel })).toBeTruthy();
    const preMore = messages.preShow.loadMore.replace("{remaining}", "1");
    expect(screen.getByRole("button", { name: preMore })).toBeTruthy();
    const count = locale === "ko" ? "2개의 기대 한마디" : locale === "ja" ? "2件の期待のひとこと" : "2 messages";
    expect(screen.getByText(count)).toBeTruthy();
    rerender(view({ locale, status: "completed", rows, cursor: "older", total: 2 }));
    expect(screen.getByRole("list", { name: messages.allLabel })).toBeTruthy();
    expect(screen.getByText(messages.preShowBadge)).toBeTruthy();
    expect(screen.queryByRole("button", { name: preMore })).toBeNull();
    expect(screen.getByRole("button", { name: messages.loadMore.replace("{remaining}", "1") })).toBeTruthy();
  });

  it.each(["ongoing", "completed"] as const)("%s: badges only strictly earlier instants, including UTC offsets", (status) => {
    const rows = [
      row("before", "2026-11-14T07:29:59.999Z"),
      row("equal", START),
      row("after", "2026-11-14T07:30:00.001Z"),
      row("offset-equal", "2026-11-14T16:30:00+09:00"),
      row("offset-before", "2026-11-14T16:29:59+09:00"),
    ];
    render(view({ status, rows }));
    const items = within(screen.getByRole("list", { name: ko.Impression.allLabel })).getAllByRole("listitem");
    expect(within(items[0]).getByText("공연 전")).toBeTruthy();
    expect(within(items[4]).getByText("공연 전")).toBeTruthy();
    for (const index of [1, 2, 3]) expect(within(items[index]).queryByText("공연 전")).toBeNull();
  });

  it("removes a previously visible badge for missing/invalid starts and before an event or after cancellation", () => {
    const rows = [row("before", "2026-11-14T07:29:59.999Z")];
    const { rerender } = render(view({ status: "completed", rows }));
    expect(screen.getByText("공연 전")).toBeTruthy();
    for (const startTime of [null, "invalid"]) {
      rerender(view({ status: "completed", rows, startTime }));
      expect(screen.getByText("before")).toBeTruthy();
      expect(screen.queryByText("공연 전")).toBeNull();
    }
    rerender(view({ status: "ongoing", rows }));
    expect(screen.getByText("공연 전")).toBeTruthy();
    for (const status of ["upcoming", "cancelled"] as const) {
      rerender(view({ status, rows }));
      expect(screen.getByText("before")).toBeTruthy();
      expect(screen.queryByText("공연 전")).toBeNull();
    }
  });

  it("an edit after the start replaces the displayed revision and removes its pre-event badge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-11-14T08:00:00.000Z");
    const before = row("original", "2026-11-14T07:29:59.999Z");
    localStorage.setItem("impression-1", JSON.stringify({ chainId: before.rootImpressionId, content: before.content, createdAt: before.createdAt }));
    const revised = { ...before, id: "revised", content: "updated", createdAt: new Date().toISOString() };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ impression: revised }) });
    vi.stubGlobal("fetch", fetchMock);
    render(view({ status: "completed", rows: [before] }));
    expect(screen.getByText("공연 전")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ko.Impression.edit }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: revised.content } });
    fireEvent.click(screen.getByRole("button", { name: ko.Impression.submit }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/impressions/original", expect.objectContaining({ method: "PUT" })));
    const list = screen.getByRole("list", { name: ko.Impression.allLabel });
    await waitFor(() => expect(within(list).getByText("updated")).toBeTruthy());
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("공연 전")).toBeNull();
    expect(screen.queryByText("original")).toBeNull();
  });
});

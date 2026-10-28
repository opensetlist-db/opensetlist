// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eventShareHtml } from "@/lib/eventOg/shareHtml";
import { lookupPublication } from "@/lib/eventOg/reader";
import { captureException } from "@sentry/nextjs";
import { GET } from "@/app/[locale]/share/events/[eventId]/[mode]/[revision]/route";

vi.mock("@/lib/eventOg/reader", () => ({ lookupPublication: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: vi.fn().mockResolvedValue((key: string) => key) }));

const card = {
  publicationId: "c04960d6-7c5a-4ec4-a145-c956d84b31f7", eventId: "7", mode: "prediction", locale: "ja", slug: "event-seven",
  shareUrl: "https://preview.test/ja/share/events/7/prediction/c04960d6-7c5a-4ec4-a145-c956d84b31f7",
  content: { title: "Full official title | セットリスト予想 | OpenSetlist", description: "会場 · 2026年7月11日",
    alt: "Approved title · セットリスト予想", officialEventTitle: "Full official title", officialSeriesTitle: "Official series",
    localizedEventTitle: "公演", localizedSeriesTitle: "シリーズ", displayTitle: "Approved title", performance: "Day.1", context: "", date: "2026年7月11日", venue: "会場", purposeLabel: "セットリスト予想" },
  image: { url: "https://images.test/dev/event-cards/7/prediction/revision/ja.png", width: 1200, height: 630, mimeType: "image/png", sha256: "1".repeat(64) },
  correction: null,
};
const copy = { heading: "共有カード", opening: "移動します", open: "イベントを開く",
  correctionHeading: "訂正", correctionBody: "元のカードを記録", openCorrection: "最新のカード", correctionUnavailable: "現在利用できません" };

describe("published event-card transport", () => {
  it("rejects incorrectly encoded or NUL-containing private reason files through real CLI processes before DB access", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "og-reason-"));
    const file = path.join(folder, "reason.txt");
    const args = ["correct", "--event", "7", "--mode", "prediction", "--revision", card.publicationId, "--replacement", card.publicationId,
      "--expected-version", "0", "--operation", card.publicationId, "--reason-file", file];
    const run = () => spawnSync(process.execPath, ["scripts/event-og.mjs", ...args], { cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DATABASE_URL: "postgresql://invalid:invalid@localhost/not-dev", DATABASE_URL_UNPOOLED: "postgresql://invalid:invalid@localhost/not-dev" } });
    try {
      writeFileSync(file, "valid private reason", "utf8");
      const allowed = run(); expect(allowed.status).toBe(1); expect(allowed.stderr).toContain("dev 데이터베이스만 허용");
      for (const bytes of [Buffer.from([0xff, 0xfe, 0x61, 0]), Buffer.from([0xc3, 0x28]), Buffer.from("reason\u0000text")]) {
        writeFileSync(file, bytes); const rejected = run(); expect(rejected.status).toBe(1);
        expect(rejected.stderr).toMatch(/유효한 UTF-8|NUL 문자/);
      }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });

  it("keeps frozen metadata on a readable corrected page and omits auto-navigation while offering the explicit latest link", () => {
    const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
    const normal = parse(eventShareHtml(card, "/ja/events/7/current-slug", copy));
    expect(normal.querySelector("script[src='/event-share-navigation.js']")).toBeTruthy();
    expect(normal.querySelector("[data-event-destination]")).toBeTruthy();
    expect(normal.body.textContent).toContain(copy.opening);
    const latest = "https://preview.test/ja/share/events/7/prediction/778f4eec-1d33-401f-8ee7-bbcc159a279b";
    const corrected = parse(eventShareHtml({ ...card, correction: { replacementUrl: latest } }, "/ja/events/7/current-slug", copy));
    expect(corrected.querySelector("meta[property='og:image']")?.getAttribute("content")).toBe(card.image.url);
    expect(corrected.querySelector("meta[property='og:title']")?.getAttribute("content")).toBe(card.content.title);
    expect(corrected.querySelector("[data-testid='event-share-correction-link']")?.getAttribute("href")).toBe(latest);
    expect(corrected.querySelector("h2")?.textContent).toBe(copy.correctionHeading);
    expect(corrected.querySelector("script[src='/event-share-navigation.js']")).toBeNull();
    expect(corrected.querySelector("[data-event-destination]")).toBeNull();
    expect(corrected.body.textContent).not.toContain(copy.opening);
    const unavailable = parse(eventShareHtml({ ...card, correction: { replacementUrl: null } }, "/ja/events/7/current-slug", copy));
    expect(unavailable.body.textContent).toContain(copy.correctionUnavailable);
    expect(unavailable.querySelector("[data-testid='event-share-correction-link']")).toBeNull();
    expect(unavailable.querySelector("[data-testid='event-share-destination']")?.getAttribute("href")).toBe("/ja/events/7/current-slug");
  });

  it("logs handled share failures locally and to Sentry while keeping no-store503 and same-URL recovery", async () => {
    const context = { params: Promise.resolve({ locale: card.locale, eventId: card.eventId, mode: card.mode, revision: card.publicationId }) };
    const request = new Request(card.shareUrl);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      vi.mocked(lookupPublication).mockResolvedValue(card);
      const normal = await GET(request, context);
      expect(normal.status).toBe(200);
      expect(await normal.text()).toContain(card.content.officialEventTitle);
      const error = new Error("synthetic publication lookup failure");
      vi.mocked(lookupPublication).mockRejectedValueOnce(error);
      const failed = await GET(request, context);
      expect(log).toHaveBeenCalledWith("[share/events] publication render failed", error);
      expect(captureException).toHaveBeenCalledWith(error);
      expect(failed.status).toBe(503);
      expect(failed.headers.get("cache-control")).toContain("no-store");
      expect(failed.headers.get("retry-after")).toBe("5");
      expect(await failed.text()).toBe("");
      const recovered = await GET(request, context);
      expect(recovered.status).toBe(200);
      expect(await recovered.text()).toContain(card.content.officialEventTitle);
    } finally { log.mockRestore(); vi.clearAllMocks(); }
  });

  it("returns complete frozen social metadata in head, full official names and an accessible JS-free destination", () => {
    const html = eventShareHtml(card, "/ja/events/7/current-slug", copy);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.documentElement.lang).toBe("ja");
    expect(doc.head.querySelector('meta[property="og:title"]')?.getAttribute("content")).toBe(card.content.title);
    expect(doc.head.querySelector('meta[property="og:image"]')?.getAttribute("content")).toBe(card.image.url);
    expect(doc.head.querySelector('meta[property="og:image:width"]')?.getAttribute("content")).toBe("1200");
    expect(doc.head.querySelector('meta[property="og:image:height"]')?.getAttribute("content")).toBe("630");
    expect(doc.head.querySelector('meta[name="twitter:card"]')?.getAttribute("content")).toBe("summary_large_image");
    expect(doc.head.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex, follow");
    const canonical = doc.head.querySelector('link[rel="canonical"]')?.getAttribute("href");
    expect(canonical).toBe(card.shareUrl);
    expect(doc.head.querySelector('meta[property="og:url"]')?.getAttribute("content")).toBe(canonical);
    expect(doc.querySelector("h1")?.textContent).toBe(card.content.officialEventTitle);
    expect(doc.body.textContent).toContain(card.content.officialSeriesTitle);
    expect(doc.querySelector("a[data-event-destination]")?.getAttribute("href")).toBe("/ja/events/7/current-slug");
    expect(doc.querySelector("a[data-event-destination]")?.textContent).toBe(copy.open);
    expect(doc.querySelector("script")?.getAttribute("src")).toBe("/event-share-navigation.js");
  });

  it("escapes stored names in HTML and metadata contexts instead of executing event content", () => {
    const name = '</title><script id="injected">alert(1)</script><h1>untrusted';
    const html = eventShareHtml({ ...card, content: { ...card.content, title: name, officialEventTitle: name } }, "/ja/events/7/current-slug", copy);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.head.querySelector("title")?.textContent).toBe(name);
    expect(doc.querySelector("h1")?.textContent).toBe(name);
    // Positive control: the trusted static navigation script is present.
    expect(doc.querySelector("script[src='/event-share-navigation.js']")).toBeTruthy();
    expect(doc.querySelector("script#injected")).toBeNull();
  });

  it("rejects incomplete publication arguments and non-dev connections through actual CLI processes", () => {
    const run = (args: string[]) => spawnSync(process.execPath, ["scripts/event-og.mjs", ...args], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DATABASE_URL: "postgresql://invalid:invalid@localhost/not-dev", DATABASE_URL_UNPOOLED: "postgresql://invalid:invalid@localhost/not-dev" },
    });
    const incomplete = run(["publish", "--event", "7"]);
    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain("명시적 mode/revision/manifest/approval");
    const guarded = run(["list", "--event", "7"]);
    expect(guarded.status).toBe(1);
    expect(guarded.stderr).toContain("dev 데이터베이스만 허용");
    const correctionArgs = (version: string) => ["correct", "--event", "7", "--mode", "prediction", "--revision", card.publicationId,
      "--replacement", "778f4eec-1d33-401f-8ee7-bbcc159a279b", "--expected-version", version,
      "--operation", "6327fdfd-e378-47be-a7b1-8d43389d876b", "--reason-file", "unused-reason.txt"];
    const validVersion = run(correctionArgs("0"));
    expect(validVersion.status).toBe(1);
    expect(validVersion.stderr).toContain("unused-reason.txt");
    const correction = run(correctionArgs("-1"));
    expect(correction.status).toBe(1);
    expect(correction.stderr).toContain("정정에는 명시적");
  });

  it("refuses a production bucket or missing/production share origin before reading a packet or connecting", () => {
    const dev = "postgresql://invalid:invalid@db.nddawybyuedsrshhxikx.supabase.co/postgres";
    const args = ["publish", "--event", "7", "--mode", "prediction", "--revision", card.publicationId, "--manifest", "missing-manifest.json", "--approval", "missing-approval.json"];
    const run = (override: Record<string, string>) => spawnSync(process.execPath, ["scripts/event-og.mjs", ...args], {
      cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
      env: { ...process.env, DATABASE_URL: dev, DATABASE_URL_UNPOOLED: dev,
        R2_ACCOUNT_ID: "0".repeat(32), R2_ACCESS_KEY_ID: "synthetic-key", R2_SECRET_ACCESS_KEY: "synthetic-secret",
        R2_PUBLIC_BASE_URL: "https://images.test.invalid", R2_BUCKET: "opensetlist-images-dev", R2_KEY_PREFIX: "test", NEXT_PUBLIC_BASE_URL: "https://preview.test.invalid", ...override },
    });
    // Positive control: safe settings get as far as reading the absent packet.
    const allowed = run({}); expect(allowed.status).toBe(1); expect(allowed.stderr).toContain("missing-manifest.json");
    for (const [override, message] of [
      [{ R2_BUCKET: "opensetlist-images" }, "dev bucket"],
      [{ NEXT_PUBLIC_BASE_URL: "" }, "공개 origin을 명시"],
      [{ NEXT_PUBLIC_BASE_URL: "https://opensetlist.com" }, "운영 origin"],
    ] as const) {
      const rejected = run(override); expect(rejected.status).toBe(1); expect(rejected.stderr).toContain(message);
    }
  });
});

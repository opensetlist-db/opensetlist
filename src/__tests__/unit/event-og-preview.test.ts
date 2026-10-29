// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import sharp from "sharp";
import { preparePreview, readPreview } from "@/lib/eventOg/service";
import { cardContent, type CardEvent } from "@/lib/eventOg/content";
import { loadCardResources, renderCard, sha256, TEMPLATE } from "@/lib/eventOg/render";

const root = process.cwd();
const event: CardEvent = {
  id: "999", slug: "preview-fixture", originalName: "Bloom Garden Party Stage／埼玉公演 Day.1", originalLanguage: "ja",
  date: "2026-07-11", originalVenue: "京王アリーナTOKYO（旧：武蔵野の森総合スポーツプラザ）・メインアリーナ",
  translations: [{ locale: "ko", name: "Bloom Garden Party Stage／사이타마 Day.1", venue: "사이타마 공연장" }],
  eventSeries: { originalName: "ラブライブ！蓮ノ空女学院スクールアイドルクラブ 6th Live Dream ～Bloom Garden Party～", originalLanguage: "ja", translations: [] },
  artist: null,
};
let folder: string;
let packet: Awaited<ReturnType<typeof preparePreview>>;
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "event-og-"));
  packet = await preparePreview({ root, events: [event], output: path.join(folder, "packet") });
}, 120_000);
afterAll(async () => { if (folder) await rm(folder, { recursive: true, force: true }); });

describe("local event-card preview service", () => {
  it("renders all purposes/locales, full titles, measured layouts and verifiable PNGs without a publication", async () => {
    expect(packet.renditions).toHaveLength(9);
    expect(packet.kind).toBe("local-event-card-preview");
    expect(packet.approval.status).toBe("pending-owner-visual-review");
    expect(packet).not.toHaveProperty("publicationId");
    expect(packet).not.toHaveProperty("shareUrls");
    expect(packet.fonts).toHaveLength(12);
    expect(packet.fonts.every((f) => /^[a-f0-9]{64}$/.test(f.sha256))).toBe(true);
    for (const rendition of packet.renditions) {
      expect(rendition.content.officialEventTitle).toBe(event.originalName);
      expect(rendition.content.officialSeriesTitle).toBe(event.eventSeries!.originalName);
      expect(rendition.content.title).toBe(event.eventSeries!.originalName);
      expect(rendition.content.displayTitle).toBeNull();
      expect(rendition.layout.title.fontSize).toBeGreaterThanOrEqual(TEMPLATE.title.min);
      expect(rendition.layout.title.lines).toBeLessThanOrEqual(4);
      const bytes = await readFile(path.join(folder, "packet", rendition.file));
      const metadata = await sharp(bytes).metadata();
      expect([metadata.format, metadata.width, metadata.height]).toEqual(["png", 1200, 630]);
    }
    expect(packet.files.filter((f) => f.role === "mobile").every((f) => f.width === 360 && f.height === 189)).toBe(true);
    const representative = await readFile(path.join(folder, "packet", "999-ja-prediction.png"));
    const stats = await sharp(representative).stats();
    expect(stats.entropy).toBeGreaterThan(1); // A blank fallback is not a card.
    expect(stats.channels[0].mean).toBeGreaterThan(210); // Common light background.
    expect((await readPreview(path.join(folder, "packet/manifest.json"))).manifest.previewId).toBe(packet.previewId);
    const output = packet.files.find((f) => f.file === "999-ja-prediction.png")!;
    expect(sha256(representative)).toBe(output.sha256);
  });

  it("reuses strict name/venue fallback, omits missing data and keeps venue calendar dates across zones", () => {
    const ko = cardContent(event, "ko");
    expect(ko.performance).toContain("사이타마");
    expect(ko.venue).toBe("사이타마 공연장");
    expect(cardContent(event, "en").performance).toBe(event.originalName);
    expect(cardContent(event, "en").venue).toBe(event.originalVenue);
    const previous = process.env.TZ;
    try {
      for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
        process.env.TZ = zone;
        expect(cardContent(event, "en").date).toBe("July 11, 2026");
      }
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
    const absent = cardContent({ ...event, date: null, originalVenue: null, translations: [], eventSeries: null }, "ja");
    expect(absent.date).toBe("");
    expect(absent.venue).toBe("");
    expect(absent.performance).toBe("");
    expect(absent.title).toBe(event.originalName);
    const artist = { originalName: "Bloom", originalLanguage: "en", translations: [] };
    const distinct = { ...event, artist, originalName: "Saitama Day.1", translations: [],
      eventSeries: { ...event.eventSeries!, originalName: "Garden Party" } };
    expect(cardContent(distinct, "en").context).toBe("Bloom");
    expect(cardContent({ ...distinct, originalName: "Bloom Saitama Day.1" }, "en").context).toBe("");
  });

  it("fails missing fonts, unsupported glyphs, title/venue overflow and undersized text instead of returning a degraded card", async () => {
    const resources = await loadCardResources(root);
    const content = cardContent(event, "ja");
    await expect(renderCard(content, "live", "セットリスト速報", resources)).resolves.toHaveProperty("png");
    const contextual = await renderCard({ ...content, title: "蓮".repeat(30), context: "Artist context" }, "live", "セットリスト速報", resources);
    expect(contextual.layout.title.height).toBeLessThanOrEqual(203);
    expect(contextual.layout.title.fontSize).toBeGreaterThanOrEqual(40);
    await expect(renderCard({ ...content, title: "𓀀" }, "live", "セットリスト速報", resources)).rejects.toThrow(/グリフ|글리프/);
    await expect(renderCard({ ...content, title: "蓮".repeat(300) }, "live", "セットリスト速報", resources)).rejects.toThrow(/읽기 가능한 배치 실패/);
    await expect(renderCard({ ...content, venue: "会場".repeat(80) }, "live", "セットリスト速報", resources)).rejects.toThrow(/읽기 가능한 배치 실패/);
    const failedOutput = path.join(folder, "no-font-output");
    // Same-test positive control: a working root creates a readable packet.
    await expect(access(path.join(folder, "packet/manifest.json"))).resolves.toBeUndefined();
    await mkdir(path.join(folder, "public"));
    await expect(preparePreview({ root: folder, events: [event], output: failedOutput })).rejects.toThrow(/ENOENT/);
    await expect(access(failedOutput)).rejects.toThrow();
    await expect(preparePreview({ root, events: [event], output: path.join(root, "public/preview-test") })).rejects.toThrow(/public/);
  }, 120_000);

  it("requires full-title failure and content-bound review evidence for a display title", async () => {
    const reviewFile = path.join(folder, "owner-review.txt");
    const evidence = "Fixture operator approves display title: テストライブ (test evidence only)";
    await writeFile(reviewFile, evidence);
    const review = { eventId: event.id, locale: "ja" as const, title: "テストライブ", reviewFile, reviewSha256: sha256(evidence) };
    await expect(preparePreview({ root, events: [event], output: path.join(folder, "unnecessary"), displayTitles: [review] })).rejects.toThrow(/公式|공식 전체 제목/);
    await expect(preparePreview({ root, events: [event], output: path.join(folder, "bad-evidence"), displayTitles: [{ ...review, reviewSha256: "0".repeat(64) }] })).rejects.toThrow(/증거 해시/);
    await expect(preparePreview({ root, events: [{ ...event, eventSeries: { ...event.eventSeries!, originalName: "Live\nTitle" } }],
      output: path.join(folder, "invalid-title"), displayTitles: [review] })).rejects.toThrow(/제어 문자/);
    const oversized = { ...event, eventSeries: { ...event.eventSeries!, originalName: "蓮".repeat(250) } };
    await expect(preparePreview({ root, events: [oversized], output: path.join(folder, "needs-title-review") }))
      .rejects.toMatchObject({ field: "title", message: expect.stringContaining("운영자 검토 증거") });
    // The same overflowing text in another field must not request title approval.
    const venueTitle = { ...event, originalName: "会場".repeat(30), originalVenue: "会場".repeat(30), translations: [], eventSeries: null };
    await expect(preparePreview({ root, events: [venueTitle], output: path.join(folder, "venue-failure") }))
      .rejects.toMatchObject({ field: "venue", message: expect.not.stringContaining("운영자 검토 증거") });
    const result = await preparePreview({ root, events: [oversized], output: path.join(folder, "display-title"), displayTitles: [review,
      { ...review, locale: "ko" }, { ...review, locale: "en" }] });
    expect(result.renditions[0].content.title).toBe("テストライブ");
    expect(result.renditions[0].content.officialSeriesTitle).toBe(oversized.eventSeries.originalName);
    expect(result.renditions[0].officialLayoutFailure).toContain("40px");
  }, 120_000);

  it("detects changed manifest and output bytes", async () => {
    const file = path.join(folder, "packet/manifest.json");
    const original = await readFile(file, "utf8");
    try {
      await writeFile(file, original.replace("July 11, 2026", "July 12, 2026"));
      await expect(readPreview(file)).rejects.toThrow(/manifest/);
    } finally { await writeFile(file, original); }
    const image = path.join(folder, "packet/999-en-live.png");
    const originalImage = await readFile(image);
    try {
      await writeFile(image, "not a png");
      await expect(readPreview(file)).rejects.toThrow(/출력 해시/);
    } finally { await writeFile(image, originalImage); }
  });

  it("checks malformed arguments, a failed packet, and exact successful replay through real CLI processes", async () => {
    const run = (args: string[]) => spawnSync(process.execPath, ["scripts/event-og.mjs", ...args], { cwd: root, encoding: "utf8", timeout: 120_000 });
    const malformed = run(["preview", "--events", "1;delete", "--out", path.join(folder, "bad")]);
    expect(malformed.status).toBe(1);
    expect(malformed.stdout).not.toContain("previewId");
    const invalid = path.join(folder, "invalid.json");
    await writeFile(invalid, "{}");
    const failed = run(["replay", "--manifest", invalid, "--out", path.join(folder, "failed")]);
    expect(failed.status).toBe(1);
    expect(failed.stdout).not.toContain("previewId");
    const { previewId: _id, ...overflowPayload } = packet;
    expect(_id).toMatch(/^[a-f0-9]{64}$/);
    overflowPayload.sourceEvents = [{ ...event, eventSeries: { ...event.eventSeries!, originalName: "蓮".repeat(300) } }];
    const overflowManifest = path.join(folder, "packet/overflow.json");
    await writeFile(overflowManifest, JSON.stringify({ ...overflowPayload, previewId: sha256(JSON.stringify(overflowPayload)) }));
    const overflow = run(["replay", "--manifest", overflowManifest, "--out", path.join(folder, "overflow")]);
    expect(overflow.status).toBe(1);
    expect(overflow.stderr).toContain("읽기 가능한 배치 실패");
    expect(overflow.stdout).not.toContain("previewId");
    const success = run(["replay", "--manifest", path.join(folder, "packet/manifest.json"), "--out", path.join(folder, "replayed")]);
    expect(success.error).toBeUndefined();
    expect(success.status, success.stderr).toBe(0);
    const report = JSON.parse(success.stdout);
    expect(report.previewId).toBe(packet.previewId);
    expect(report.originals).toBe(9);
    expect(report.publication).toBe("none");
  }, 120_000);
});

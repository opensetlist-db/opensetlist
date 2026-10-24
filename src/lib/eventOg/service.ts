import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_LOCALES, CARD_MODES, cardContent, type CardEvent, type CardLocale } from "./content";
import { CardLayoutError, loadCardResources, renderCard, sha256, TEMPLATE } from "./render";

export type DisplayTitleReview = {
  eventId: string;
  locale: CardLocale;
  title: string;
  reviewFile: string;
  reviewSha256: string;
};

type PreviewOptions = {
  root: string;
  events: CardEvent[];
  output: string;
  legacy?: Record<string, Buffer>;
  displayTitles?: DisplayTitleReview[];
  expectedPreviewId?: string;
};

/** The only application operation implemented here is local preview preparation.
 * Its inputs expose no DB writer or object-storage capability. Publication will
 * consume a reviewed manifest through this boundary in a later operation. */
export async function preparePreview({ root, events, output, legacy, displayTitles = [], expectedPreviewId }: PreviewOptions) {
  if (!events.length || new Set(events.map((e) => e.id)).size !== events.length) throw new Error("중복 없는 공연을 선택하세요.");
  output = path.resolve(output);
  const parent = await realpath(path.dirname(output));
  const publicRoot = await realpath(path.join(root, "public"));
  const relative = path.relative(publicRoot, path.join(parent, path.basename(output)));
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("public 경로에는 미리보기를 출력할 수 없습니다.");
  const resources = await loadCardResources(root);
  const reviewKeys = new Set<string>();
  for (const review of displayTitles) {
    const key = `${review.eventId}-${review.locale}`;
    if (!events.some((e) => e.id === review.eventId) || !CARD_LOCALES.includes(review.locale) || reviewKeys.has(key)
      || typeof review.title !== "string" || !review.title.trim() || typeof review.reviewFile !== "string"
      || !/^[a-f0-9]{64}$/.test(review.reviewSha256)) throw new Error("잘못된 공유 카드 표시명 검토 입력입니다.");
    if (sha256(await readFile(review.reviewFile)) !== review.reviewSha256) throw new Error("표시명 검토 증거 해시가 다릅니다.");
    reviewKeys.add(key);
  }
  const sources = await Promise.all(["content.ts", "render.ts", "service.ts"].map(async (file) => ({
    file, sha256: sha256(await readFile(path.join(root, "src/lib/eventOg", file))),
  })));
  const files: { file: string; sha256: string; width: number; height: number; bytes: number; role: string }[] = [];
  const pending = new Map<string, Buffer>();
  async function add(file: string, bytes: Buffer, role: string) {
    const meta = await sharp(bytes).metadata();
    if (meta.format !== "png" || !meta.width || !meta.height) throw new Error(`PNG 검증 실패: ${file}`);
    pending.set(file, bytes);
    files.push({ file, sha256: sha256(bytes), width: meta.width, height: meta.height, bytes: bytes.length, role });
  }
  const renditions = [];
  for (const event of events) {
    if (!/^[1-9]\d*$/.test(event.id)) throw new Error("잘못된 공연 ID입니다.");
    for (const locale of CARD_LOCALES) {
      const messages = JSON.parse(await readFile(path.join(root, "messages", `${locale}.json`), "utf8"));
      const content = cardContent(event, locale);
      const review = displayTitles.find((r) => r.eventId === event.id && r.locale === locale);
      const thumbnails: Buffer[] = [];
      for (const mode of CARD_MODES) {
        const label: string = messages.EventShareCard[mode];
        if (!label) throw new Error(`목적 라벨 누락: ${locale}/${mode}`);
        let result;
        let officialLayoutFailure: string | null = null;
        try {
          result = await renderCard(content, mode, label, resources);
        } catch (error) {
          // Only the title's measured layout failure permits an override.
          // Missing glyphs/fonts or overflowing factual fields still fail.
          if (!(error instanceof CardLayoutError) || !error.message.endsWith(`: ${content.title}`)) throw error;
          officialLayoutFailure = error.message;
          if (!review) throw new CardLayoutError(`${error.message}\n공유 카드 표시명과 운영자 검토 증거가 필요합니다.`);
          result = await renderCard({ ...content, title: review.title }, mode, label, resources);
        }
        if (review && !officialLayoutFailure) throw new Error("공식 전체 제목이 읽기 기준에 맞으므로 표시명을 사용할 수 없습니다.");
        const { png, layout } = result;
        const prefix = `${event.id}-${locale}-${mode}`;
        await add(`${prefix}.png`, png, "original");
        await add(`${prefix}-600.png`, await sharp(png).resize(600, 315).png().toBuffer(), "half");
        const mobile = await sharp(png).resize(360, 189).png().toBuffer();
        await add(`${prefix}-mobile.png`, mobile, "mobile");
        thumbnails.push(mobile);
        renditions.push({ eventId: event.id, locale, mode, content: { ...content, title: review?.title ?? content.title, purposeLabel: label, displayTitle: review ?? null }, officialLayoutFailure, layout, file: `${prefix}.png` });
      }
      await add(`${event.id}-${locale}-modes.png`, await sharp({ create: { width: 1080, height: 189, channels: 4, background: "white" } })
        .composite(thumbnails.map((input, i) => ({ input, left: i * 360, top: 0 }))).png().toBuffer(), "mode-comparison");
      const old = legacy?.[`${event.id}-${locale}`];
      if (old) {
        const meta = await sharp(old).metadata();
        if (meta.width !== 1200 || meta.height !== 630) throw new Error("기존 OG 크기가 잘못됐습니다.");
        await add(`${event.id}-${locale}-legacy.png`, old, "legacy");
        const oldHalf = await sharp(old).resize(600, 315).png().toBuffer();
        const newHalf = pending.get(`${event.id}-${locale}-prediction-600.png`)!;
        await add(`${event.id}-${locale}-old-new.png`, await sharp({ create: { width: 1200, height: 315, channels: 4, background: "white" } })
          .composite([{ input: oldHalf, left: 0, top: 0 }, { input: newHalf, left: 600, top: 0 }]).png().toBuffer(), "legacy-comparison");
      }
    }
  }
  const versions = await Promise.all(["@vercel/og", "satori", "sharp"].map(async (name) =>
    JSON.parse(await readFile(path.join(root, "node_modules", name, "package.json"), "utf8")).version as string));
  const payload = {
    schemaVersion: 1,
    kind: "local-event-card-preview",
    template: { ...TEMPLATE, sources, logoSha256: resources.logoHash },
    renderer: { og: versions[0], satori: versions[1], sharp: versions[2], node: process.version, lockSha256: sha256(await readFile(path.join(root, "package-lock.json"))) },
    fonts: resources.fontIdentity,
    sourceEvents: events,
    sourceSha256: sha256(JSON.stringify(events)),
    legacyComparison: Object.keys(legacy ?? {}).length ? { route: "/api/og/event/{id}?lang={locale}&s=completed", status: "pinned-completed" } : null,
    renditions, files,
    approval: { status: "pending-owner-visual-review" },
  };
  const manifest = { ...payload, previewId: sha256(JSON.stringify(payload)) };
  if (expectedPreviewId && manifest.previewId !== expectedPreviewId) throw new Error("재현 결과가 원본 미리보기와 다릅니다. 입력·템플릿·폰트·실행 환경을 확인하세요.");
  // Complete every render before creating the output directory. Exclusive
  // creation preserves earlier review packets and makes failed runs unambiguous.
  await mkdir(output, { recursive: false });
  for (const [file, bytes] of pending) await writeFile(path.join(output, file), bytes, { flag: "wx" });
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  const sections = events.map((event) => h("section", { key: event.id },
    h("h2", null, `${event.id} · ${event.originalName}`),
    ...CARD_LOCALES.map((locale) => h("div", { key: locale },
      h("h3", null, `${locale} · prediction / live / setlist`),
      h("img", { width: 1080, height: 189, src: `${event.id}-${locale}-modes.png`, alt: "모드 비교" }),
      legacy?.[`${event.id}-${locale}`] ? h("div", null, h("p", null, "기존 OG / 새 prediction"),
        h("img", { width: 1200, height: 315, src: `${event.id}-${locale}-old-new.png`, alt: "기존 OG와 새 카드" })) : null,
      ...CARD_MODES.map((mode) => h("details", { key: mode },
        h("summary", null, `${mode} · 원본 / 600 / 모바일`),
        ...["", "-600", "-mobile"].map((suffix) => {
          const file = `${event.id}-${locale}-${mode}${suffix}.png`;
          return h("p", { key: suffix }, h("a", { href: file }, h("img", { src: file, alt: `${locale} ${mode}${suffix}` })));
        }),
      )),
    )),
  ));
  // Let React escape database-sourced text in its actual HTML context rather
  // than maintaining a separate, incomplete HTML-sanitization convention.
  const gallery = h("html", { lang: "ko" }, h("head", null,
    h("meta", { charSet: "utf-8" }), h("meta", { name: "viewport", content: "width=device-width" }),
    h("title", null, "공연 공유 카드 검토"),
    h("style", null, "body{margin:32px;background:#f5f7fb;color:#172542;font:16px sans-serif}img{display:block;max-width:100%;height:auto}section{margin:40px 0}summary{cursor:pointer;margin:12px 0}")),
  h("body", null, h("h1", null, "공연 공유 카드 · 시각 승인 대기"),
    h("p", null, `로컬 미리보기 · 공개 발행 없음 · ${manifest.previewId}`), h("a", { href: "manifest.json" }, "Manifest"), ...sections));
  await writeFile(path.join(output, "index.html"), "<!doctype html>" + renderToStaticMarkup(gallery), { flag: "wx" });
  return manifest;
}

export async function readPreview(manifestFile: string) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Awaited<ReturnType<typeof preparePreview>>;
  const { previewId, ...payload } = manifest;
  if (manifest.kind !== "local-event-card-preview" || manifest.schemaVersion !== 1 || sha256(JSON.stringify(payload)) !== previewId) throw new Error("잘못되거나 변경된 manifest입니다.");
  const legacy: Record<string, Buffer> = {};
  for (const file of manifest.files) {
    if (!/^[1-9]\d*-(ja|ko|en)-[a-z0-9-]+\.png$/.test(file.file)) throw new Error("잘못된 출력 파일 경로입니다.");
    const bytes = await readFile(path.join(path.dirname(manifestFile), file.file));
    if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes) throw new Error(`출력 해시가 다릅니다: ${file.file}`);
    if (file.role === "legacy") legacy[file.file.replace("-legacy.png", "")] = bytes;
  }
  const displayTitles = manifest.renditions.filter((r) => r.mode === "prediction").flatMap((r) => r.content.displayTitle ? [r.content.displayTitle] : []);
  return { manifest, events: manifest.sourceEvents, legacy, displayTitles };
}

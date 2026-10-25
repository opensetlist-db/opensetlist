import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../prisma";
import { getImageStorage } from "../imageUpload/storage";
import { CARD_LOCALES, type CardMode } from "./content";
import { readCardEvents, cardSourceFacts } from "./source";

import { publicationOrigin, sharePath, INCLUDE, result, invalid, CardPublicationError, type Stored, type PublicationDeps, type FrozenCard } from "./contracts";
export type { CardDb } from "./contracts";
export { lookupPublication, listPublications } from "./reader";
const HASH = /^[a-f0-9]{64}$/;
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Operator-only, explicit mode selection. Approval is a content-bound local
 * evidence envelope, never a public boolean/API or a claim of authenticated
 * authorship. Only its digest is persisted; local paths never enter public data. */
export async function publishPreview(input: {
  root: string; manifestFile: string; approvalFile: string; eventId: string; mode: CardMode; revision: string;
}, deps: PublicationDeps = {}) {
  const { root, manifestFile, approvalFile, eventId, mode, revision } = input;
  sharePath(eventId, mode, revision, "ja");
  const origin = publicationOrigin(deps.origin);
  const storage = deps.storage ?? getImageStorage();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(storage.keyPrefix)) throw invalid("잘못된 저장소 namespace입니다.");
  const db = deps.db ?? prisma;
  // Public lookups never load a renderer/WASM or require font files.
  const { readPreview, preparePreview } = await import("./service");
  const { validateImage } = await import("../imageUpload/validate");
  const { manifest, ...preview } = await readPreview(manifestFile);
  const event = preview.events.find((e) => e.id === eventId);
  if (!event) throw invalid("미리보기에 선택한 공연이 없습니다.");
  const selected = CARD_LOCALES.map((locale) => {
    const matches = manifest.renditions.filter((r) => r.eventId === eventId && r.locale === locale && r.mode === mode);
    if (matches.length !== 1) throw invalid("선택한 모드의 3언어가 필요합니다.");
    const rendition = matches[0];
    const file = manifest.files.filter((f) => f.file === rendition.file && f.role === "original");
    if (file.length !== 1 || rendition.file !== `${eventId}-${locale}-${mode}.png` || !HASH.test(file[0].sha256)
      || file[0].width !== 1200 || file[0].height !== 630) throw invalid("원본 PNG 식별자가 다릅니다.");
    return { locale, rendition, file: file[0] };
  });
  const approvalBytes = await readFile(approvalFile);
  const approval = JSON.parse(approvalBytes.toString("utf8"));
  const outputs = Object.fromEntries(selected.map((s) => [s.locale, s.file.sha256]));
  if (approval.kind !== "owner-reviewed-event-card" || approval.previewId !== manifest.previewId || approval.eventId !== eventId
    || approval.mode !== mode || !approval.outputs || Object.keys(approval.outputs).length !== 3
    || !CARD_LOCALES.every((l) => approval.outputs[l] === outputs[l])
    || typeof approval.evidenceFile !== "string" || !HASH.test(approval.evidenceSha256 ?? "")) throw invalid("승인 증거가 공연·모드·미리보기·3언어 출력과 일치하지 않습니다.");
  if (sha256(await readFile(approval.evidenceFile)) !== approval.evidenceSha256) throw invalid("승인 증거 파일의 해시가 다릅니다.");
  const approvalSha256 = sha256(approvalBytes);
  const fingerprint = sha256(JSON.stringify({ eventId, mode, revision, origin, namespace: storage.keyPrefix,
    previewId: manifest.previewId, outputs, approvalSha256 }));
  const reconcile = (row: Stored) => {
    if (row.fingerprint !== fingerprint) throw new CardPublicationError("publication_conflict", "이미 사용한 발행 식별자의 내용이 다릅니다.");
    return result(row, origin, "reconciled");
  };
  const committed = await db.eventCardPublication.findUnique({ where: { id: revision }, include: INCLUDE });
  // Never re-PUT an already committed version: it may later be suspended.
  if (committed) return reconcile(committed);

  const assertCurrent = async (reader: Parameters<typeof readCardEvents>[0]) => {
    const current = (await readCardEvents(reader, [eventId]))[0];
    if (!current || JSON.stringify(cardSourceFacts(current)) !== JSON.stringify(cardSourceFacts(event))) {
      throw new CardPublicationError("preview_stale", "공연 정보가 바뀌었거나 삭제됐습니다. 새 미리보기를 검토하세요.");
    }
  };
  await assertCurrent(db);
  // Reproduce the entire reviewed packet using the current template/fonts and
  // original snapshot. Slug-only/current-status changes are deliberately not
  // card facts. A forged self-hash cannot substitute for actual rendering.
  const temporary = await mkdtemp(path.join(tmpdir(), "event-card-verify-"));
  try {
    await preparePreview({ root, ...preview, output: path.join(temporary, "packet"), expectedPreviewId: manifest.previewId });
  } finally { await rm(temporary, { recursive: true, force: true }); }

  const images = await Promise.all(selected.map(async (s) => {
    const bytes = await readFile(path.join(path.dirname(manifestFile), s.file.file));
    const image = await validateImage(bytes);
    if (image.format !== "png" || image.width !== 1200 || image.height !== 630 || image.sha256 !== s.file.sha256) throw invalid("검토한 PNG 바이트와 다릅니다.");
    const key = `${storage.keyPrefix}/event-cards/${eventId}/${mode}/${revision}/${s.locale}.png`;
    const publicUrl = storage.publicUrlFor(key);
    const url = new URL(publicUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw invalid("잘못된 이미지 공개 URL입니다.");
    const c = s.rendition.content;
    const content: FrozenCard = {
      title: `${c.officialEventTitle} | ${c.purposeLabel} | OpenSetlist`,
      description: [c.localizedSeriesTitle, c.localizedEventTitle, c.date, c.venue, c.purposeLabel].filter(Boolean).join(" · "),
      alt: `${c.title} · ${c.purposeLabel}`,
      officialEventTitle: c.officialEventTitle, officialSeriesTitle: c.officialSeriesTitle,
      localizedEventTitle: c.localizedEventTitle, localizedSeriesTitle: c.localizedSeriesTitle,
      displayTitle: c.title, performance: c.performance, context: c.context, date: c.date, venue: c.venue, purposeLabel: c.purposeLabel,
    };
    return { locale: s.locale, image, key, publicUrl, content };
  }));
  // Deliberately sequential: a failed 2nd/3rd PUT leaves no publication row.
  // Already written immutable objects are retained for a safe same-ID retry.
  for (const i of images) await storage.putImmutable({ key: i.key, bytes: i.image.bytes, contentType: "image/png", sha256: i.image.sha256 });
  let callbackFinished = false;
  try {
    const row = await db.$transaction(async (tx) => {
      await assertCurrent(tx);
      const created = await tx.eventCardPublication.create({ data: {
        id: revision, eventId: BigInt(eventId), mode, namespace: storage.keyPrefix, fingerprint, previewId: manifest.previewId, approvalSha256,
        identity: { template: manifest.template, fonts: manifest.fonts, renderer: manifest.renderer } as Prisma.InputJsonValue,
        annotation: { create: {} },
        renditions: { create: images.map((i) => ({ locale: i.locale, sha256: i.image.sha256, content: i.content,
          asset: { create: { objectKey: i.key, publicUrl: i.publicUrl, mimeType: "image/png", byteSize: i.image.byteSize, width: 1200, height: 630 } } })) },
      }, include: INCLUDE });
      callbackFinished = true;
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result(row, origin, "created");
  } catch (error) {
    // A lost COMMIT response and a concurrent same-ID winner are reconciled
    // by the committed fingerprint, never by assuming the transaction failed.
    try {
      const winner = await db.eventCardPublication.findUnique({ where: { id: revision }, include: INCLUDE });
      if (winner) return reconcile(winner);
    } catch (lookupError) {
      if (lookupError instanceof CardPublicationError) throw lookupError;
      if (callbackFinished) throw new CardPublicationError("outcome_unknown", "저장 결과가 미확정입니다. 같은 발행 식별자로 재시도하세요.");
    }
    if (callbackFinished) throw new CardPublicationError("outcome_unknown", "저장 결과가 미확정입니다. 같은 발행 식별자로 재시도하세요.");
    if (error instanceof CardPublicationError) throw error;
    throw new CardPublicationError("not_saved", "발행하지 못했습니다. 미할당 객체는 보존됩니다. 같은 식별자로 재시도하세요.");
  }
}

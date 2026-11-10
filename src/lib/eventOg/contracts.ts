import type { Prisma } from "../../generated/prisma/client";
import type { prisma } from "../prisma";
import type { ImageStorage } from "../imageUpload/storage";
import { BASE_URL } from "../config";
import { CARD_LOCALES, CARD_MODES, type CardLocale, type CardMode } from "./content";

export class CardPublicationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
export const invalid = (message: string) => new CardPublicationError("invalid_publication", message);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const isPublicationId = (value: string) => UUID.test(value);
export type CardDb = Pick<typeof prisma, "$transaction" | "event" | "eventCardPublication" | "eventCardWriteAttempt">;
export type PublicationDeps = { db?: CardDb; storage?: ImageStorage; origin?: string };
export type FrozenCard = {
  title: string; description: string; alt: string;
  officialEventTitle: string; officialSeriesTitle: string | null;
  localizedEventTitle: string; localizedSeriesTitle: string;
  displayTitle: string; performance: string; context: string; date: string; venue: string; purposeLabel: string;
};
export function publicationOrigin(value = BASE_URL) {
  const url = new URL(value);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw invalid("신뢰된 공개 origin 설정을 확인하세요.");
  return url.origin;
}
export function sharePath(eventId: string, mode: string, revision: string, locale: string) {
  if (!/^[1-9]\d*$/.test(eventId) || BigInt(eventId) > BigInt("9223372036854775807") || !CARD_MODES.includes(mode as CardMode)
    || !UUID.test(revision) || !CARD_LOCALES.includes(locale as CardLocale)) throw invalid("잘못된 공유 카드 식별자입니다.");
  return `/${locale}/share/events/${eventId}/${mode}/${revision}`;
}
export const INCLUDE = { renditions: { include: { asset: true } }, annotation: true } as const;
export type Stored = Prisma.EventCardPublicationGetPayload<{ include: typeof INCLUDE }>;
export function result(row: Stored, origin: string, status: "created" | "reconciled") {
  if (row.renditions.length !== 3 || !CARD_LOCALES.every((locale) => row.renditions.some((r) => r.locale === locale))) throw invalid("발행본의 언어 묶음이 완전하지 않습니다.");
  return { status, publicationId: row.id, eventId: String(row.eventId), mode: row.mode,
    publicationState: row.annotation ? { status: row.annotation.status, version: row.annotation.version } : null,
    urls: Object.fromEntries(CARD_LOCALES.map((l) => [l, origin + sharePath(String(row.eventId), row.mode, row.id, l)])) };
}


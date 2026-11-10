import { classifyImageSource } from "@/lib/imageSourceBadge";
import { isSafeExternalUrl } from "@/lib/utils";

export class PurchaseInputError extends Error {}

function invalid(field: string): never {
  throw new PurchaseInputError(field + " 값을 확인해 주세요.");
}

export function parseRevision(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647) invalid("리비전");
  return value;
}

export function optionalString(body: Record<string, unknown>, key: string, max = 2048) {
  const value = body[key];
  if (value == null) return value;
  if (typeof value !== "string" || value.length > max) invalid(key);
  return value.trim() || null;
}

export function optionalUrl(body: Record<string, unknown>, key: string) {
  const value = optionalString(body, key);
  if (value != null && (!/^https?:\/\//i.test(value) || !isSafeExternalUrl(value) ||
    new URL(value).username || new URL(value).password)) invalid(key);
  return value;
}

function optionalBoolean(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value == null || typeof value === "boolean") return value;
  return invalid(key);
}

export function parseInstant(value: unknown, key: string) {
  if (value === null) return null;
  if (typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || value.endsWith("-00:00")) invalid(key);
  const day = new Date(value.slice(0, 10) + "T00:00:00Z");
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || Number.isNaN(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)) invalid(key);
  return instant;
}

export function parsePeriod(body: Record<string, unknown>) {
  if (body.startsAt === undefined && body.endsAt === undefined) return {};
  const startsAt = parseInstant(body.startsAt, "시작 시각");
  const endsAt = parseInstant(body.endsAt, "종료 시각");
  if (startsAt && endsAt && startsAt >= endsAt) invalid("기간");
  return { startsAt, endsAt };
}

export function parseListingPurchaseFields(body: Record<string, unknown>) {
  const officialOrder = body.officialOrder;
  if (officialOrder != null && (typeof officialOrder !== "number" ||
    !Number.isInteger(officialOrder) || officialOrder < 1 || officialOrder > 2147483647)) invalid("공식 순서");
  const includesPerformanceVideo = optionalBoolean(body, "includesPerformanceVideo");
  const isBonusOption = optionalBoolean(body, "isBonusOption");
  if (includesPerformanceVideo === true && typeof isBonusOption !== "boolean") invalid("구매 옵션 유형");
  const storeKey = optionalString(body, "storeKey", 100)?.normalize("NFKC").toLowerCase();
  return {
    ...parsePeriod(body),
    storeKey: body.storeKey === undefined ? undefined : storeKey ?? null,
    officialOrder,
    includesPerformanceVideo,
    isBonusOption,
    productUrl: optionalUrl(body, "productUrl"),
    sourceUrl: optionalUrl(body, "sourceUrl"),
    selectionGuide: optionalString(body, "selectionGuide"),
  };
}

export function parseBonusPurchaseFields(body: Record<string, unknown>) {
  const bonusImageUrl = optionalUrl(body, "bonusImageUrl");
  if (bonusImageUrl && classifyImageSource(bonusImageUrl, { r2Host: process.env.R2_PUBLIC_BASE_URL }).warn) invalid("특전 이미지 URL");
  return {
    ...parsePeriod(body),
    sourceUrl: optionalUrl(body, "sourceUrl"),
    bonusImageUrl,
    originalBonusDescription: optionalString(body, "originalBonusDescription"),
  };
}

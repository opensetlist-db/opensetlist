import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_LOCALES, type ImpressionLocale } from "@/lib/config";
import { getTranslator } from "@/lib/translator";
import { SYSTEM_PROMPT, type MultilingualOutput } from "@/lib/translator/prompt";

const TRANSLATOR_TIMEOUT_MS = 30_000;

// POST /api/impressions/translate
// Body: { impressionId: string, targetLocale: "ko" | "ja" | "en" }
// Response: { translatedText: string } | { error: string }
//
// `impressionId` is the row id (EventImpression.id, a UUID), not the chain
// id (rootImpressionId). The translation cache keys per row so each version
// of an edited impression caches independently.
//
// The LLM returns all three locales per call. We cache both non-source
// target rows so the second-target request hits the cache without a second
// LLM round-trip.
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { impressionId, targetLocale } = body ?? {};

  if (typeof impressionId !== "string" || impressionId.length === 0) {
    return NextResponse.json({ error: "Invalid impressionId" }, { status: 400 });
  }
  if (
    typeof targetLocale !== "string" ||
    !(IMPRESSION_LOCALES as readonly string[]).includes(targetLocale)
  ) {
    return NextResponse.json({ error: "Invalid targetLocale" }, { status: 400 });
  }

  // Same predicate as the public list at src/app/api/impressions/route.ts —
  // never translate a row that's hidden, deleted, or superseded.
  const impression = await prisma.eventImpression.findFirst({
    where: {
      id: impressionId,
      isDeleted: false,
      isHidden: false,
      supersededAt: null,
    },
    select: { id: true, content: true, locale: true, eventId: true },
  });
  if (!impression) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sourceLocale = impression.locale;

  // Same-locale short-circuit — no cache write, no provider call.
  if (sourceLocale === targetLocale) {
    return NextResponse.json({ translatedText: impression.content });
  }

  const cached = await prisma.impressionTranslation.findUnique({
    where: {
      impressionId_sourceLocale_targetLocale: {
        impressionId,
        sourceLocale,
        targetLocale,
      },
    },
    select: { translatedText: true },
  });
  if (cached) {
    return NextResponse.json({ translatedText: cached.translatedText });
  }

  let multilingual: MultilingualOutput;
  try {
    const translator = getTranslator();
    multilingual = await translator.translate(
      impression.content,
      sourceLocale,
      SYSTEM_PROMPT,
      AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
    );
  } catch (err) {
    // Don't log `err` directly — provider SDK errors often echo the request
    // payload (the user's impression text) in their message/cause fields.
    // The same redaction discipline applies to *every* Sentry sink below.
    // Specifically, we deliberately do NOT call `Sentry.captureException(err)`
    // because that would re-leak the redacted fields through err.message /
    // err.cause / err.stack. Instead we capture a sanitized message with
    // metadata-only tags + extras, paired with a breadcrumb so the request
    // trail still shows the failure point.
    const errorName = err instanceof Error ? err.name : typeof err;
    const provider = process.env.TRANSLATION_PROVIDER ?? "gemini";
    const textLength = impression?.content?.length ?? 0;
    Sentry.addBreadcrumb({
      category: "translator",
      level: "error",
      message: "translate_failed",
      data: { provider, sourceLocale, targetLocale, errorName, textLength },
    });
    Sentry.captureMessage("translator.translate_failed", {
      level: "error",
      tags: { provider, sourceLocale, targetLocale, errorName },
      extra: { textLength },
    });
    console.error("Translator call failed", { name: errorName });
    return NextResponse.json(
      { error: "Translation unavailable" },
      { status: 502 },
    );
  }

  // Trim all three locale outputs once — whitespace-only strings pass
  // `!translatedText` but render as empty to the user, and once cached
  // they'd keep hitting the cache instead of retrying the LLM.
  const trimmed: MultilingualOutput = {
    ko: multilingual.ko.trim(),
    ja: multilingual.ja.trim(),
    en: multilingual.en.trim(),
  };

  const translatedText = trimmed[targetLocale as ImpressionLocale];
  if (!translatedText) {
    // Provider returned the JSON shape but omitted / emptied the requested
    // locale. Log locale presence (not content) and 502 — cache nothing.
    console.warn("Translator returned empty target locale", {
      sourceLocale,
      targetLocale,
      hasKo: !!trimmed.ko,
      hasJa: !!trimmed.ja,
      hasEn: !!trimmed.en,
    });
    return NextResponse.json(
      { error: "Translation unavailable" },
      { status: 502 },
    );
  }

  // Cache all non-source locales the LLM actually produced in one write.
  // `skipDuplicates: true` tolerates a concurrent writer racing us for the
  // same (impressionId, sourceLocale, targetLocale) key, so no explicit
  // P2002 branch is needed.
  const rowsToCache = (IMPRESSION_LOCALES as readonly ImpressionLocale[])
    .filter((loc) => loc !== sourceLocale && trimmed[loc].length > 0)
    .map((loc) => ({
      impressionId,
      sourceLocale,
      targetLocale: loc,
      translatedText: trimmed[loc],
    }));

  try {
    await prisma.impressionTranslation.createMany({
      data: rowsToCache,
      skipDuplicates: true,
    });
  } catch (err) {
    // Insert failed — log redacted metadata and return the fresh
    // translation anyway. Cache just won't stick; next call repeats the
    // LLM hit. Same redaction discipline as the translator catch above.
    console.warn("ImpressionTranslation insert failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
  }

  return NextResponse.json({ translatedText });
}

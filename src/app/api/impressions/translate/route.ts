import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { IMPRESSION_LOCALES } from "@/lib/config";
import { getTranslator } from "@/lib/translator";
import {
  applyGlossary,
  getGlossaryForEvent,
  restoreGlossary,
  type GlossaryPair,
} from "@/lib/glossary";

const TRANSLATOR_TIMEOUT_MS = 30_000;

// POST /api/impressions/translate
// Body: { impressionId: string, targetLocale: "ko" | "ja" | "en" }
// Response: { translatedText: string } | { error: string }
//
// `impressionId` is the row id (EventImpression.id, a UUID), not the chain
// id (rootImpressionId). The translation cache keys per row so each version
// of an edited impression caches independently.
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

  // Build glossary so proper nouns survive the LLM call as opaque
  // placeholders. Fail-open: if the glossary fetch flakes, translate the
  // raw content instead of 502'ing — degraded translation quality is
  // strictly better than no translation at all.
  let pairs: GlossaryPair[] = [];
  try {
    pairs = await getGlossaryForEvent(
      impression.eventId,
      sourceLocale as "ko" | "ja" | "en",
      targetLocale as "ko" | "ja" | "en",
    );
  } catch (err) {
    // Same redaction discipline as the translator catch — log identifying
    // metadata only, never the raw err (Prisma errors can echo query args).
    console.warn("Glossary lookup failed, translating without glossary", {
      name: err instanceof Error ? err.name : typeof err,
    });
  }
  const { processed, restoreMap } = applyGlossary(impression.content, pairs);

  let rawTranslation: string;
  try {
    const translator = getTranslator();
    rawTranslation = await translator.translate(
      processed,
      sourceLocale,
      targetLocale,
      AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
    );
  } catch (err) {
    // Don't log `err` directly — provider SDK errors often echo the request
    // payload (the user's impression text) in their message/cause fields.
    console.error("Translator call failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json(
      { error: "Translation unavailable" },
      { status: 502 },
    );
  }

  const translatedText = restoreGlossary(rawTranslation, restoreMap);

  try {
    await prisma.impressionTranslation.create({
      data: { impressionId, sourceLocale, targetLocale, translatedText },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Concurrent miss raced us — return the winner's row.
      const winner = await prisma.impressionTranslation.findUnique({
        where: {
          impressionId_sourceLocale_targetLocale: {
            impressionId,
            sourceLocale,
            targetLocale,
          },
        },
        select: { translatedText: true },
      });
      if (winner) {
        return NextResponse.json({ translatedText: winner.translatedText });
      }
    }
    // Insert failed for some other reason — log and return the fresh
    // translation anyway. The cache just won't stick this time. Same
    // redaction pattern as the translator catch above: log identifying
    // metadata only, never the raw err.
    console.warn("ImpressionTranslation insert failed", {
      name: err instanceof Error ? err.name : typeof err,
      code:
        err instanceof Prisma.PrismaClientKnownRequestError
          ? err.code
          : undefined,
    });
  }

  return NextResponse.json({ translatedText });
}

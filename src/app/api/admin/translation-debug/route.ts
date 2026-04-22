import { NextRequest, NextResponse } from "next/server";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { IMPRESSION_LOCALES } from "@/lib/config";
import { getTranslator } from "@/lib/translator";
import {
  applyGlossary,
  buildArtistTerms,
  getGlossaryForEvent,
  restoreGlossary,
  type GlossaryPair,
} from "@/lib/glossary";

const TRANSLATOR_TIMEOUT_MS = 30_000;

// POST /api/admin/translation-debug
// Body: { eventId, sourceLocale, targetLocale, text }
// Response: { pairs, processed, rawTranslation, restored }
//
// Admin-only debug endpoint for inspecting the glossary pipeline. Bypasses
// both the 1h artist-terms cache (uses buildArtistTerms directly so freshly
// edited data shows up immediately) and the ImpressionTranslation cache
// (every click hits the translator). The production translate route is the
// caching-enabled path.
export async function POST(req: NextRequest) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { eventId, sourceLocale, targetLocale, text } = (body ?? {}) as {
    eventId?: unknown;
    sourceLocale?: unknown;
    targetLocale?: unknown;
    text?: unknown;
  };

  if (typeof eventId !== "string" || !/^\d+$/.test(eventId)) {
    return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
  }
  if (
    typeof sourceLocale !== "string" ||
    !(IMPRESSION_LOCALES as readonly string[]).includes(sourceLocale)
  ) {
    return NextResponse.json({ error: "Invalid sourceLocale" }, { status: 400 });
  }
  if (
    typeof targetLocale !== "string" ||
    !(IMPRESSION_LOCALES as readonly string[]).includes(targetLocale)
  ) {
    return NextResponse.json({ error: "Invalid targetLocale" }, { status: 400 });
  }
  if (typeof text !== "string") {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }

  let pairs: GlossaryPair[] = [];
  try {
    pairs = await getGlossaryForEvent(
      BigInt(eventId),
      sourceLocale as "ko" | "ja" | "en",
      targetLocale as "ko" | "ja" | "en",
      buildArtistTerms,
    );
  } catch (err) {
    // Same redaction discipline as the public translate route.
    console.warn("Debug glossary lookup failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json({ error: "Glossary lookup failed" }, { status: 500 });
  }

  const { processed, restoreMap } = applyGlossary(text, pairs);

  // Same-locale → no translator call; the "raw" output is the processed text.
  if (sourceLocale === targetLocale) {
    return NextResponse.json({
      pairs,
      processed,
      rawTranslation: processed,
      restored: restoreGlossary(processed, restoreMap),
    });
  }

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
    console.error("Debug translator call failed", {
      name: err instanceof Error ? err.name : typeof err,
    });
    return NextResponse.json(
      { error: "Translation unavailable", pairs, processed },
      { status: 502 },
    );
  }

  const restored = restoreGlossary(rawTranslation, restoreMap);

  return NextResponse.json({ pairs, processed, rawTranslation, restored });
}

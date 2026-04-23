import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { IMPRESSION_LOCALES } from "@/lib/config";
import {
  SYSTEM_PROMPT,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "@/lib/translator/prompt";
import { geminiRawTranslate } from "@/lib/translator/gemini";
import { openaiRawTranslate } from "@/lib/translator/openai";

const TRANSLATOR_TIMEOUT_MS = 30_000;

const PROVIDERS = ["gemini", "openai"] as const;
type Provider = (typeof PROVIDERS)[number];

// POST /api/admin/translation-debug
// Body: { sourceLocale: "ko" | "ja" | "en", text: string, provider?: "gemini" | "openai" }
// Response: { systemPrompt, input, raw, parsed, parseError, sourceLocale, provider }
//
// Phase 1A uses a hardcoded Hasunosora prompt (see
// src/lib/translator/prompts/hasunosora.ts), so `eventId` is no longer
// part of the request shape — per-event prompts arrive in Phase 1B.
// `sourceLocale` is used by the UI to dim the source row in the parsed
// output table; the prompt itself does not inject it.
//
// `provider` overrides TRANSLATION_PROVIDER for this request only — lets
// admins A/B the same prompt across both providers without touching env.
// Falls back to env (default "gemini") when unset.
//
// Bypasses the ImpressionTranslation cache — every click hits the
// translator. The production translate route is the caching-enabled path.
export async function POST(req: NextRequest) {
  const unauth = await verifyAdminAPI();
  if (unauth) return unauth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sourceLocale, text, provider: providerInput } = (body ?? {}) as {
    sourceLocale?: unknown;
    text?: unknown;
    provider?: unknown;
  };

  if (
    typeof sourceLocale !== "string" ||
    !(IMPRESSION_LOCALES as readonly string[]).includes(sourceLocale)
  ) {
    return NextResponse.json({ error: "Invalid sourceLocale" }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }
  if (
    providerInput !== undefined &&
    (typeof providerInput !== "string" ||
      !(PROVIDERS as readonly string[]).includes(providerInput))
  ) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const provider: Provider =
    (providerInput as Provider | undefined) ??
    ((PROVIDERS as readonly string[]).includes(
      process.env.TRANSLATION_PROVIDER ?? "",
    )
      ? (process.env.TRANSLATION_PROVIDER as Provider)
      : "gemini");
  let raw: string;
  try {
    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      raw = await geminiRawTranslate(
        new GoogleGenAI({ apiKey: key }),
        text,
        sourceLocale,
        AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
      );
    } else if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      raw = await openaiRawTranslate(
        new OpenAI({ apiKey: key }),
        text,
        sourceLocale,
        AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
      );
    } else {
      // Exhaustiveness guard — `provider` is narrowed to the validated
      // union above; `provider satisfies never` fails compilation if the
      // union grows without a new branch.
      const exhaustive: never = provider;
      throw new Error(`Unknown provider: ${exhaustive}`);
    }
  } catch (err) {
    console.error("Debug translator call failed", {
      name: err instanceof Error ? err.name : typeof err,
      provider,
    });
    return NextResponse.json(
      {
        error: "Translation unavailable",
        systemPrompt: SYSTEM_PROMPT,
        input: text,
        sourceLocale,
        provider,
      },
      { status: 502 },
    );
  }

  let parsed: MultilingualOutput | null = null;
  let parseError: string | null = null;
  try {
    parsed = parseMultilingualResponse(raw);
  } catch (err) {
    parseError = err instanceof Error ? err.message : "parse failed";
  }

  return NextResponse.json({
    systemPrompt: SYSTEM_PROMPT,
    input: text,
    raw,
    parsed,
    parseError,
    sourceLocale,
    provider,
  });
}

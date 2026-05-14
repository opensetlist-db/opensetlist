import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { IMPRESSION_LOCALES } from "@/lib/config";
import {
  buildUserInput,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "@/lib/translator/prompt";
import {
  IP_PROMPTS,
  FALLBACK_PROMPT,
  REGISTERED_IP_KEYS,
} from "@/lib/translator/prompts";
import { geminiRawTranslate } from "@/lib/translator/gemini";
import { openaiRawTranslate } from "@/lib/translator/openai";

const TRANSLATOR_TIMEOUT_MS = 30_000;

const PROVIDERS = ["gemini", "openai"] as const;
type Provider = (typeof PROVIDERS)[number];

// Admin can target any registered IP prompt by slug, or the generic
// fallback. The dropdown UI is bounded by REGISTERED_IP_KEYS + "generic"
// so the request shape is always validated against a known whitelist.
const GENERIC_IP_KEY = "generic" as const;
const VALID_IP_KEYS: readonly string[] = [...REGISTERED_IP_KEYS, GENERIC_IP_KEY];

// POST /api/admin/translation-debug
// Body: { sourceLocale: "ko" | "ja" | "en", text: string,
//         provider?: "gemini" | "openai",
//         ipKey?: <REGISTERED_IP_KEYS> | "generic" }
// Response: { systemPrompt, input, raw, parsed, parseError, sourceLocale,
//             provider, ipKey }
//
// `ipKey` picks which prompt to send: any slug in IP_PROMPTS, or "generic"
// for the fallback prompt. Default "hasunosora" preserves pre-multi-IP
// behavior for existing operator workflows. `sourceLocale` is used by
// the UI to dim the source row in the parsed output table; the prompt
// itself does not inject it.
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

  const {
    sourceLocale,
    text,
    provider: providerInput,
    ipKey: ipKeyInput,
  } = (body ?? {}) as {
    sourceLocale?: unknown;
    text?: unknown;
    provider?: unknown;
    ipKey?: unknown;
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
  if (
    ipKeyInput !== undefined &&
    (typeof ipKeyInput !== "string" || !VALID_IP_KEYS.includes(ipKeyInput))
  ) {
    return NextResponse.json({ error: "Invalid ipKey" }, { status: 400 });
  }

  // Default to hasunosora for parity with pre-multi-IP behavior. The
  // hasunosora slug is guaranteed in IP_PROMPTS by the registry contract
  // (see src/lib/translator/prompts/index.ts).
  const ipKey: string =
    typeof ipKeyInput === "string" ? ipKeyInput : "hasunosora";
  const systemPrompt: string =
    ipKey === GENERIC_IP_KEY
      ? FALLBACK_PROMPT
      : (IP_PROMPTS[ipKey] ?? FALLBACK_PROMPT);

  const provider: Provider =
    (providerInput as Provider | undefined) ??
    ((PROVIDERS as readonly string[]).includes(
      process.env.TRANSLATION_PROVIDER ?? "",
    )
      ? (process.env.TRANSLATION_PROVIDER as Provider)
      : "gemini");

  // Echo the exact user turn the providers see (text + source_locale hint),
  // not just the raw text. This is what prompt-reproduction debugging needs.
  const input = buildUserInput(text, sourceLocale);

  let raw: string;
  try {
    if (provider === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY not set");
      raw = await geminiRawTranslate(
        new GoogleGenAI({ apiKey: key }),
        text,
        sourceLocale,
        systemPrompt,
        AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
      );
    } else if (provider === "openai") {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      raw = await openaiRawTranslate(
        new OpenAI({ apiKey: key }),
        text,
        sourceLocale,
        systemPrompt,
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
    // Surface the provider's underlying cause in the response — this is an
    // admin-only debug endpoint, so structured diagnostic detail is the
    // whole point. The production translate route still redacts.
    // Cap at 2000 chars so verbose SDK stack traces / request-payload
    // echoes don't bloat the log pipeline and response body.
    const rawDetail = err instanceof Error ? err.message : String(err);
    const detail =
      rawDetail.length > 2000 ? `${rawDetail.slice(0, 2000)}…` : rawDetail;
    console.error("Debug translator call failed", {
      name: err instanceof Error ? err.name : typeof err,
      detail,
      provider,
    });
    return NextResponse.json(
      {
        error: "Translation unavailable",
        detail,
        systemPrompt,
        input,
        sourceLocale,
        provider,
        ipKey,
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
    systemPrompt,
    input,
    raw,
    parsed,
    parseError,
    sourceLocale,
    provider,
    ipKey,
  });
}

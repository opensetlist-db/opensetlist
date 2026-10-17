import Anthropic from "@anthropic-ai/sdk";
import { TranslationTruncatedError, type Translator } from "./types";
import {
  buildUserInput,
  estimateMaxTokens,
  parseMultilingualResponse,
  type MultilingualOutput,
} from "./prompt";
import {
  ANTHROPIC_MODEL,
  ANTHROPIC_MODELS,
  type AnthropicModel,
} from "./anthropicModels";

// Re-exported so server code can keep importing everything Claude-related
// from here; client code must import ./anthropicModels directly.
export { ANTHROPIC_MODEL, ANTHROPIC_MODELS, type AnthropicModel };

// "No thinking" is spelled differently per model: Haiku 5.5 takes
// `disabled`, while Sonnet 5.5 rejects `disabled` with a 400 and wants
// `between_tools` (no thinking before the response; it only writes short
// updates between tool calls, and we use no tools). Translation needs no
// reasoning, and thinking tokens bill as output, so both stay off.
const NO_THINKING: Record<AnthropicModel, Anthropic.ThinkingConfigParam> = {
  "claude-haiku-5-5": { type: "disabled" },
  "claude-sonnet-5-5": { type: "between_tools" },
};

// Structured-output schema. Binds the response shape at the API layer —
// the Claude counterpart of Gemini's `responseMimeType`. It also rules out
// the F13 failure mode (`[]` on glossary-free input) because an empty
// array can't satisfy an object schema.
//
// The schema is an object, while the shared system prompt asks for a
// "JSON 배열". The prompt is deliberately left unchanged so all providers
// run the same text; parseMultilingualResponse already accepts a bare
// object. Changing this schema invalidates Claude's prompt cache.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ko: { type: "string" },
    ja: { type: "string" },
    en: { type: "string" },
  },
  required: ["ko", "ja", "en"],
  additionalProperties: false,
} as const;

export class AnthropicTranslator implements Translator {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async translate(
    text: string,
    sourceLocale: string,
    systemPrompt: string,
    signal?: AbortSignal,
  ): Promise<MultilingualOutput> {
    const { raw } = await anthropicRawTranslate(
      this.client,
      text,
      sourceLocale,
      systemPrompt,
      signal,
    );
    return parseMultilingualResponse(raw);
  }
}

export type AnthropicRawResult = {
  raw: string;
  // Usage is returned (unlike the Gemini/OpenAI helpers) because the
  // bake-off script reports per-call cost, and Claude's cost depends on
  // whether the system prompt was a cache write or a cache read.
  usage: Anthropic.Usage;
};

// Exposed for the admin debug route and the bake-off script — returns the
// raw pre-parse string so callers can show the literal model output.
export async function anthropicRawTranslate(
  client: Anthropic,
  text: string,
  sourceLocale: string,
  systemPrompt: string,
  signal?: AbortSignal,
  model: AnthropicModel = ANTHROPIC_MODEL,
): Promise<AnthropicRawResult> {
  const res = await client.messages.create(
    {
      model,
      max_tokens: estimateMaxTokens(text),
      // Claude has no automatic prompt caching: the system prompt must
      // carry an explicit cache_control breakpoint. Default 5-minute TTL —
      // translate traffic is dense during a live and sparse otherwise, so
      // a 1h write (2× base vs 1.25×) would mostly expire unread.
      // Haiku 5.5's minimum cacheable prefix is 512 tokens; every
      // registered prompt clears it (scripts/count-prompt-tokens.ts).
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: buildUserInput(text, sourceLocale) },
      ],
      // Haiku 5.5 thinks by default and bills thinking tokens as output.
      // Translation needs no reasoning — same rationale as Gemini's
      // thinkingLevel: MINIMAL. See NO_THINKING for the per-model shape.
      thinking: NO_THINKING[model],
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: OUTPUT_SCHEMA },
      },
      // No `temperature` (the other providers pin 0.3): models after
      // Opus 4.6 reject any value other than 1.0 with a 400.
    },
    signal ? { signal } : undefined,
  );

  // Symmetric with Gemini's finishReason / OpenAI's incomplete_details
  // handling: truncation gets its own error type so the route can map it,
  // and a refusal surfaces its reason instead of "empty translation".
  if (res.stop_reason === "max_tokens") {
    throw new TranslationTruncatedError("Anthropic");
  }
  if (res.stop_reason === "refusal") {
    throw new Error("Anthropic translation failed: stop_reason=refusal");
  }
  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!raw) throw new Error("Anthropic returned empty translation");
  return { raw, usage: res.usage };
}

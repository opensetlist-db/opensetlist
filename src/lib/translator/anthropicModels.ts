// Claude model ids, split from anthropic.ts so client code (the admin
// translation-debug page) can import them without pulling the Anthropic
// SDK into the client bundle — same split as prompts/keys.ts vs the
// prompt strings. Keep this file free of SDK imports.

// The model the live translator runs. Shared with
// scripts/count-prompt-tokens.ts so the cache-threshold check measures on
// the same tokenizer, mirroring GEMINI_MODEL in gemini.ts.
export const ANTHROPIC_MODEL = "claude-haiku-5-5";

// Models the admin debug route and the bake-off script may pick per
// request. Sonnet is here only as a quality ceiling for comparisons
// (≈20× Haiku's price); production always runs ANTHROPIC_MODEL.
export const ANTHROPIC_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
export type AnthropicModel = (typeof ANTHROPIC_MODELS)[number];

// Dropdown labels for the debug page. Record<AnthropicModel, …> makes a
// model added above fail typecheck until it has a label.
export const ANTHROPIC_MODEL_LABELS: Record<AnthropicModel, string> = {
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
};

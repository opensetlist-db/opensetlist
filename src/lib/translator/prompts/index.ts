import { HASUNOSORA_GLOSSARY_PROMPT } from "./hasunosora";
import { GENERIC_FALLBACK_PROMPT } from "./generic";

// Per-IP system-prompt registry.
//
// Key = Group.slug for Groups where type=franchise (see prisma/schema.prisma
// Group / GroupType). One slug → one prompt module. Resolved at request time
// from impression → event → performers → artists → franchise Group →
// distinct-slug-set (see promptResolver.ts for the full walk and the
// selection rules around single / multi / unmapped franchises).
//
// IMPLICIT-CACHE INVARIANT: every prompt here MUST measure ≥1024 tokens on
// Gemini's tokenizer (see hasunosora.ts:5 for the existing pattern and
// task-translation-implicit-cache-rewrite.md §"Token-count invariant" for
// the rationale — silent regression below the threshold breaks caching and
// silently 10×'s per-call cost). The measured count is committed in each
// prompt file's header comment; scripts/count-prompt-tokens.ts re-measures
// against the live Gemini tokenizer when run locally.
//
// When adding an IP:
//   1. Author src/lib/translator/prompts/<slug>.ts following the
//      hasunosora.ts shape (Korean-written, §1 글로서리 + §2 번역 규칙,
//      ends with the JSON-배열 format clause).
//   2. Measure tokens via scripts/count-prompt-tokens.ts; commit the count
//      in the file header.
//   3. Add the slug → prompt mapping below.
//   4. Smoke-test via /admin/translation-debug with the new ipKey.
export const IP_PROMPTS: Record<string, string> = {
  hasunosora: HASUNOSORA_GLOSSARY_PROMPT,
  // nijigasaki: NIJIGASAKI_GLOSSARY_PROMPT, // pending operator authoring
  // umamusume:  UMAMUSUME_GLOSSARY_PROMPT,  // pending operator authoring
};

// Used by the resolver when:
//   - no franchise Group is linked to the event's performers
//   - exactly one franchise slug appears but it's not in IP_PROMPTS
//   - two or more distinct franchise slugs appear (joint-live across IPs)
//
// The composite per-event override for important joint-live cases (e.g.
// 러브라이브15주년페스 covering Hasunosora + Nijigasaki + Aqours + μ's +
// Liella) is deferred — see task-multi-ip-translation-context.md §Follow-ups.
export const FALLBACK_PROMPT = GENERIC_FALLBACK_PROMPT;

// Public for the admin /admin/translation-debug dropdown so the operator
// can preview any registered IP's prompt without needing a real event.
export const REGISTERED_IP_KEYS: readonly string[] = Object.keys(IP_PROMPTS);

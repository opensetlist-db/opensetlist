import { HASUNOSORA_GLOSSARY_PROMPT } from "./hasunosora";
import { NIJIGASAKI_GLOSSARY_PROMPT } from "./nijigasaki";
import { GENERIC_FALLBACK_PROMPT } from "./generic";
import { REGISTERED_IP_KEYS } from "./keys";

// Re-export so server-side consumers can grab everything from the barrel.
// Client-side consumers MUST import from "./keys" directly to avoid
// transitively bundling the large prompt strings — see keys.ts header.
export { REGISTERED_IP_KEYS } from "./keys";

// Per-IP system-prompt registry.
//
// Key = top-level group Artist.slug (Artist.type=group AND parentArtistId
// IS NULL — Hasunosora, Nijigasaki, μ's, Liella, Aqours, …; NOT their
// sub-units or solo character Artists). One slug → one prompt module.
// Resolved at request time from impression → event → performers → artists
// (see promptResolver.ts for the full walk and the selection rules).
//
// Top-level Artist is the natural IP identity in this catalog — each one
// owns a distinct character roster and song corpus. Group entries
// (franchise=`lovelive`, series=`hasunosora-club`) are administrative
// groupings with naming-convention artifacts that don't belong in
// IP_PROMPTS keys.
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
// Partial<Record<…>>, not Record<…>: arbitrary string lookups on a
// dictionary literal return `string | undefined` at runtime, and the
// resolver's "is this slug registered?" guard depends on TypeScript
// surfacing that. A plain Record types the index access as `string`
// (never undefined), which silently hides the guard.
export const IP_PROMPTS: Partial<Record<string, string>> = {
  hasunosora: HASUNOSORA_GLOSSARY_PROMPT,
  nijigasaki: NIJIGASAKI_GLOSSARY_PROMPT,
  // aqours:    AQOURS_GLOSSARY_PROMPT,    // pending operator authoring
  // umamusume: UMAMUSUME_GLOSSARY_PROMPT, // pending operator authoring
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

// Invariant guard: the runtime IP_PROMPTS keys must match REGISTERED_IP_KEYS
// (which the client bundle imports without seeing the prompt strings).
// If they drift, the admin UI dropdown and the server-side whitelist
// disagree about which keys are valid. Fail loud at module load.
if (process.env.NODE_ENV !== "production") {
  const runtimeKeys = Object.keys(IP_PROMPTS).filter(
    (k) => IP_PROMPTS[k] !== undefined,
  );
  const declared = [...REGISTERED_IP_KEYS].sort();
  const actual = runtimeKeys.slice().sort();
  if (
    declared.length !== actual.length ||
    declared.some((k, i) => k !== actual[i])
  ) {
    throw new Error(
      `IP_PROMPTS / REGISTERED_IP_KEYS drift: declared=${declared.join(",")} ` +
        `actual=${actual.join(",")}. Update src/lib/translator/prompts/keys.ts ` +
        `whenever IP_PROMPTS gains or loses an entry.`,
    );
  }
}

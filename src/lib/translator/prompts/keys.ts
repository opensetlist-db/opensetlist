// Thin, side-effect-free module: exposes ONLY the list of registered IP
// slugs (plus the "generic" sentinel), with no transitive imports of the
// large prompt-content strings.
//
// Why split: the admin translation-debug page (a "use client" component)
// needs the dropdown values, but if it imported from `./index` it would
// transitively bundle every prompt string (each ≥1024 tokens, each
// multi-KB) into the client JS — pure waste for a feature that only ever
// uses the slug names. Importing from this file instead keeps the client
// bundle to the slug list alone.
//
// MUST stay in lock-step with the IP_PROMPTS keys in ./index.ts. If a
// new IP prompt is added there, add its slug here too. The server-side
// validation in /api/admin/translation-debug uses this same list.
export const REGISTERED_IP_KEYS: readonly string[] = ["hasunosora"];

export const GENERIC_IP_KEY = "generic";

// Default ipKey for the admin debug surface (UI initial state +
// server-side default when the field is omitted). Single source of truth
// shared between page.tsx and the route. Picked as "hasunosora" for
// parity with the pre-multi-IP behavior — the admin can switch on demand.
export const DEFAULT_IP_KEY = "hasunosora";

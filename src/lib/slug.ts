/**
 * Converts a string to a URL-safe slug.
 * ASCII only — non-ASCII characters are stripped.
 * For Japanese/Korean names, use generateUniqueSlug() which transliterates first.
 */
export function generateSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

/**
 * Strict canonical-slug check for admin-supplied input.
 *
 * Round-trips the trimmed input through `generateSlug` and returns it
 * verbatim if nothing changes — i.e. the input is already in canonical
 * form (lowercase alphanumeric + hyphens, no leading/trailing hyphens,
 * ≤100 chars). Returns `null` for blank, non-string, or non-canonical
 * input so the caller can map to a 400 response.
 *
 * No fallback, no silent rewriting. The operator should be told their
 * slug is invalid rather than have it quietly normalized.
 */
export function validateCanonicalSlug(rawSlug: unknown): string | null {
  if (typeof rawSlug !== "string") return null;
  const trimmed = rawSlug.trim();
  if (!trimmed) return null;
  const canonical = generateSlug(trimmed);
  if (!canonical || canonical !== trimmed) return null;
  return trimmed;
}

/**
 * Auto-candidate slug derivation. Returns "" if both ASCII normalization
 * and Japanese transliteration produce empty strings — caller decides
 * whether to fall back to a timestamp.
 *
 * Pipeline:
 *   1. `generateSlug(input)` — pure ASCII strip + lowercase + hyphens.
 *      For ASCII or mixed-ASCII inputs this is the answer.
 *   2. If (1) is empty (e.g. `"ハナムスビ"`, `"上昇気流"`), pass through
 *      kuroshiro to get romaji and re-run `generateSlug`. Catches CJK
 *      input that ASCII-strip alone can't handle.
 *   3. If even (2) is empty (rare — kuroshiro init failure, or all-symbol
 *      input that can't transliterate), return "".
 *
 * Used by:
 *   - `POST /api/admin/slug-generator` (preview tool — call directly).
 *   - `resolveCanonicalSlug` (admin POST entry point — auto-fallback path).
 *   - `generateUniqueSlug` (DB-aware uniqueness wrapper for songs).
 *
 * Single source of truth for "what slug would this name produce". Any
 * change to transliteration policy lives here.
 */
export async function deriveSlug(input: string): Promise<string> {
  const ascii = generateSlug(input);
  if (ascii) return ascii;
  const romaji = await transliterateToRomaji(input);
  return generateSlug(romaji);
}

/**
 * Combined entry point for admin POST handlers. Validates an admin-supplied
 * slug if one was provided, otherwise auto-derives from `fallbackSource`.
 *
 * - Admin path: round-trip canonical check via `validateCanonicalSlug`.
 *   `{ ok: false }` if input was provided but not canonical — caller maps
 *   to 400 with the embedded Korean error message.
 *
 * - Auto path: `await deriveSlug(fallbackSource)` (transliterates Japanese
 *   if ASCII strip is empty), falling back to `${modelPrefix}-${Date.now()}`
 *   only when both ASCII and transliteration produce "". Always returns a
 *   non-empty slug on the auto path.
 *
 * Async because `deriveSlug` calls kuroshiro. Replaces the previous sync
 * version (which was ASCII-only on the auto path) — every admin POST that
 * uses this now gets transliterated slugs for Japanese-named entities,
 * matching what `generateUniqueSlug` already did for songs.
 */
export async function resolveCanonicalSlug(
  rawSlug: unknown,
  fallbackSource: string,
  modelPrefix: string
): Promise<{ ok: true; slug: string } | { ok: false; message: string }> {
  if (typeof rawSlug === "string" && rawSlug.trim()) {
    const validated = validateCanonicalSlug(rawSlug);
    if (!validated) {
      return {
        ok: false,
        message:
          "슬러그는 영소문자, 숫자, 하이픈으로만 구성된 URL-safe 형식이어야 합니다 (예: my-slug).",
      };
    }
    return { ok: true, slug: validated };
  }
  const derived = await deriveSlug(fallbackSource);
  return { ok: true, slug: derived || `${modelPrefix}-${Date.now()}` };
}

type SlugModel = "artist" | "song" | "event" | "eventSeries" | "album";

/**
 * Auto-derive a slug + ensure it's unique against the model's table.
 * Layers `ensureUnique` (DB existence check + `-N` suffix) on top of
 * `deriveSlug`. Falls back to `${model}-${Date.now()}` if even
 * transliteration produces "".
 *
 * Used by `POST /api/admin/songs` for the auto-generated slug path.
 * Variants legitimately share `originalTitle` (e.g. "Dream Believers"
 * + "Dream Believers (SAKURA Ver.)" both produce `dream-believers`),
 * so the existence-check + auto-suffix semantics are needed regardless
 * of concurrency — a non-shipped DB-uniqueness layer would force the
 * operator to manually disambiguate every variant.
 */
export async function generateUniqueSlug(
  input: string,
  model: SlugModel
): Promise<string> {
  const base = (await deriveSlug(input)) || `${model}-${Date.now()}`;
  return await ensureUnique(base, model);
}

async function ensureUnique(
  base: string,
  model: SlugModel
): Promise<string> {
  let candidate = base;
  let count = 1;

  while (await slugExists(candidate, model)) {
    candidate = `${base}-${count}`;
    count++;
  }

  return candidate;
}

async function slugExists(
  slug: string,
  model: SlugModel
): Promise<boolean> {
  const { prisma } = await import("@/lib/prisma");
  switch (model) {
    case "artist":
      return !!(await prisma.artist.findUnique({ where: { slug } }));
    case "song":
      return !!(await prisma.song.findUnique({ where: { slug } }));
    case "event":
      return !!(await prisma.event.findUnique({ where: { slug } }));
    case "eventSeries":
      return !!(await prisma.eventSeries.findUnique({ where: { slug } }));
    case "album":
      return !!(await prisma.album.findUnique({ where: { slug } }));
  }
}

// Kuroshiro singleton for Japanese → romaji transliteration
let kuroshiroInstance: import("kuroshiro").default | null = null;

async function getKuroshiro(): Promise<import("kuroshiro").default> {
  if (!kuroshiroInstance) {
    const Kuroshiro = (await import("kuroshiro")).default;
    const KuromojiAnalyzer = (await import("kuroshiro-analyzer-kuromoji"))
      .default;
    kuroshiroInstance = new Kuroshiro();
    await kuroshiroInstance.init(new KuromojiAnalyzer());
  }
  return kuroshiroInstance;
}

/**
 * Converts Japanese text to romaji for slug generation.
 * "ハナムスビ" → "hanamusubi"
 * "上昇気流にのせて" → "joushoukiryuuninosete"
 *
 * Returns "" on any failure so the caller can fall through to the
 * timestamp slug. Errors are reported to Sentry with the input text
 * — silently swallowing was masking a Vercel dict-tracing bug
 * (kuroshiro init failed because the kuromoji dict files weren't
 * bundled into the function), and we want any future regression
 * here to be visible.
 */
async function transliterateToRomaji(input: string): Promise<string> {
  try {
    const k = await getKuroshiro();
    return await k.convert(input, { to: "romaji", mode: "spaced" });
  } catch (e) {
    // Lazy-import Sentry so this module stays safe to import in
    // contexts where Sentry isn't initialized (tests, scripts).
    const Sentry = await import("@sentry/nextjs").catch(() => null);
    Sentry?.captureException(e, {
      tags: { source: "transliterateToRomaji" },
      extra: { input },
    });
    return "";
  }
}

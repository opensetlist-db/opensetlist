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

// Trim + normalize an admin-supplied slug, falling back to the source string and
// then to `${modelPrefix}-{timestamp}` when both normalize to "" (e.g. an all-
// non-ASCII translation name like "上昇気流"). Always returns a non-empty value so
// callers can rely on never persisting an empty slug.
export function resolveAdminSlug(
  rawSlug: unknown,
  fallbackSource: string,
  modelPrefix: string
): string {
  const trimmed = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (trimmed) {
    const normalized = generateSlug(trimmed);
    if (normalized) return normalized;
  }
  const fromSource = generateSlug(fallbackSource);
  if (fromSource) return fromSource;
  return `${modelPrefix}-${Date.now()}`;
}

type SlugModel = "artist" | "song" | "event" | "eventSeries" | "album";

/**
 * Generates a unique slug for a given model.
 * Handles Japanese/Korean via transliteration.
 * Appends incrementing number if slug already exists.
 */
export async function generateUniqueSlug(
  input: string,
  model: SlugModel
): Promise<string> {
  let base = generateSlug(input);

  if (!base) {
    base = generateSlug(await transliterateToRomaji(input));
  }

  if (!base) {
    base = `${model}-${Date.now()}`;
  }

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

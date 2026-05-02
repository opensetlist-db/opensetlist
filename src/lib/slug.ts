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

// Strict admin slug resolution.
//
// - If `rawSlug` is a non-empty string, the trimmed value MUST already
//   be in canonical slug form (lowercase alphanumeric + hyphens, no
//   leading/trailing hyphens, ≤100 chars). We round-trip through
//   `generateSlug` and reject if anything changes — silent
//   normalization is surprising, and operators should be told their
//   slug is invalid rather than have it quietly rewritten.
//
// - If `rawSlug` is absent/blank, auto-derive from `fallbackSource`
//   via `generateSlug`, falling back to `${modelPrefix}-${Date.now()}`
//   when the source itself strips to "" (e.g. all-non-ASCII input
//   like "上昇気流"). Always returns a non-empty slug on the auto path
//   so callers never persist an empty value.
//
// Result-shape return so the caller can map `{ ok: false }` to a 400
// response and `{ ok: true }` to a normal create.
export function resolveCanonicalSlug(
  rawSlug: unknown,
  fallbackSource: string,
  modelPrefix: string
): { ok: true; slug: string } | { ok: false; message: string } {
  if (typeof rawSlug === "string" && rawSlug.trim()) {
    const trimmed = rawSlug.trim();
    const canonical = generateSlug(trimmed);
    if (!canonical || canonical !== trimmed) {
      return {
        ok: false,
        message:
          "슬러그는 영소문자, 숫자, 하이픈으로만 구성된 URL-safe 형식이어야 합니다 (예: my-slug).",
      };
    }
    return { ok: true, slug: trimmed };
  }
  const fromSource = generateSlug(fallbackSource);
  return { ok: true, slug: fromSource || `${modelPrefix}-${Date.now()}` };
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
 */
async function transliterateToRomaji(input: string): Promise<string> {
  try {
    const k = await getKuroshiro();
    return await k.convert(input, { to: "romaji", mode: "spaced" });
  } catch {
    return "";
  }
}

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

// Trim + normalize an admin-supplied slug; fall back to deriving from a source
// string if the input was missing, blank, or normalized to "".
export function resolveAdminSlug(rawSlug: unknown, fallbackSource: string): string {
  const trimmed = typeof rawSlug === "string" ? rawSlug.trim() : "";
  const fallback = generateSlug(fallbackSource);
  if (!trimmed) return fallback;
  return generateSlug(trimmed) || fallback;
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

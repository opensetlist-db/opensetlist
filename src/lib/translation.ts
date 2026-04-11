import { prisma } from "./prisma";

/**
 * Apply dictionary substitutions to text before sending to translation API.
 * Replaces known surface forms with canonical text or placeholders (preserve).
 */
export async function applyDictionary(
  text: string,
  sourceLang: string,
  targetLang: string
): Promise<string> {
  const surfaces = await prisma.dictionaryTermSurface.findMany({
    where: {
      locale: { in: [sourceLang, "*"] },
      term: { isApproved: true },
    },
    include: { term: { include: { overrides: true } } },
  });

  let result = text;

  for (const surface of surfaces) {
    if (!result.includes(surface.text)) continue;

    const term = surface.term;

    if (term.preserve) {
      // Pattern A: keep as-is, wrap in placeholder to protect from API
      result = result.replace(surface.text, `__DICT_${term.id}__`);
      continue;
    }

    // Check for a specific override for this pair
    const override = term.overrides.find(
      (o) => o.sourceLang === sourceLang && o.targetLang === targetLang
    );

    const substitution = override?.overrideText ?? term.canonicalText;
    result = result.replace(surface.text, substitution);
  }

  return result;
}

/**
 * Restore preserved dictionary terms from placeholders after translation.
 */
export function restorePreservedTerms(
  translated: string,
  surfaces: Array<{
    text: string;
    term: { id: string; preserve: boolean };
  }>
): string {
  let result = translated;
  for (const surface of surfaces) {
    if (!surface.term.preserve) continue;
    result = result.replace(`__DICT_${surface.term.id}__`, surface.text);
  }
  return result;
}

/**
 * Submit a dictionary entry from the user-facing form.
 * Creates a DictionaryTerm + surfaces, or adds an Override if the term already exists.
 */
export async function submitDictionaryEntry(input: {
  sourceText: string;
  sourceLang: string;
  targetText: string;
  targetLang: string;
  preserve: boolean;
  category: "character_name" | "song_title" | "event_name" | "fandom_term" | "abbreviation" | "meme" | "preserve";
  createdBy: string;
}) {
  const { sourceText, sourceLang, targetText, targetLang, preserve } = input;

  // Check if a Term already exists for this sourceText + locale
  const existingSurface = await prisma.dictionaryTermSurface.findFirst({
    where: { text: sourceText, locale: sourceLang },
    include: { term: true },
  });

  if (existingSurface) {
    // Term exists — check if we need a new Override
    const termId = existingSurface.termId;
    const currentCanonical = existingSurface.term.canonicalText;

    if (targetText !== currentCanonical) {
      // Different from canonical → add as Override for this specific pair
      await prisma.dictionaryOverride.upsert({
        where: {
          termId_sourceLang_targetLang: { termId, sourceLang, targetLang },
        },
        create: {
          termId,
          sourceLang,
          targetLang,
          overrideText: targetText,
          createdBy: input.createdBy,
        },
        update: { overrideText: targetText },
      });
    }

    return { termId, action: "override" as const };
  } else {
    // New Term — create Term + surfaces
    const term = await prisma.dictionaryTerm.create({
      data: {
        canonicalText: preserve ? sourceText : targetText,
        preserve,
        category: input.category,
        isApproved: false,
        createdBy: input.createdBy,
        surfaces: {
          create: [
            { locale: sourceLang, text: sourceText },
            ...(sourceLang !== targetLang
              ? [{ locale: targetLang, text: targetText }]
              : []),
          ],
        },
      },
    });

    return { termId: term.id, action: "created" as const };
  }
}

/**
 * Whether to show the "번역보기" button for a comment.
 * Returns false if the comment's detected locale is in the user's known locales.
 */
export function shouldShowTranslateButton(
  detectedLocale: string | null | undefined,
  knownLocales: string[]
): boolean {
  if (!detectedLocale) return false;
  return !knownLocales.includes(detectedLocale);
}

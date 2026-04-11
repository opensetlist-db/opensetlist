import { NextRequest, NextResponse } from "next/server";
import { generateSlug } from "@/lib/slug";

// Lazy-load kuroshiro only when needed
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

async function toSlug(input: string): Promise<string> {
  // Try ASCII first
  let slug = generateSlug(input);
  if (slug) return slug;

  // Transliterate Japanese/Korean
  try {
    const k = await getKuroshiro();
    const romaji = await k.convert(input, { to: "romaji", mode: "spaced" });
    slug = generateSlug(romaji);
    if (slug) return slug;
  } catch {
    // fall through
  }

  return "";
}

export async function POST(request: NextRequest) {
  const { names, prefix } = (await request.json()) as {
    names: string[];
    prefix?: string;
  };

  const results = await Promise.all(
    names.map(async (name) => {
      const slug = await toSlug(name);
      const full = prefix && slug ? `${prefix}-${slug}` : slug;
      return { original: name, slug: full || `(변환 실패: ${name})` };
    })
  );

  return NextResponse.json(results);
}

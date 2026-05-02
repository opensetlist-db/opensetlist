import { NextRequest, NextResponse } from "next/server";
import { deriveSlug } from "@/lib/slug";

// Preview endpoint for the admin Slug 생성기 page. Batches a list of
// names through the same deriveSlug pipeline that every admin POST
// route uses on its auto-fallback path — so previewing a name here
// is a true preview of "what slug would saving this name produce".
//
// Returns "" → "(변환 실패: ...)" so the operator sees explicitly when
// transliteration produced nothing (e.g. all-symbol input). Korean
// fallback string per CLAUDE.md admin-route exemption.
export async function POST(request: NextRequest) {
  const { names, prefix } = (await request.json()) as {
    names: string[];
    prefix?: string;
  };

  const results = await Promise.all(
    names.map(async (name) => {
      const slug = await deriveSlug(name);
      const full = prefix && slug ? `${prefix}-${slug}` : slug;
      return { original: name, slug: full || `(변환 실패: ${name})` };
    })
  );

  return NextResponse.json(results);
}

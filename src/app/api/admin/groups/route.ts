import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { resolveOriginalLanguage } from "@/lib/csv-parse";

export async function GET() {
  const groups = await prisma.group.findMany({
    include: { translations: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(serializeBigInt(groups));
}

type IncomingTranslation = {
  locale: string;
  name: string;
  shortName?: string | null;
  description?: string | null;
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    type,
    category,
    hasBoard,
    translations,
    originalName,
    originalShortName,
    originalDescription,
    originalLanguage,
  } = body;

  const trimmedOriginalName = typeof originalName === "string" ? originalName.trim() : "";
  if (!trimmedOriginalName) {
    return NextResponse.json(
      { error: "originalName is required" },
      { status: 400 }
    );
  }

  let resolvedOriginalLanguage: string;
  try {
    resolvedOriginalLanguage = resolveOriginalLanguage(originalLanguage);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const group = await prisma.group.create({
    data: {
      type: type || null,
      category: category || null,
      hasBoard: hasBoard ?? false,
      originalName: trimmedOriginalName,
      originalShortName: originalShortName?.trim() || null,
      originalDescription: originalDescription?.trim() || null,
      originalLanguage: resolvedOriginalLanguage,
      translations: {
        create: translations.map((t: IncomingTranslation) => ({
          locale: t.locale,
          name: t.name,
          shortName: t.shortName?.trim() || null,
          description: t.description?.trim() || null,
        })),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(group), { status: 201 });
}

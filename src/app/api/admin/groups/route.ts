import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";

export async function GET() {
  const groups = await prisma.group.findMany({
    include: { translations: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(serializeBigInt(groups));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, category, hasBoard, translations } = body;

  const group = await prisma.group.create({
    data: {
      type: type || null,
      category: category || null,
      hasBoard: hasBoard ?? false,
      translations: {
        create: translations.map(
          (t: { locale: string; name: string; description?: string }) => ({
            locale: t.locale,
            name: t.name,
            description: t.description || null,
          })
        ),
      },
    },
    include: { translations: true },
  });
  return NextResponse.json(serializeBigInt(group), { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { StageIdentityType } from "@/generated/prisma/enums";
import {
  badRequest,
  enumValue,
  nullableInt,
  parseJsonBody,
} from "@/lib/admin-input";
import { parseStageIdentityTranslations } from "@/app/api/admin/artists/_validate";

type Props = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  // Validate before touching the DB, like the sibling admin routes: a
  // missing / malformed `translations` used to reach `translations.map`
  // and 500 — worse, it would 500 only after nothing was written, so
  // the operator got no hint which field was wrong.
  const parsedBody = await parseJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;
  const { color } = body;

  // Names are delete-and-recreate (below), so the array is required and
  // must be non-empty — an empty one would leave the identity nameless.
  const translations = parseStageIdentityTranslations(body.translations, "translations");
  if (!translations.ok) return badRequest(translations.message);

  // `type` is optional (absent / null → keep the stored one), but a
  // present value must be a real enum member; otherwise Prisma rejects
  // it mid-transaction with a 500.
  let type: StageIdentityType | undefined;
  if (body.type !== undefined && body.type !== null) {
    const parsedType = enumValue(body.type, "type", Object.values(StageIdentityType));
    if (!parsedType.ok) return badRequest(parsedType.message);
    type = parsedType.value;
  }

  // `sortOrder` is preserve-on-missing, like the artist display fields
  // (`parseArtistDisplayFields`): a body without the key leaves the
  // stored order alone, so a caller that predates the field cannot
  // wipe the official member order. Present → authoritative; "" / null
  // clears it.
  let sortOrder: number | null | undefined;
  if ("sortOrder" in body) {
    const parsed = nullableInt(body.sortOrder, "sortOrder");
    if (!parsed.ok) return badRequest(parsed.message);
    sortOrder = parsed.value;
  }

  // Delete-and-recreate of translations in one transaction, so a failed
  // update can't leave the identity without names (and an un-expired
  // public cache). Matches the DELETE handler below.
  const [, si] = await prisma.$transaction([
    prisma.stageIdentityTranslation.deleteMany({
      where: { stageIdentityId: id },
    }),
    prisma.stageIdentity.update({
      where: { id },
      data: {
        type,
        color: (color as string | null | undefined) || null,
        sortOrder,
        translations: {
          create: translations.value.map((t) => ({
            locale: t.locale,
            name: t.name,
          })),
        },
      },
      include: { translations: true },
    }),
  ]);
  revalidatePublicData();
  return NextResponse.json(serializeBigInt(si));
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  await prisma.$transaction([
    prisma.realPersonStageIdentity.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentityTranslation.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentityArtist.deleteMany({ where: { stageIdentityId: id } }),
    prisma.setlistItemMember.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentity.delete({ where: { id } }),
  ]);

  revalidatePublicData();
  return NextResponse.json({ ok: true });
}

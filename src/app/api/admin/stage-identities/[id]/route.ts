import { checkIdentityNames, identityTranslations } from "@/lib/adminIdentityNames";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { serializeBigInt } from "@/lib/utils";
import { revalidatePublicData } from "@/lib/dataCache";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { StageIdentityType } from "@/generated/prisma/enums";
import {
  badRequest,
  enumValue,
  nullableHexColor,
  nullableInt,
  nullableString,
  originalLanguage as parseOriginalLanguage,
  requireString,
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

  const translations = identityTranslations(body.translations, (raw) => parseStageIdentityTranslations(raw, "translations"));
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

  // Hex only (#rgb / #rrggbb): the value is interpolated into inline
  // styles on the public pages, and a non-string used to be coerced by
  // `|| null` into whatever Prisma made of it — a 500 for an object, a
  // silently stored "green" for a bare string.
  let color: string | null | undefined;
  if ("color" in body) {
    const parsed = nullableHexColor(body.color, "color");
    if (!parsed.ok) return badRequest(parsed.message);
    color = parsed.value;
  }

  let sortOrder: number | null | undefined;
  if ("sortOrder" in body) {
    const parsed = nullableInt(body.sortOrder, "sortOrder");
    if (!parsed.ok) return badRequest(parsed.message);
    sortOrder = parsed.value;
  }

  const name = body.originalName === undefined ? undefined : requireString(body.originalName, "originalName");
  if (name && !name.ok) return badRequest(name.message);
  const shortName = body.originalShortName === undefined ? undefined : nullableString(body.originalShortName, "originalShortName");
  if (shortName && !shortName.ok) return badRequest(shortName.message);
  const language = body.originalLanguage === undefined ? undefined : parseOriginalLanguage(body.originalLanguage);
  if (language && !language.ok) return badRequest(language.message);
  const rows = translations.value;

  try {
    const stageIdentity = await prisma.$transaction(async (tx) => {
      const stored = await tx.stageIdentity.findUnique({
        where: { id: id },
        include: { translations: true },
      });
      if (!stored) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });
      const message = checkIdentityNames("멤버", {
        originalName: name?.value ?? stored.originalName,
        originalShortName: shortName ? shortName.value : stored.originalShortName,
        originalLanguage: language?.value ?? stored.originalLanguage,
        translations: rows,
        sameNameConfirmations: translations.sameNameConfirmations,
      }, stored);
      if (message) return badRequest(message);
      return tx.stageIdentity.update({
        where: { id },
        data: {
          type, color, sortOrder,
          originalName: name?.value,
          originalShortName: shortName?.value,
          originalLanguage: language?.value,
          translations: { upsert: rows.map((row) => ({
            where: { stageIdentityId_locale: { stageIdentityId: id, locale: row.locale } },
            create: row,
            update: { name: row.name, shortName: row.shortName },
          })) },
        },
        include: { translations: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (stageIdentity instanceof NextResponse) return stageIdentity;
    revalidatePublicData();
    return NextResponse.json(serializeBigInt(stageIdentity));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "동시에 수정되었습니다. 다시 불러온 뒤 저장하세요." }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;

  await prisma.$transaction([
    prisma.realPersonStageIdentity.deleteMany({ where: { stageIdentityId: id } }),
    // eslint-disable-next-line no-restricted-syntax -- whole-entity DELETE, not a save: every row goes with the entity
    prisma.stageIdentityTranslation.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentityArtist.deleteMany({ where: { stageIdentityId: id } }),
    prisma.setlistItemMember.deleteMany({ where: { stageIdentityId: id } }),
    prisma.stageIdentity.delete({ where: { id } }),
  ]);

  revalidatePublicData();
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
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
  parseJsonBody,
} from "@/lib/admin-input";
import { parseStageIdentityTranslations } from "@/app/api/admin/artists/_validate";

type Props = { params: Promise<{ id: string }> };

/**
 * Per-member edit. Every field here is "the body owns what it sends,
 * and only that":
 *
 *   - `translations` are upserted per locale, like the members CSV
 *     import (`import/route.ts`), NOT delete-and-recreate like the
 *     artist PUT. The artist form owns every ArtistTranslation field
 *     (it loads and resubmits name / shortName / bio for each locale),
 *     so recreating from its payload loses nothing. The member row of
 *     that same form only holds ONE ko name — it never loads ja / en or
 *     any shortName — so a recreate from its payload wiped every other
 *     locale and every shortName on each 저장. Upserting means a
 *     locale absent from the body keeps its row, and `shortName` is
 *     written only when the item carries the key (`null` / "" clears
 *     it). Removing a locale is therefore not possible through this
 *     route; nothing in the admin UI needs it.
 *   - `type`, `color`, `sortOrder` are preserve-on-missing, matching
 *     `parseArtistDisplayFields`: a body without the key leaves the
 *     column alone; a present value is authoritative ("" / null clears
 *     colour and order). A caller that predates a field (an old tab, a
 *     script) therefore cannot blank it.
 */
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

  // Required and non-empty even though absent locales are kept: a save
  // that names nothing is a client bug, not a "touch only scalars"
  // request, and the create paths share this parser.
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

  // One sequential transaction so a failed upsert cannot leave the
  // scalars updated with half the names changed (and an un-expired
  // public cache). The final read returns the identity with ALL its
  // locales, including the ones the body did not send — the form's
  // row re-renders from it.
  const results = await prisma.$transaction([
    prisma.stageIdentity.update({
      where: { id },
      data: { type, color, sortOrder },
    }),
    ...translations.value.map((t) =>
      prisma.stageIdentityTranslation.upsert({
        where: { stageIdentityId_locale: { stageIdentityId: id, locale: t.locale } },
        create: {
          stageIdentityId: id,
          locale: t.locale,
          name: t.name,
          shortName: t.shortName ?? null,
        },
        // `shortName: undefined` is dropped by Prisma = column untouched.
        update: { name: t.name, shortName: t.shortName },
      })
    ),
    prisma.stageIdentity.findUniqueOrThrow({
      where: { id },
      include: { translations: true },
    }),
  ]);
  const si = results[results.length - 1];
  revalidatePublicData();
  return NextResponse.json(serializeBigInt(si));
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

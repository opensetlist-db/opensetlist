import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { verifyAdminAPI } from "@/lib/admin-auth";
import { badRequest, nullableString, originalLanguage, parseJsonBody, requireString } from "@/lib/admin-input";
import { checkIdentityNames, identityTranslations } from "@/lib/adminIdentityNames";
import { revalidatePublicData } from "@/lib/dataCache";
import { prisma } from "@/lib/prisma";
import { parseRealPersonTranslations } from "../../artists/_validate";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await verifyAdminAPI();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const name = body.originalName === undefined ? undefined : requireString(body.originalName, "originalName");
  if (name && !name.ok) return badRequest(name.message);
  const language = body.originalLanguage === undefined ? undefined : originalLanguage(body.originalLanguage);
  if (language && !language.ok) return badRequest(language.message);
  const shortName = body.originalShortName === undefined ? undefined : nullableString(body.originalShortName, "originalShortName");
  if (shortName && !shortName.ok) return badRequest(shortName.message);
  const stageName = body.originalStageName === undefined ? undefined : nullableString(body.originalStageName, "originalStageName");
  if (stageName && !stageName.ok) return badRequest(stageName.message);
  const translations = identityTranslations(body.translations, (raw) => parseRealPersonTranslations(raw, "translations"));
  if (!translations.ok) return badRequest(translations.message);

  try {
    const person = await prisma.$transaction(async (tx) => {
      const stored = await tx.realPerson.findUnique({ where: { id }, include: { translations: true } });
      if (!stored) return NextResponse.json({ error: "인물을 찾을 수 없습니다." }, { status: 404 });
      const message = checkIdentityNames("인물", {
        originalName: name?.value ?? stored.originalName,
        originalLanguage: language?.value ?? stored.originalLanguage,
        originalShortName: shortName ? shortName.value : stored.originalShortName,
        originalStageName: stageName ? stageName.value : stored.originalStageName,
        translations: translations.value,
        sameNameConfirmations: translations.sameNameConfirmations,
      }, stored);
      if (message) return badRequest(message);
      return tx.realPerson.update({
        where: { id },
        data: {
          originalName: name?.value,
          originalLanguage: language?.value,
          originalShortName: shortName?.value,
          originalStageName: stageName?.value,
          translations: { upsert: translations.value.map(({ locale, ...data }) => ({
            where: { realPersonId_locale: { realPersonId: id, locale } },
            create: { locale, ...data },
            update: data,
          })) },
        },
        include: { translations: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (person instanceof NextResponse) return person;
    revalidatePublicData();
    return NextResponse.json(person);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return NextResponse.json({ error: "동시에 수정되었습니다. 다시 불러온 뒤 저장하세요." }, { status: 409 });
    }
    throw error;
  }
}

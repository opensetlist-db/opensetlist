import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function ensureStageIdentitiesExist(
  ids: string[]
): Promise<NextResponse | null> {
  if (ids.length === 0) return null;
  const unique = Array.from(new Set(ids));
  const found = await prisma.stageIdentity.findMany({
    where: { id: { in: unique } },
    select: { id: true },
  });
  const foundSet = new Set(found.map((r) => r.id));
  const missing = unique.filter((id) => !foundSet.has(id));
  if (missing.length === 0) return null;
  return NextResponse.json(
    { error: "Unknown stageIdentityId(s)", missingIds: missing },
    { status: 400 }
  );
}

export type EventTranslationInput = {
  locale: string;
  name: string;
  shortName: string | null;
  city: string | null;
  venue: string | null;
};

function nullableString(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

export function validateEventTranslations(
  raw: unknown
):
  | { ok: true; value: EventTranslationInput[] }
  | { ok: false; response: NextResponse } {
  const reject = (msg: string) => ({
    ok: false as const,
    response: NextResponse.json({ error: msg }, { status: 400 }),
  });
  if (!Array.isArray(raw) || raw.length === 0) {
    return reject("translations must be a non-empty array");
  }
  const out: EventTranslationInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return reject(`translations[${i}] must be an object`);
    }
    const t = item as Record<string, unknown>;
    if (typeof t.locale !== "string" || t.locale.length === 0) {
      return reject(`translations[${i}].locale must be a non-empty string`);
    }
    if (typeof t.name !== "string" || t.name.length === 0) {
      return reject(`translations[${i}].name must be a non-empty string`);
    }
    const shortName = nullableString(t.shortName);
    if (!shortName.ok) return reject(`translations[${i}].shortName must be string or null`);
    const city = nullableString(t.city);
    if (!city.ok) return reject(`translations[${i}].city must be string or null`);
    const venue = nullableString(t.venue);
    if (!venue.ok) return reject(`translations[${i}].venue must be string or null`);
    out.push({
      locale: t.locale,
      name: t.name,
      shortName: shortName.value,
      city: city.value,
      venue: venue.value,
    });
  }
  return { ok: true, value: out };
}

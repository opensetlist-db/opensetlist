import { prisma } from "@/lib/prisma";
import { isOfficialRank } from "./officialOrder";

/** A blank cell preserves; only the exact sentinel clears a relation rank. */
export function parseMembershipRank(raw: string | undefined): number | null | undefined | "invalid" {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value === "__CLEAR__") return null;
  if (!/^-?\d+$/.test(value)) return "invalid";
  const number = Number(value);
  return isOfficialRank(number) ? number : "invalid";
}

export async function importMembershipOrders(rows: readonly Record<string, string>[]) {
  let count = 0;
  const log: string[] = [];
  for (const [index, row] of rows.entries()) {
    const label = `Row ${index + 2} (${row.artistSlug ?? ""}/${row.memberSlug ?? ""})`;
    const sortOrder = parseMembershipRank(row.sortOrder);
    if (!row.artistSlug || !row.memberSlug || sortOrder === "invalid") {
      log.push(`ERROR: ${label}: artistSlug/memberSlug and signed 32-bit sortOrder or __CLEAR__ required`);
      continue;
    }
    // A row transaction changes only this pair's rank. It never upserts
    // identities, memberships, dates, translations or performance facts.
    try {
      const result = await prisma.$transaction(async (tx) => {
        const artist = await tx.artist.findFirst({ where: { slug: row.artistSlug, isDeleted: false }, select: { id: true } });
        const member = await tx.stageIdentity.findUnique({ where: { slug: row.memberSlug }, select: { id: true } });
        if (!artist || !member) return "missing";
        const where = { stageIdentityId: member.id, artistId: artist.id };
        const relation = await tx.stageIdentityArtist.findUnique({ where: { stageIdentityId_artistId: where } });
        if (!relation) return "missing";
        if (sortOrder === undefined || relation.sortOrder === sortOrder) return "preserved";
        await tx.stageIdentityArtist.update({ where: { stageIdentityId_artistId: where }, data: { sortOrder } });
        return "updated";
      });
      if (result === "missing") log.push(`ERROR: ${label}: artist, member or existing membership not found (no relation created)`);
      else if (result === "preserved") log.push(`PRESERVED: ${label}`);
      else { count++; log.push(`UPDATED: ${label}: ${sortOrder === null ? "cleared" : sortOrder}`); }
    } catch {
      // Other rows may already have committed; the caller expires public
      // and writer-warm caches even for partial imports.
      log.push(`ERROR: ${label}: row rolled back; retry this row`);
    }
  }
  return { count, log };
}

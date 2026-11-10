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
  const parsed = rows.map((row) => ({
    row,
    pair: JSON.stringify([row.artistSlug, row.memberSlug]),
    sortOrder: parseMembershipRank(row.sortOrder),
  }));
  const desired = new Map<string, number | null>();
  const conflicts = new Set<string>();
  for (const { row, pair, sortOrder } of parsed) {
    if (!row.artistSlug || !row.memberSlug || sortOrder === "invalid" || sortOrder === undefined) continue;
    if (desired.has(pair) && desired.get(pair) !== sortOrder) conflicts.add(pair);
    desired.set(pair, sortOrder);
  }
  for (const [index, { row, pair, sortOrder }] of parsed.entries()) {
    const label = `Row ${index + 2} (${row.artistSlug ?? ""}/${row.memberSlug ?? ""})`;
    if (!row.artistSlug || !row.memberSlug || sortOrder === "invalid") {
      log.push(`ERROR: ${label}: artistSlug/memberSlug and signed 32-bit sortOrder or __CLEAR__ required`);
      continue;
    }
    if (conflicts.has(pair)) {
      log.push(`ERROR: ${label}: conflicting ranks for the same membership`);
      continue;
    }
    // A row transaction changes only this pair's rank. It never upserts
    // identities, memberships, dates, translations or performance facts.
    try {
      const result = await prisma.$transaction(async (tx) => {
        const artist = await tx.artist.findFirst({ where: { slug: row.artistSlug, isDeleted: false }, select: { id: true } });
        const member = await tx.stageIdentity.findUnique({ where: { slug: row.memberSlug }, select: { id: true } });
        if (!artist || !member) return "missing";
        const where = { stageIdentityId: member.id, artistId: artist.id, artist: { isDeleted: false } };
        if (sortOrder !== undefined) {
          const result = await tx.stageIdentityArtist.updateMany({
            where: { ...where, ...(sortOrder === null
              ? { sortOrder: { not: null } }
              : { OR: [{ sortOrder: null }, { sortOrder: { not: sortOrder } }] }) },
            data: { sortOrder },
          });
          if (result.count) return "updated";
        }
        const relation = await tx.stageIdentityArtist.findFirst({ where, select: { id: true } });
        return relation ? "preserved" : "missing";
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

import type { Prisma } from "@/generated/prisma/client";

export class ArtistParentCycleError extends Error {
  constructor() {
    super("부모 아티스트 관계에 순환이 생깁니다. 부모 관계를 확인해 주세요.");
  }
}

/**
 * Call inside the same transaction as the parent write, before other edits.
 * A shared transaction lock serializes form and CSV ancestry checks, including
 * simultaneous A→B / B→A edits. Deleted ancestors still participate in cycles.
 */
export async function validateArtistParent(tx: Prisma.TransactionClient, artistId: bigint, parentId: bigint | null) {
  if (parentId === null) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"admin-artist-parent"}, 0))`;
  const rows = await tx.artist.findMany({ select: { id: true, parentArtistId: true } });
  const parents = new Map(rows.map((row) => [row.id, row.parentArtistId]));
  const seen = new Set<bigint>([artistId]);
  let current: bigint | null = parentId;
  while (current !== null) {
    if (seen.has(current)) throw new ArtistParentCycleError();
    seen.add(current);
    current = parents.get(current) ?? null;
  }
}

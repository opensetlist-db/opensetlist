import type { Prisma } from "@/generated/prisma/client";
import { byStageIdentityOrderBy, compareMemberOrder, type MemberOrderKey } from "./memberOrder";

/** Decimal strings cross JSON boundaries without losing BigInt precision. */
export type ArtistOrderId = bigint | string | number;

export interface ArtistOrderKey {
  readonly id: ArtistOrderId;
  readonly parentArtistId: ArtistOrderId | null;
  readonly type: "group" | "unit" | "solo";
  readonly sortOrder: number | null;
}

export interface ArtistDisplayKey {
  readonly artistId: ArtistOrderId;
  /** Supply only the existing event guest classification, never infer it. */
  readonly isGuest?: boolean;
}

export interface MemberDisplayKey extends MemberOrderKey {
  /** Already resolved legal group contexts, NOT all historical memberships. */
  readonly groupArtistIds: readonly ArtistOrderId[];
  readonly membershipOrders: readonly {
    readonly artistId: ArtistOrderId;
    readonly sortOrder: number | null;
  }[];
  readonly isGuest?: boolean;
}

export type MemberDisplayContext =
  | { readonly kind: "artist"; readonly artistId: ArtistOrderId }
  | { readonly kind: "mixed" }
  | {
      readonly kind: "credits";
      /**
       * Only explicit unit credits that passed the consumer's existing
       * badge/credit eligibility rule. IDs are the actual performers in
       * that credit, never a unit's entire membership. Solo/group credits
       * are not unit contexts; full_group/no-credit use mixed/group order.
       */
      readonly eligibleUnitCredits: readonly {
        readonly artistId: ArtistOrderId;
        readonly stageIdentityIds: readonly string[];
      }[];
    };

/** Shared validation for display metadata, including explicit null clears. */
export function isOfficialRank(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" && Number.isInteger(value) &&
    value >= -2_147_483_648 && value <= 2_147_483_647
  );
}

function rank(value: number | null): number | null {
  if (!isOfficialRank(value)) throw new RangeError("Official rank must be null or a signed 32-bit integer");
  return value;
}

function artistId(value: ArtistOrderId): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RangeError("Artist ID numbers must be safe integers; use bigint or decimal strings");
  }
  if (!/^[0-9]+$/.test(String(value))) throw new RangeError("Artist ID must be an unsigned decimal integer");
  return BigInt(value).toString();
}

function compareId(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
}

function compareRank(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/**
 * For a StageIdentityArtist query restricted to ONE artist. A mixed
 * relation query needs the hierarchy/context API below instead. Fresh
 * literals keep Prisma callers from mutating shared ordering metadata.
 */
export function membershipOrderBy(): Prisma.StageIdentityArtistOrderByWithRelationInput[] {
  return [{ sortOrder: { sort: "asc", nulls: "last" } }, ...byStageIdentityOrderBy()];
}

/**
 * One immutable metadata snapshot, shared by SSR/DTO/client derivation.
 * Load active hierarchy and required relation ranks in batches from the
 * same consistent read. This pure module performs no I/O or eligibility,
 * affiliation, representative-artist, date or role decisions. Call within
 * each existing role/category section, never across semantic song ranks.
 */
export function createOfficialOrdering(artists: readonly ArtistOrderKey[]) {
  const nodes = new Map<string, { parent: string | null; type: ArtistOrderKey["type"]; rank: number | null }>();
  for (const row of artists) {
    const id = artistId(row.id);
    if (nodes.has(id)) throw new Error(`Duplicate artist ordering metadata: ${id}`);
    nodes.set(id, {
      parent: row.parentArtistId === null ? null : artistId(row.parentArtistId),
      type: row.type,
      rank: rank(row.sortOrder),
    });
  }
  const paths = new Map<string, readonly string[]>();
  function path(id: string): readonly string[] {
    const cached = paths.get(id);
    if (cached) return cached;
    const reverse: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current !== null && nodes.has(current)) {
      if (seen.has(current)) throw new Error("Cyclic artist ordering metadata");
      seen.add(current);
      reverse.push(current);
      current = nodes.get(current)!.parent;
    }
    // A missing/deleted ancestor terminates the path at the last known
    // node. Unknown displayed artists still get a numeric-ID fallback.
    const result = reverse.length ? reverse.reverse() : [id];
    paths.set(id, result);
    return result;
  }
  for (const id of nodes.keys()) path(id);

  function compareArtists(a: ArtistOrderId, b: ArtistOrderId): number {
    const aa = path(artistId(a));
    const bb = path(artistId(b));
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
      if (aa[i] === bb[i]) continue;
      return compareRank(nodes.get(aa[i])?.rank ?? null, nodes.get(bb[i])?.rank ?? null) || compareId(aa[i], bb[i]);
    }
    return aa.length - bb.length;
  }

  function sortArtists<T>(items: readonly T[], key: (item: T) => ArtistDisplayKey): T[] {
    return items.map((item) => ({ item, key: key(item) })).sort((a, b) =>
      Number(a.key.isGuest === true) - Number(b.key.isGuest === true) ||
      compareArtists(a.key.artistId, b.key.artistId),
    ).map(({ item }) => item);
  }

  function sortMembers<T>(items: readonly T[], key: (item: T) => MemberDisplayKey, context: MemberDisplayContext): T[] {
    const credits = new Map<string, Set<string>>();
    if (context.kind === "credits") {
      for (const credit of context.eligibleUnitCredits) {
        const id = artistId(credit.artistId);
        if (nodes.get(id)?.type !== "unit") throw new Error("Eligible unit credit must identify a loaded unit artist");
        const members = credits.get(id) ?? new Set<string>();
        for (const memberId of credit.stageIdentityIds) members.add(memberId);
        credits.set(id, members);
      }
    }
    const decorated = items.map((item) => {
      const source = key(item);
      const createdAt = source.createdAt instanceof Date ? source.createdAt.getTime() : Date.parse(source.createdAt);
      if (!Number.isFinite(createdAt)) throw new RangeError("Member createdAt must be a valid timestamp");
      const member: MemberOrderKey = { id: source.id, sortOrder: rank(source.sortOrder), createdAt: new Date(createdAt) };
      const orders = new Map<string, number | null>();
      for (const relation of source.membershipOrders) {
        const id = artistId(relation.artistId);
        if (orders.has(id)) throw new Error(`Duplicate member relation ordering metadata: ${id}`);
        orders.set(id, rank(relation.sortOrder));
      }
      let artist: string | undefined;
      let unit = false;
      if (context.kind === "artist") {
        artist = artistId(context.artistId);
      } else {
        const candidates = [...credits.keys()].filter((id) => credits.get(id)!.has(member.id));
        // An explicitly credited descendant is more specific than its
        // ancestor for this member only. Among unrelated units use the
        // official hierarchy order, never credit insertion order.
        artist = candidates.filter((id) => !candidates.some((other) =>
          other !== id && path(other).includes(id),
        )).sort(compareArtists)[0];
        unit = artist !== undefined;
        artist ??= source.groupArtistIds.map(artistId).filter((id) => nodes.get(id)?.type === "group").sort(compareArtists)[0];
      }
      return { item, member, artist, unit, relationRank: artist === undefined ? null : orders.get(artist) ?? null, guest: source.isGuest === true };
    });
    return decorated.sort((a, b) => {
      const guest = Number(a.guest) - Number(b.guest);
      if (guest) return guest;
      if (a.unit !== b.unit) return a.unit ? -1 : 1;
      if (a.artist !== b.artist) {
        if (a.artist === undefined) return 1;
        if (b.artist === undefined) return -1;
        const byArtist = compareArtists(a.artist, b.artist);
        if (byArtist) return byArtist;
      }
      return compareRank(a.relationRank, b.relationRank) || compareMemberOrder(a.member, b.member);
    }).map(({ item }) => item);
  }

  return { compareArtists, sortArtists, sortMembers };
}

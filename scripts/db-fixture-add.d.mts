export class UsageError extends Error {}

type Row = { key: string; slug: string; title: string; name?: string } & Record<string, unknown>;

type Asset = {
  owner: string;
  objectKey: string;
  publicUrl: string;
  mimeType: string;
  needsHead: boolean;
  width: number;
  height: number;
  /** Set from the HEAD's Content-Length before the insert (dev-bucket URLs). */
  byteSize?: number;
};

export function devBucketBase(raw: string | undefined): string | null;
export function assetKeyPrefix(slugPrefix: string): string;
export function runPrefix(prefix: string, ms: number): string;
export function slugBase(prefix: string): string;
export function buildPlan(
  spec: unknown,
  run: { prefix: string; ms: number; bucketBase?: string | null },
): {
  prefix: string;
  slugPrefix: string;
  ms: number;
  extras: Record<string, string | number | boolean>;
  albums: Row[];
  series: Row[];
  events: Row[];
  assets: Asset[];
  artistIds: string[];
  count: number;
};
export function rmCommand(
  prefix: string,
  ids: { series: string[]; events: string[]; albums: string[]; assets?: string[] },
  assetPrefix?: string | null,
): string;
export function parseArgs(argv: string[]): { prefix: string; spec: unknown; out: string | null; dryRun: boolean };
export function readJson(flag: string, value: string): unknown;

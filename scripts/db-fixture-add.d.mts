export class UsageError extends Error {}

type Row = { key: string; slug: string; title: string; name?: string } & Record<string, unknown>;

export function runPrefix(prefix: string, ms: number): string;
export function slugBase(prefix: string): string;
export function buildPlan(
  spec: unknown,
  run: { prefix: string; ms: number },
): {
  prefix: string;
  slugPrefix: string;
  ms: number;
  extras: Record<string, string | number | boolean>;
  albums: Row[];
  series: Row[];
  events: Row[];
  artistIds: string[];
  count: number;
};
export function rmCommand(prefix: string, ids: { series: string[]; events: string[]; albums: string[] }): string;
export function parseArgs(argv: string[]): { prefix: string; spec: unknown; out: string | null; dryRun: boolean };
export function readJson(flag: string, value: string): unknown;

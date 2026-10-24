export class UsageError extends Error {}
export function parseArgs(argv: string[]): {
  ids: Record<"Event" | "EventSeries" | "Album" | "ImageAsset", string[]>;
  prefix: string | null;
  assetPrefix: string | null;
  expect: number;
  dryRun: boolean;
};

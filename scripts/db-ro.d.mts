export function refusalReason(sql: string): string | null;
export function parseArgs(
  argv: string[],
  readFile?: (path: string) => string,
): { sqls: string[]; json: boolean };

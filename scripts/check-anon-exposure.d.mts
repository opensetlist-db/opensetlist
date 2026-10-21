export function parseAllowlist(text: string): Set<string>;
export function compare<T extends { name: string }>(
  exposed: T[],
  allowed: Set<string>,
): { offending: T[]; stale: string[] };

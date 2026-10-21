export function parseAllowlist(text: string): Set<string>;
export function diffAllowlist<T extends { name: string }>(
  exposed: T[],
  allowed: Set<string>,
): { offending: T[]; stale: string[] };

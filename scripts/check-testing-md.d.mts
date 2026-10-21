export const SUITES: { key: string; header: string; dir: string; suffix: string }[];
export function parseTables(markdown: string, headers: string[]): Record<string, string[] | null>;
export function diffRows(files: string[], rows: string[]): { missing: string[]; stale: string[] };
export function checkTestingMd(markdown: string, filesBySuite: Record<string, string[]>): string[];

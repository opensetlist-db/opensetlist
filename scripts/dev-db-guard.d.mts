export const DEV_PROJECT_REF: string;
export function pointsAtDevProject(raw: string): boolean;
export function pointsAtSupabaseProject(raw: string, projectRef: string): boolean;
export function checkoutRoot(fallback: string): string;

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { COOKIE_NAME, isValidAdminSession, safeEqual } from "@/lib/admin-session";

export async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  if (!(await isValidAdminSession(session?.value))) {
    redirect("/admin-login");
  }
}

// API-route variant: returns a 401 NextResponse if unauthenticated, or null
// when the caller may proceed. Unlike verifyAdmin(), does not redirect.
// Every `/api/admin/*` handler (except login) must call this first —
// `src/proxy.ts` also gates the whole prefix, but per the Next.js data-
// security guidance the proxy is not the only line of defence.
export async function verifyAdminAPI(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  if (!(await isValidAdminSession(session?.value))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function verifyPassword(password: unknown): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || typeof password !== "string") return false;
  return safeEqual(password, adminPassword);
}

export { COOKIE_NAME };
export { adminSessionToken } from "@/lib/admin-session";

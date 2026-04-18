import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_session";
const SESSION_TOKEN = "opensetlist_admin_v1";

export async function verifyAdmin() {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  if (session?.value !== SESSION_TOKEN) {
    redirect("/admin-login");
  }
}

// API-route variant: returns a 401 NextResponse if unauthenticated, or null
// when the caller may proceed. Unlike verifyAdmin(), does not redirect.
export async function verifyAdminAPI(): Promise<NextResponse | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(COOKIE_NAME);
  if (session?.value !== SESSION_TOKEN) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export function verifyPassword(password: string): boolean {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return false;
  return password === adminPassword;
}

export { COOKIE_NAME, SESSION_TOKEN };

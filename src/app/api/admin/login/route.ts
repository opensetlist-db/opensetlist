import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, COOKIE_NAME, adminSessionToken } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  let password: unknown;
  try {
    ({ password } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  // verifyPassword() succeeding implies ADMIN_PASSWORD is set, so a token
  // can always be derived here; guard anyway so a misconfiguration can never
  // hand out an empty cookie.
  const token = await adminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Admin auth is not configured" }, { status: 500 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return response;
}

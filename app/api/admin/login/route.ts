import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE,
  checkAdminPassword,
  hasAdminSecret,
  issueAdminToken,
  isAdminRequest,
} from "@/lib/adminAuth";

export async function GET() {
  if (!hasAdminSecret()) {
    return NextResponse.json(
      { ok: false, configured: false, authenticated: false },
      { status: 503 }
    );
  }
  const authenticated = await isAdminRequest();
  return NextResponse.json({ ok: true, configured: true, authenticated });
}

export async function POST(request: Request) {
  if (!hasAdminSecret()) {
    return NextResponse.json(
      { error: "ADMIN_SECRET is not configured on the server." },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!checkAdminPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const token = issueAdminToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

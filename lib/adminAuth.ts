import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "usd-admin";

/** Local/dev fallback so /admin always shows a password field. */
const DEV_FALLBACK_SECRET = "admin123";

function adminSecret(): string {
  const fromEnv = process.env.ADMIN_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_SECRET;
  throw new Error("ADMIN_SECRET is not configured");
}

export function hasAdminSecret(): boolean {
  return Boolean(process.env.ADMIN_SECRET?.trim()) || process.env.NODE_ENV !== "production";
}

function sign(value: string): string {
  return createHmac("sha256", adminSecret()).update(value).digest("hex");
}

export function issueAdminToken(): string {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;
  const expected = sign(issuedAt);
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts)) return false;
  // 14-day sessions
  return Date.now() - ts < 14 * 24 * 60 * 60 * 1000;
}

export function checkAdminPassword(password: string): boolean {
  if (!password) return false;
  let secret = "";
  try {
    secret = adminSecret();
  } catch {
    return false;
  }
  const a = Buffer.from(password);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function isAdminRequest(): Promise<boolean> {
  if (!hasAdminSecret()) return false;
  try {
    const jar = await cookies();
    return verifyAdminToken(jar.get(ADMIN_COOKIE)?.value);
  } catch {
    return false;
  }
}

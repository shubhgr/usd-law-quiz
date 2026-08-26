import crypto from "crypto";

const SECRET = process.env.TOKEN_SECRET ?? "usd-local-dev-secret-change-me-in-production";

function hmac(pid: string): string {
  return crypto.createHmac("sha256", SECRET).update(pid).digest("hex");
}

export function signToken(pid: string): string {
  return `${pid}.${hmac(pid)}`;
}

export function verifyToken(token: string): string | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [pid, sig] = parts;
  if (!pid || !sig) return null;
  const expected = Buffer.from(hmac(pid));
  const received = Buffer.from(sig);
  if (expected.length !== received.length) return null;
  if (!crypto.timingSafeEqual(expected, received)) return null;
  return pid;
}

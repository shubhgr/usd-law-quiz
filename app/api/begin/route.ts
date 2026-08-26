import crypto from "crypto";
import { NextResponse } from "next/server";
import { signToken } from "@/lib/token";

// Fast, non-blocking credential issuance. No Apps Script call: the sheet write
// happens later in the background, so registration feels instant.
export async function POST() {
  const pid = crypto.randomUUID();
  return NextResponse.json({ pid, token: signToken(pid) });
}

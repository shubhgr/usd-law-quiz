import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import { getCachedLeaderboard } from "@/lib/leaderboardCache";
import { respondSheetsError } from "@/lib/handleSheetsError";

function unauthorized() {
  return NextResponse.json(
    { error: "Invalid or tampered token" },
    { status: 401 }
  );
}

export async function GET(request: NextRequest) {
  const pid = request.nextUrl.searchParams.get("pid") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) return unauthorized();

  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = Number(raw);
  const limit = Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, Math.trunc(parsed)))
    : 20;

  try {
    const result = await getCachedLeaderboard({ pid, limit });
    return NextResponse.json({ topEntries: result.topEntries, me: result.me });
  } catch (err) {
    const response = respondSheetsError(err);
    if (response) return response;
    console.error("[leaderboard]", err);
    return NextResponse.json(
      { error: "Could not load leaderboard. Please try again." },
      { status: 502 }
    );
  }
}

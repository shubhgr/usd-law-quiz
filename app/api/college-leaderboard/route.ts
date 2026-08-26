import { NextResponse, type NextRequest } from "next/server";
import { getCachedCollegeLeaderboard } from "@/lib/collegeLeaderboardCache";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("limit");
  const parsed = Number(raw);
  const limit = Number.isFinite(parsed)
    ? Math.min(100, Math.max(1, Math.trunc(parsed)))
    : 100;

  try {
    const entries = await getCachedCollegeLeaderboard({ limit });
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[college-leaderboard]", err);
    return NextResponse.json(
      { error: "Could not load college leaderboard. Please try again." },
      { status: 502 }
    );
  }
}

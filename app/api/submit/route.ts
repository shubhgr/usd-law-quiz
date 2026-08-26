import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { respondSheetsError } from "@/lib/handleSheetsError";
import { hasDatabaseUrl, query } from "@/lib/db";
import { finalizeAttempt, loadAttempt } from "@/lib/questionAttempt";
import { isTabBlocked } from "@/lib/tabSwitch";

interface SubmitBody {
  pid?: string;
  token?: string;
}

export async function POST(request: Request) {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pid = "", token = "" } = body;
  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  try {
    if (hasDatabaseUrl()) {
      const parts = await query<{
        status: string;
        tab_switches: number | null;
      }>(
        `SELECT status, tab_switches FROM participants WHERE pid = $1 LIMIT 1`,
        [pid]
      );
      if (!parts.length) {
        return NextResponse.json(
          { error: "Participant not found" },
          { status: 404 }
        );
      }
      if (
        parts[0]!.status === "blocked" ||
        isTabBlocked(parts[0]!.tab_switches)
      ) {
        return NextResponse.json(
          { error: "Disqualified", blocked: true },
          { status: 403 }
        );
      }

      const attempt = await loadAttempt(pid);
      if (!attempt) {
        return NextResponse.json(
          { error: "Participant not found" },
          { status: 404 }
        );
      }

      if (attempt.score !== null) {
        return NextResponse.json({
          totalScore: Number(attempt.score),
          completionTimeSeconds: Number(attempt.completion_time_seconds ?? 0),
          completedAt: attempt.completed_at
            ? new Date(attempt.completed_at).toISOString()
            : null,
        });
      }

      const result = await finalizeAttempt(pid, new Date());
      return NextResponse.json(result);
    }

    return NextResponse.json(
      {
        error:
          "Submit requires Postgres (DATABASE_URL). Sheets is store-only and needs score from backend.",
      },
      { status: 503 }
    );
  } catch (err) {
    const response = respondSheetsError(err);
    if (response) return response;
    console.error("[submit]", err);
    return NextResponse.json(
      { error: "Could not submit quiz. Please try again." },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";
import { gasQuizStart } from "@/lib/sheets";

interface StartBody {
  pid?: string;
  token?: string;
}

export async function POST(request: Request) {
  let body: StartBody;
  try {
    body = (await request.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pid = typeof body.pid === "string" ? body.pid : "";
  const token = typeof body.token === "string" ? body.token : "";
  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  const now = new Date();

  if (hasDatabaseUrl()) {
    const rows = await query<{
      quiz_started_at: string | null;
      status: string;
    }>(
      `SELECT quiz_started_at, status
       FROM participants
       WHERE pid = $1
       LIMIT 1`,
      [pid]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    const existing = rows[0]!;
    if (existing.status === "completed") {
      return NextResponse.json({
        ok: true,
        quizStartedAt: existing.quiz_started_at
          ? new Date(existing.quiz_started_at).toISOString()
          : null,
        alreadyCompleted: true,
      });
    }

    if (existing.quiz_started_at) {
      return NextResponse.json({
        ok: true,
        quizStartedAt: new Date(existing.quiz_started_at).toISOString(),
        alreadyStarted: true,
      });
    }

    await query(
      `UPDATE participants
         SET quiz_started_at = $2,
             status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
             last_activity_at = $2
       WHERE pid = $1`,
      [pid, now.toISOString()]
    );

    void gasQuizStart({ pid }).catch(() => undefined);

    return NextResponse.json({
      ok: true,
      quizStartedAt: now.toISOString(),
      alreadyStarted: false,
    });
  }

  const result = await gasQuizStart({ pid });
  return NextResponse.json({
    ok: true,
    quizStartedAt: result.quizStartedAt ?? now.toISOString(),
    alreadyStarted: Boolean(result.alreadyStarted),
  });
}

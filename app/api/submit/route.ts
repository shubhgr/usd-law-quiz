import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { gasSubmit } from "@/lib/sheets";
import { respondSheetsError } from "@/lib/handleSheetsError";
import { invalidateLeaderboardCache } from "@/lib/leaderboardCache";
import { invalidateCollegeLeaderboardCache } from "@/lib/collegeLeaderboardCache";
import { hasDatabaseUrl, query } from "@/lib/db";
import { scoreFromAnswerString } from "@/lib/answerKey";
import { isAnswerStringComplete } from "@/lib/answerString";
import { isQuizTimeExpired, quizElapsedSeconds, quizStartMs } from "@/lib/quizTime";

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
    // Postgres-first path.
    if (hasDatabaseUrl()) {
      const rows = await query<{
        pid: string;
        answers: string;
        score: number | null;
        completion_time_seconds: number | null;
        completed_at: string | null;
        registered_at: string | null;
        quiz_started_at: string | null;
      }>(
        `SELECT
           p.pid,
           a.answers,
           a.score,
           a.completion_time_seconds,
           a.completed_at,
           p.registered_at,
           p.quiz_started_at
         FROM participants p
         JOIN attempts a ON a.pid = p.pid
         WHERE p.pid = $1
         LIMIT 1`,
        [pid]
      );

      if (!rows.length) {
        return NextResponse.json({ error: "Participant not found" }, { status: 404 });
      }

      const r = rows[0]!;
      if (r.score !== null) {
        return NextResponse.json({
          totalScore: Number(r.score),
          completionTimeSeconds: Number(r.completion_time_seconds ?? 0),
          completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
        });
      }

      const answerStr = (r.answers ?? "").trim().toLowerCase();
      const now = new Date();
      const startedAtMs = quizStartMs(r.quiz_started_at, r.registered_at, now.getTime());
      const timedOut = isQuizTimeExpired(startedAtMs, now.getTime());

      if (!isAnswerStringComplete(answerStr) && !timedOut) {
        return NextResponse.json(
          { error: "Not all questions have been answered" },
          { status: 400 }
        );
      }

      const completionTimeSeconds = quizElapsedSeconds(startedAtMs, now.getTime());

      const totalScore = scoreFromAnswerString(answerStr);

      await query(
        `UPDATE attempts
           SET score = $2,
               completion_time_seconds = $3,
               completed_at = $4,
               updated_at = $5
         WHERE pid = $1`,
        [
          pid,
          totalScore,
          completionTimeSeconds,
          now.toISOString(),
          now.toISOString(),
        ]
      );

      await query(
        `UPDATE participants
           SET status = 'completed',
               last_activity_at = $2
         WHERE pid = $1`,
        [pid, now.toISOString()]
      );

      invalidateLeaderboardCache();
      invalidateCollegeLeaderboardCache();

      // Background mirror to Google Sheets (Apps Script).
      void gasSubmit(pid).catch(() => {
        // ignore
      });

      return NextResponse.json({
        totalScore,
        completionTimeSeconds,
        completedAt: now.toISOString(),
      });
    }

    // The Apps Script backend reads the saved answers from the Responses tab,
    // computes the score + completion time, writes them, and marks the
    // participant as completed. The client never sends a score.
    const result = await gasSubmit(pid);
    invalidateLeaderboardCache();
    invalidateCollegeLeaderboardCache();
    return NextResponse.json({
      totalScore: result.totalScore,
      completionTimeSeconds: result.completionTimeSeconds,
      completedAt: result.completedAt,
    });
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

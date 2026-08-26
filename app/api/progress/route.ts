import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import { RESTART_AFTER_DAYS } from "@/lib/config";
import { questions } from "@/lib/questions";
import { isCorrectAnswer, scoreFromAnswerString } from "@/lib/answerKey";
import {
  isAnswerStringComplete,
  isValidAnswerPayload,
  splitAnswerString,
} from "@/lib/answerString";
import { hasDatabaseUrl, query } from "@/lib/db";
import { isQuizTimeExpired, quizElapsedSeconds, quizStartMs } from "@/lib/quizTime";
import {
  gasGetProgress,
  gasSaveAnswers,
  gasClearResponses,
  gasSubmit,
  type ProgressInfo,
} from "@/lib/sheets";
import { respondSheetsError } from "@/lib/handleSheetsError";
import { invalidateLeaderboardCache } from "@/lib/leaderboardCache";
import { invalidateCollegeLeaderboardCache } from "@/lib/collegeLeaderboardCache";

function unauthorized() {
  return NextResponse.json(
    { error: "Invalid or tampered token" },
    { status: 401 }
  );
}

function notFound() {
  return NextResponse.json({ error: "Participant not found" }, { status: 404 });
}

async function fetchProgress(pid: string): Promise<{
  progress: ProgressInfo;
  restarted: boolean;
}> {
  // Postgres-first path for fast reads (no Apps Script round-trips).
  if (hasDatabaseUrl()) {
    const now = new Date();
    const load = async () => {
      const rows = await query<{
        pid: string;
        name: string;
        email: string;
        status: string;
        last_activity_at: string | null;
        answers: string;
        score: number | null;
        completion_time_seconds: number | null;
        completed_at: string | null;
        registered_at: string | null;
        quiz_started_at: string | null;
      }>(
        `SELECT
           p.pid,
           p.name,
           p.email,
           p.status,
           p.last_activity_at,
           p.registered_at,
           p.quiz_started_at,
           a.answers,
           a.score,
           a.completion_time_seconds,
           a.completed_at
         FROM participants p
         JOIN attempts a ON a.pid = p.pid
         WHERE p.pid = $1
         LIMIT 1`,
        [pid]
      );

      if (!rows.length) {
        return null;
      }

      const r = rows[0]!;
      const answerStr = r.answers ?? "";
      const completedAtIso = r.completed_at
        ? new Date(r.completed_at).toISOString()
        : null;
      const scoreObj =
        r.score !== null && r.completion_time_seconds !== null
          ? {
              totalScore: Number(r.score),
              completionTimeSeconds: Number(r.completion_time_seconds),
              completedAt: completedAtIso,
            }
          : null;

      const computedStatus = scoreObj
        ? "completed"
        : answerStr
          ? "in_progress"
          : "not_started";

      // Match the existing UI expectation: in `progress GET`, we return
      // isCorrect only when the participant is completed.
      const responses: ProgressInfo["responses"] = [];
      const parts = splitAnswerString(answerStr);
      for (let i = 0; i < parts.length; i++) {
        const questionId = `q${i + 1}`;
        responses.push({
          questionId,
          answer: parts[i],
          answeredAt: null,
        });
      }

      const progress: ProgressInfo = {
        ok: true,
        pid: r.pid,
        name: r.name,
        email: r.email,
        status: computedStatus,
        registeredAt: r.registered_at
          ? new Date(r.registered_at).toISOString()
          : null,
        lastActivityAt:
          computedStatus === "completed" ? completedAtIso : r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
        responses,
        score: scoreObj,
        rank: null,
        quizStartedAt: r.quiz_started_at
          ? new Date(r.quiz_started_at).toISOString()
          : null,
      };

      return progress;
    };

    let progress = await load();
    if (!progress) throw new Error("NOT_FOUND");

    let restarted = false;
    const last = progress.lastActivityAt
      ? new Date(progress.lastActivityAt).getTime()
      : Date.now();
    const daysSinceLastActivity = Math.floor((Date.now() - last) / 86_400_000);

    if (progress.status === "in_progress" && daysSinceLastActivity > RESTART_AFTER_DAYS) {
      await query(
        `UPDATE attempts
           SET answers = '',
               score = NULL,
               completion_time_seconds = NULL,
               completed_at = NULL,
               updated_at = $2
         WHERE pid = $1`,
        [pid, now.toISOString()]
      );
      await query(
        `UPDATE participants
           SET status = 'not_started',
               quiz_started_at = NULL,
               last_activity_at = $2
         WHERE pid = $1`,
        [pid, now.toISOString()]
      );

      progress = await load();
      if (!progress) throw new Error("NOT_FOUND_AFTER_RESTART");
      restarted = true;
    }

    return { progress, restarted };
  }

  // Legacy Sheets path.
  let progress = await gasGetProgress(pid);
  let restarted = false;

  const last = progress.lastActivityAt
    ? new Date(progress.lastActivityAt).getTime()
    : Date.now();
  const daysSinceLastActivity = Math.floor((Date.now() - last) / 86_400_000);

  if (
    progress.status === "in_progress" &&
    daysSinceLastActivity > RESTART_AFTER_DAYS
  ) {
    await gasClearResponses(pid);
    progress = await gasGetProgress(pid);
    restarted = true;
  }

  return { progress, restarted };
}

export async function GET(request: NextRequest) {
  const pid = request.nextUrl.searchParams.get("pid") ?? "";
  const token = request.nextUrl.searchParams.get("token") ?? "";

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) return unauthorized();

  try {
    const { progress, restarted } = await fetchProgress(pid);

    const last = progress.lastActivityAt
      ? new Date(progress.lastActivityAt).getTime()
      : Date.now();
    const daysSinceLastActivity = Math.floor((Date.now() - last) / 86_400_000);

    const answers: Record<string, { answer: string; isCorrect?: boolean }> = {};
    const showCorrectness = progress.status === "completed";
    for (const r of progress.responses) {
      answers[r.questionId] = {
        answer: r.answer,
        ...(showCorrectness
          ? { isCorrect: isCorrectAnswer(r.questionId, r.answer) }
          : {}),
      };
    }
    const answeredQuestionIds = progress.responses.map((r) => r.questionId);

    return NextResponse.json({
      pid,
      name: progress.name,
      email: progress.email,
      status: progress.status,
      lastActivityAt: progress.lastActivityAt,
      daysSinceLastActivity,
      restarted,
      answeredQuestionIds,
      answers,
      score: progress.score,
      quizStartedAt: progress.quizStartedAt ?? null,
    });
  } catch (err) {
    const response = respondSheetsError(err);
    if (response) return response;
    console.error("[progress GET]", err);
    return NextResponse.json(
      { error: "Could not load progress. Please try again." },
      { status: 502 }
    );
  }
}

interface ProgressBody {
  pid?: string;
  token?: string;
  answers?: string;
}

export async function POST(request: Request) {
  let body: ProgressBody;
  try {
    body = (await request.json()) as ProgressBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { pid = "", token = "", answers = "" } = body;
  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) return unauthorized();

  const normalized = answers.trim().toLowerCase();
  if (!normalized) {
    return NextResponse.json({ error: "answers is required" }, { status: 400 });
  }
  if (!isValidAnswerPayload(normalized)) {
    return NextResponse.json({ error: "Invalid answer string" }, { status: 400 });
  }
  if (splitAnswerString(normalized).length > questions.length) {
    return NextResponse.json({ error: "answers string is too long" }, { status: 400 });
  }

  // Postgres-first path.
  if (hasDatabaseUrl()) {
    const now = new Date();

    const pidRow = await query<{
      registered_at: string | null;
      quiz_started_at: string | null;
    }>(
      "SELECT registered_at, quiz_started_at FROM participants WHERE pid = $1 LIMIT 1",
      [pid]
    );
    if (!pidRow.length) return notFound();

    const startedAt = quizStartMs(
      pidRow[0]!.quiz_started_at,
      pidRow[0]!.registered_at,
      now.getTime()
    );

    const timedOut = isQuizTimeExpired(startedAt, now.getTime());
    const completed = isAnswerStringComplete(normalized) || timedOut;
    const score = completed ? scoreFromAnswerString(normalized) : null;
    const completionTimeSeconds = completed
      ? quizElapsedSeconds(startedAt, now.getTime())
      : null;
    const completedAtIso = completed ? now.toISOString() : null;

    await query(
      `INSERT INTO attempts(pid, answers, score, completion_time_seconds, completed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (pid)
       DO UPDATE SET
         answers = EXCLUDED.answers,
         score = EXCLUDED.score,
         completion_time_seconds = EXCLUDED.completion_time_seconds,
         completed_at = EXCLUDED.completed_at,
         updated_at = now()`,
      [pid, normalized, score, completionTimeSeconds, completedAtIso]
    );

    await query(
      `UPDATE participants
         SET status = $2,
             last_activity_at = $3
       WHERE pid = $1`,
      [pid, completed ? "completed" : "in_progress", now.toISOString()]
    );

    // Background mirror: write the same progress into Google Sheets via Apps Script.
    // Never block UI; ignore failures so Postgres-first remains fast.
    void gasSaveAnswers({ pid, answers: normalized }).catch(() => {});
    if (completed) void gasSubmit(pid).catch(() => {});

    if (completed) {
      invalidateLeaderboardCache();
      invalidateCollegeLeaderboardCache();
      return NextResponse.json({
        ok: true,
        completed: true,
        totalScore: score as number,
        completionTimeSeconds: completionTimeSeconds as number,
        completedAt: completedAtIso,
      });
    }

    return NextResponse.json({ ok: true });
  }

  try {
    const result = await gasSaveAnswers({ pid, answers: normalized });

    if (result.completed) {
      return NextResponse.json({
        ok: true,
        completed: true,
        totalScore: result.totalScore,
        completionTimeSeconds: result.completionTimeSeconds,
        completedAt: result.completedAt,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const response = respondSheetsError(err);
    if (response) return response;
    console.error("[progress POST]", err);
    return NextResponse.json(
      { error: "Could not save progress. Please try again." },
      { status: 502 }
    );
  }
}

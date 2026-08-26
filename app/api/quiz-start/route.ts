import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";
import {
  armQuestionDeadline,
  ensureAttemptRow,
  loadAttempt,
} from "@/lib/questionAttempt";
import { gasQuizStart } from "@/lib/sheets";
import { isTabBlocked } from "@/lib/tabSwitch";
import { questions } from "@/lib/questions";
import { QUESTION_TIME_LIMIT_SECONDS } from "@/lib/config";

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
      tab_switches: number | null;
    }>(
      `SELECT quiz_started_at, status, tab_switches
       FROM participants
       WHERE pid = $1
       LIMIT 1`,
      [pid]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    const existing = rows[0]!;
    if (existing.status === "blocked" || isTabBlocked(existing.tab_switches)) {
      return NextResponse.json(
        { error: "Disqualified", blocked: true },
        { status: 403 }
      );
    }

    if (existing.status === "completed") {
      return NextResponse.json({
        ok: true,
        quizStartedAt: existing.quiz_started_at
          ? new Date(existing.quiz_started_at).toISOString()
          : null,
        alreadyCompleted: true,
      });
    }

    await ensureAttemptRow(pid);
    const attempt = await loadAttempt(pid);
    if (attempt?.score !== null && attempt?.score !== undefined) {
      return NextResponse.json({
        ok: true,
        quizStartedAt: existing.quiz_started_at
          ? new Date(existing.quiz_started_at).toISOString()
          : null,
        alreadyCompleted: true,
      });
    }

    let quizStartedAt = existing.quiz_started_at
      ? new Date(existing.quiz_started_at).toISOString()
      : null;
    let alreadyStarted = Boolean(existing.quiz_started_at);

    if (!existing.quiz_started_at) {
      await query(
        `UPDATE participants
           SET quiz_started_at = $2,
               status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
               last_activity_at = $2
         WHERE pid = $1`,
        [pid, now.toISOString()]
      );
      quizStartedAt = now.toISOString();
      alreadyStarted = false;
      void gasQuizStart({ pid, quizStartedAt: now.toISOString() }).catch(
        () => undefined
      );
    } else if (existing.status === "not_started") {
      await query(
        `UPDATE participants
           SET status = 'in_progress', last_activity_at = $2
         WHERE pid = $1`,
        [pid, now.toISOString()]
      );
    }

    // Arm Q1 (or current index) deadline.
    const index = Math.min(
      questions.length - 1,
      Math.max(0, Number(attempt?.current_question_index ?? 0))
    );

    let armed: {
      deadlineAt: string;
      remainingMs: number;
      startedAt: string;
    };
    try {
      armed = await armQuestionDeadline(pid, index, now);
    } catch (err) {
      console.error("[quiz-start] armQuestionDeadline failed", err);
      // Schema may be missing new columns - still return a usable deadline.
      const deadlineAt = new Date(
        now.getTime() + QUESTION_TIME_LIMIT_SECONDS * 1000
      ).toISOString();
      armed = {
        startedAt: now.toISOString(),
        deadlineAt,
        remainingMs: QUESTION_TIME_LIMIT_SECONDS * 1000,
      };
    }

    return NextResponse.json({
      ok: true,
      quizStartedAt,
      alreadyStarted,
      questionIndex: index,
      questionId: questions[index]?.id ?? null,
      deadlineAt: armed.deadlineAt,
      remainingMs: armed.remainingMs,
      totalQuestions: questions.length,
    });
  }

  // Sheets-only: no server deadline columns - still return a 30s window.
  const result = await gasQuizStart({ pid, quizStartedAt: now.toISOString() });
  const deadlineAt = new Date(
    now.getTime() + QUESTION_TIME_LIMIT_SECONDS * 1000
  ).toISOString();
  return NextResponse.json({
    ok: true,
    quizStartedAt: result.quizStartedAt ?? now.toISOString(),
    alreadyStarted: Boolean(result.alreadyStarted),
    questionIndex: 0,
    questionId: questions[0]?.id ?? null,
    deadlineAt,
    remainingMs: QUESTION_TIME_LIMIT_SECONDS * 1000,
    totalQuestions: questions.length,
  });
}

import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";
import { questions } from "@/lib/questions";
import { isTabBlocked } from "@/lib/tabSwitch";
import {
  armQuestionDeadline,
  ensureAttemptRow,
  loadAttempt,
  loadResponseMap,
  nextUnansweredIndex,
} from "@/lib/questionAttempt";
import { gasQuizStart } from "@/lib/sheets";

interface Body {
  pid?: string;
  token?: string;
  /** Optional 0-based index; defaults to next unanswered. */
  questionIndex?: number;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
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

  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Per-question timer requires Postgres (DATABASE_URL)." },
      { status: 503 }
    );
  }

  const parts = await query<{
    status: string;
    tab_switches: number | null;
    quiz_started_at: string | null;
  }>(
    `SELECT status, tab_switches, quiz_started_at
     FROM participants WHERE pid = $1 LIMIT 1`,
    [pid]
  );
  if (!parts.length) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  const p = parts[0]!;
  if (p.status === "blocked" || isTabBlocked(p.tab_switches)) {
    return NextResponse.json(
      { error: "Disqualified", blocked: true },
      { status: 403 }
    );
  }
  if (p.status === "completed") {
    return NextResponse.json(
      { error: "Quiz already completed", completed: true },
      { status: 409 }
    );
  }

  await ensureAttemptRow(pid);
  const attempt = await loadAttempt(pid);
  if (attempt?.score !== null && attempt?.score !== undefined) {
    return NextResponse.json(
      { error: "Quiz already completed", completed: true },
      { status: 409 }
    );
  }

  const now = new Date();
  if (!p.quiz_started_at) {
    await query(
      `UPDATE participants
         SET quiz_started_at = $2,
             status = CASE WHEN status = 'not_started' THEN 'in_progress' ELSE status END,
             last_activity_at = $2
       WHERE pid = $1`,
      [pid, now.toISOString()]
    );
    void gasQuizStart({ pid, quizStartedAt: now.toISOString() }).catch(
      () => undefined
    );
  } else if (p.status === "not_started") {
    await query(
      `UPDATE participants SET status = 'in_progress', last_activity_at = $2 WHERE pid = $1`,
      [pid, now.toISOString()]
    );
  }

  const map = await loadResponseMap(pid);
  let index =
    typeof body.questionIndex === "number" && Number.isFinite(body.questionIndex)
      ? Math.trunc(body.questionIndex)
      : nextUnansweredIndex(map, 0);

  // Prefer server current index if that question is not yet answered.
  if (
    typeof body.questionIndex !== "number" &&
    attempt &&
    Number(attempt.current_question_index) < questions.length &&
    !(questions[Number(attempt.current_question_index)]?.id in map)
  ) {
    index = Number(attempt.current_question_index);
  }

  if (index < 0) index = 0;
  if (index >= questions.length) {
    return NextResponse.json({
      ok: true,
      done: true,
      questionIndex: questions.length,
      questionId: null,
      deadlineAt: null,
      remainingMs: 0,
    });
  }

  // Do not re-arm a question that already has a stored response.
  if (questions[index].id in map) {
    index = nextUnansweredIndex(map, index);
    if (index >= questions.length) {
      return NextResponse.json({
        ok: true,
        done: true,
        questionIndex: questions.length,
        questionId: null,
        deadlineAt: null,
        remainingMs: 0,
      });
    }
  }

  const armed = await armQuestionDeadline(pid, index, now);
  const q = questions[index]!;

  return NextResponse.json({
    ok: true,
    done: false,
    questionIndex: index,
    questionId: q.id,
    totalQuestions: questions.length,
    deadlineAt: armed.deadlineAt,
    startedAt: armed.startedAt,
    remainingMs: armed.remainingMs,
    quizStartedAt: p.quiz_started_at
      ? new Date(p.quiz_started_at).toISOString()
      : now.toISOString(),
  });
}

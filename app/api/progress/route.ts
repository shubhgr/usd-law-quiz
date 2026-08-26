import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import { questions } from "@/lib/questions";
import { isCorrectAnswer } from "@/lib/answerKey";
import {
  isAnswerStringComplete,
  isValidAnswerPayload,
  normalizeChoice,
  splitAnswerString,
  toFullPipeAnswerString,
} from "@/lib/answerString";
import { hasDatabaseUrl, query } from "@/lib/db";
import { isPastDeadline } from "@/lib/quizTime";
import {
  armQuestionDeadline,
  ensureAttemptRow,
  finalizeAttempt,
  loadAttempt,
  loadResponseMap,
  nextUnansweredIndex,
  rebuildAnswersBlob,
  upsertQuestionResponse,
} from "@/lib/questionAttempt";
import {
  gasGetProgress,
  gasSaveAnswers,
  type ProgressInfo,
} from "@/lib/sheets";
import { respondSheetsError } from "@/lib/handleSheetsError";
import { isTabBlocked } from "@/lib/tabSwitch";

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
  progress: ProgressInfo & {
    currentQuestionIndex?: number;
    deadlineAt?: string | null;
    tabSwitches?: number;
    copyPasteCount?: number;
    blocked?: boolean;
  };
  restarted: boolean;
}> {
  if (hasDatabaseUrl()) {
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
      current_question_index: number | null;
      question_deadline: string | null;
      tab_switches: number | null;
      copy_paste_count: number | null;
    }>(
      `SELECT
         p.pid,
         p.name,
         p.email,
         p.status,
         p.last_activity_at,
         p.registered_at,
         p.quiz_started_at,
         p.tab_switches,
         COALESCE(p.copy_paste_count, 0) AS copy_paste_count,
         a.answers,
         a.score,
         a.completion_time_seconds,
         a.completed_at,
         COALESCE(a.current_question_index, 0) AS current_question_index,
         a.question_deadline
       FROM participants p
       LEFT JOIN attempts a ON a.pid = p.pid
       WHERE p.pid = $1
       LIMIT 1`,
      [pid]
    );

    if (!rows.length) {
      throw new Error("NOT_FOUND");
    }

    const r = rows[0]!;
    await ensureAttemptRow(pid);

    const responseMap = await loadResponseMap(pid);
    let answerStr = r.answers ?? "";
    if (Object.keys(responseMap).length) {
      answerStr = await rebuildAnswersBlob(pid).catch(() => answerStr);
    }

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

    const blocked =
      r.status === "blocked" || isTabBlocked(r.tab_switches);
    const computedStatus = blocked
      ? "blocked"
      : scoreObj
        ? "completed"
        : Object.keys(responseMap).length || answerStr
          ? "in_progress"
          : "not_started";

    const responses: ProgressInfo["responses"] = [];
    for (const q of questions) {
      const row = responseMap[q.id];
      if (!row) continue;
      responses.push({
        questionId: q.id,
        answer: row.answer,
        answeredAt: row.answeredAt,
      });
    }
    if (!responses.length && answerStr) {
      const parts = splitAnswerString(answerStr);
      for (let i = 0; i < parts.length; i++) {
        responses.push({
          questionId: `q${i + 1}`,
          answer: parts[i],
          answeredAt: null,
        });
      }
    }

    const progress = {
      ok: true as const,
      pid: r.pid,
      name: r.name,
      email: r.email,
      status: computedStatus,
      registeredAt: r.registered_at
        ? new Date(r.registered_at).toISOString()
        : null,
      lastActivityAt:
        computedStatus === "completed"
          ? completedAtIso
          : r.last_activity_at
            ? new Date(r.last_activity_at).toISOString()
            : null,
      responses,
      score: scoreObj,
      rank: null,
      quizStartedAt: r.quiz_started_at
        ? new Date(r.quiz_started_at).toISOString()
        : null,
      currentQuestionIndex: Number(r.current_question_index ?? 0),
      deadlineAt: r.question_deadline
        ? new Date(r.question_deadline).toISOString()
        : null,
      tabSwitches: Number(r.tab_switches) || 0,
      copyPasteCount: Number(r.copy_paste_count) || 0,
      blocked,
    };

    return { progress, restarted: false };
  }

  const progress = await gasGetProgress(pid);
  return { progress, restarted: false };
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
      currentQuestionIndex: progress.currentQuestionIndex ?? 0,
      deadlineAt: progress.deadlineAt ?? null,
      tabSwitches: progress.tabSwitches ?? 0,
      copyPasteCount: progress.copyPasteCount ?? 0,
      blocked: Boolean(progress.blocked),
      totalQuestions: questions.length,
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
  /** Legacy full pipe-string (Sheets fallback / beacon). */
  answers?: string;
  /** Per-question save. */
  questionId?: string;
  answer?: string;
  timedOut?: boolean;
  questionIndex?: number;
}

export async function POST(request: Request) {
  let body: ProgressBody;
  try {
    body = (await request.json()) as ProgressBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    pid = "",
    token = "",
    answers = "",
    questionId = "",
    answer = "",
    timedOut = false,
  } = body;
  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) return unauthorized();

  // Postgres-first: per-question path preferred.
  if (hasDatabaseUrl()) {
    const now = new Date();

    const pidRow = await query<{
      status: string;
      tab_switches: number | null;
      quiz_started_at: string | null;
      registered_at: string | null;
    }>(
      `SELECT status, tab_switches, quiz_started_at, registered_at
       FROM participants WHERE pid = $1 LIMIT 1`,
      [pid]
    );
    if (!pidRow.length) return notFound();

    const participant = pidRow[0]!;
    if (
      participant.status === "blocked" ||
      isTabBlocked(participant.tab_switches)
    ) {
      return NextResponse.json(
        { error: "Disqualified", blocked: true },
        { status: 403 }
      );
    }

    await ensureAttemptRow(pid);
    const attempt = await loadAttempt(pid);
    if (attempt?.score !== null && attempt?.score !== undefined) {
      return NextResponse.json({
        ok: true,
        completed: true,
        totalScore: Number(attempt.score),
        completionTimeSeconds: Number(attempt.completion_time_seconds ?? 0),
        completedAt: attempt.completed_at
          ? new Date(attempt.completed_at).toISOString()
          : null,
      });
    }
    if (participant.status === "completed") {
      return NextResponse.json(
        { error: "Quiz already completed" },
        { status: 409 }
      );
    }

    // --- Per-question save ---
    if (questionId) {
      const qIndex = questions.findIndex((q) => q.id === questionId);
      if (qIndex < 0) {
        return NextResponse.json({ error: "Unknown question" }, { status: 400 });
      }

      const map = await loadResponseMap(pid);
      if (questionId in map) {
        // Idempotent: already recorded for this question.
        const nextIndex = nextUnansweredIndex(map, qIndex + 1);
        if (nextIndex >= questions.length) {
          const result = await finalizeAttempt(pid, now);
          return NextResponse.json({
            ok: true,
            completed: true,
            ...result,
          });
        }
        const armed = await armQuestionDeadline(pid, nextIndex, now);
        return NextResponse.json({
          ok: true,
          completed: false,
          nextQuestionIndex: nextIndex,
          nextQuestionId: questions[nextIndex]!.id,
          deadlineAt: armed.deadlineAt,
          remainingMs: armed.remainingMs,
        });
      }

      const expectedIndex = Number(attempt?.current_question_index ?? 0);
      if (qIndex !== expectedIndex) {
        // Allow only the armed question (or timed-out catch-up for current).
        return NextResponse.json(
          {
            error: "Not the current question",
            currentQuestionIndex: expectedIndex,
            currentQuestionId: questions[expectedIndex]?.id ?? null,
          },
          { status: 409 }
        );
      }

      const deadline = attempt?.question_deadline;
      const late = isPastDeadline(deadline, now.getTime());
      if (late && !timedOut) {
        // Treat as timeout with empty/current answer rather than reject hard.
      }

      const startedAt = attempt?.question_started_at
        ? new Date(attempt.question_started_at).getTime()
        : now.getTime();
      const timeTakenMs = Math.max(0, now.getTime() - startedAt);
      const effectiveTimedOut = Boolean(timedOut) || late;
      const normalizedAnswer = normalizeChoice(answer);

      await upsertQuestionResponse({
        pid,
        questionId,
        answer: effectiveTimedOut && !normalizedAnswer ? "" : normalizedAnswer,
        timedOut: effectiveTimedOut,
        timeTakenMs,
        answeredAt: now,
      });

      const answerStr = await rebuildAnswersBlob(pid);
      void gasSaveAnswers({ pid, answers: answerStr }).catch(() => undefined);

      await query(
        `UPDATE participants
           SET status = 'in_progress', last_activity_at = $2
         WHERE pid = $1 AND status <> 'blocked'`,
        [pid, now.toISOString()]
      );

      const nextIndex = qIndex + 1;
      if (nextIndex >= questions.length) {
        const result = await finalizeAttempt(pid, now);
        return NextResponse.json({
          ok: true,
          completed: true,
          ...result,
          answers: answerStr,
        });
      }

      const armed = await armQuestionDeadline(pid, nextIndex, now);
      return NextResponse.json({
        ok: true,
        completed: false,
        nextQuestionIndex: nextIndex,
        nextQuestionId: questions[nextIndex]!.id,
        deadlineAt: armed.deadlineAt,
        remainingMs: armed.remainingMs,
        answers: answerStr,
      });
    }

    // --- Legacy full-string save (beacon / old client) ---
    const normalized = toFullPipeAnswerString(answers.trim().toLowerCase());
    if (!answers.trim()) {
      return NextResponse.json(
        { error: "questionId or answers is required" },
        { status: 400 }
      );
    }
    if (!isValidAnswerPayload(answers.trim().toLowerCase())) {
      return NextResponse.json({ error: "Invalid answer string" }, { status: 400 });
    }
    if (splitAnswerString(normalized).length > questions.length) {
      return NextResponse.json(
        { error: "answers string is too long" },
        { status: 400 }
      );
    }

    const parts = splitAnswerString(normalized);
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q) break;
      const existingMap = await loadResponseMap(pid);
      if (q.id in existingMap) continue;
      const slot = parts[i] ?? "";
      // Only write slots we know about from the pipe string (including empties once past first non-empty? - write all provided slots)
      if (i >= parts.length && !slot) continue;
      await upsertQuestionResponse({
        pid,
        questionId: q.id,
        answer: slot,
        timedOut: !slot,
        timeTakenMs: null,
        answeredAt: now,
      });
    }

    const answerStr = await rebuildAnswersBlob(pid);
    void gasSaveAnswers({ pid, answers: answerStr }).catch(() => undefined);

    if (isAnswerStringComplete(answerStr) || parts.length >= questions.length) {
      const result = await finalizeAttempt(pid, now);
      return NextResponse.json({
        ok: true,
        completed: true,
        ...result,
        answers: answerStr,
      });
    }

    await query(
      `UPDATE participants SET status = 'in_progress', last_activity_at = $2 WHERE pid = $1`,
      [pid, now.toISOString()]
    );

    return NextResponse.json({ ok: true, completed: false, answers: answerStr });
  }

  // Sheets fallback (legacy overall quiz) - store the pipe string as sent.
  const normalized = toFullPipeAnswerString(answers.trim().toLowerCase());
  if (!answers.trim()) {
    return NextResponse.json({ error: "answers is required" }, { status: 400 });
  }
  if (!isValidAnswerPayload(answers.trim().toLowerCase())) {
    return NextResponse.json({ error: "Invalid answer string" }, { status: 400 });
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
        answers: normalized,
      });
    }
    return NextResponse.json({ ok: true, answers: normalized });
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

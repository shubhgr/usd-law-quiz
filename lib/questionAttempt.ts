import "server-only";

import { questions } from "./questions";
import { scoreFromAnswerString } from "./answerKey";
import { allAnswersString, normalizeChoice } from "./answerString";
import { query } from "./db";
import {
  QUESTION_TIME_LIMIT_SECONDS,
  questionDeadlineFromStart,
  quizElapsedSeconds,
  quizStartMs,
} from "./quizTime";
import { gasSaveAnswers, gasSubmit } from "./sheets";
import { invalidateLeaderboardCache } from "./leaderboardCache";
import { invalidateCollegeLeaderboardCache } from "./collegeLeaderboardCache";

export type AttemptRow = {
  answers: string;
  score: number | null;
  completion_time_seconds: number | null;
  completed_at: string | null;
  current_question_index: number;
  question_started_at: string | null;
  question_deadline: string | null;
};

export async function ensureAttemptRow(pid: string): Promise<void> {
  await query(
    `INSERT INTO attempts(pid, answers)
     VALUES ($1, '')
     ON CONFLICT (pid) DO NOTHING`,
    [pid]
  );
}

export async function loadAttempt(pid: string): Promise<AttemptRow | null> {
  const rows = await query<AttemptRow>(
    `SELECT
       answers,
       score,
       completion_time_seconds,
       completed_at,
       COALESCE(current_question_index, 0) AS current_question_index,
       question_started_at,
       question_deadline
     FROM attempts
     WHERE pid = $1
     LIMIT 1`,
    [pid]
  );
  return rows[0] ?? null;
}

export async function loadResponseMap(
  pid: string
): Promise<Record<string, { answer: string; timedOut: boolean; answeredAt: string | null }>> {
  const rows = await query<{
    question_id: string;
    answer: string;
    timed_out: boolean;
    answered_at: string | null;
  }>(
    `SELECT question_id, answer, timed_out, answered_at
     FROM question_responses
     WHERE pid = $1`,
    [pid]
  );
  const out: Record<
    string,
    { answer: string; timedOut: boolean; answeredAt: string | null }
  > = {};
  for (const r of rows) {
    out[r.question_id] = {
      answer: r.answer ?? "",
      timedOut: Boolean(r.timed_out),
      answeredAt: r.answered_at
        ? new Date(r.answered_at).toISOString()
        : null,
    };
  }
  return out;
}

export function buildAnswerStringFromMap(
  map: Record<string, { answer: string }>
): string {
  const answers: Record<string, string> = {};
  for (const q of questions) {
    answers[q.id] = normalizeChoice(map[q.id]?.answer ?? "");
  }
  return allAnswersString(answers);
}

export async function rebuildAnswersBlob(pid: string): Promise<string> {
  const map = await loadResponseMap(pid);
  const answerStr = buildAnswerStringFromMap(map);
  await query(
    `UPDATE attempts SET answers = $2, updated_at = now() WHERE pid = $1`,
    [pid, answerStr]
  );
  return answerStr;
}

/** Start or resume the deadline for the current question index. */
export async function armQuestionDeadline(
  pid: string,
  questionIndex: number,
  now = new Date()
): Promise<{ startedAt: string; deadlineAt: string; remainingMs: number }> {
  await ensureAttemptRow(pid);

  const attempt = await loadAttempt(pid);
  const sameIndex =
    attempt &&
    Number(attempt.current_question_index) === questionIndex &&
    attempt.question_deadline;

  if (sameIndex && attempt!.question_deadline) {
    const deadline = new Date(attempt!.question_deadline);
    const started = attempt!.question_started_at
      ? new Date(attempt!.question_started_at)
      : new Date(deadline.getTime() - QUESTION_TIME_LIMIT_SECONDS * 1000);
    return {
      startedAt: started.toISOString(),
      deadlineAt: deadline.toISOString(),
      remainingMs: Math.max(0, deadline.getTime() - now.getTime()),
    };
  }

  const started = now;
  const deadline = questionDeadlineFromStart(started);
  await query(
    `UPDATE attempts
       SET current_question_index = $2,
           question_started_at = $3,
           question_deadline = $4,
           updated_at = $3
     WHERE pid = $1`,
    [pid, questionIndex, started.toISOString(), deadline.toISOString()]
  );

  return {
    startedAt: started.toISOString(),
    deadlineAt: deadline.toISOString(),
    remainingMs: QUESTION_TIME_LIMIT_SECONDS * 1000,
  };
}

export async function upsertQuestionResponse(params: {
  pid: string;
  questionId: string;
  answer: string;
  timedOut: boolean;
  timeTakenMs: number | null;
  answeredAt?: Date;
}): Promise<void> {
  const at = params.answeredAt ?? new Date();
  await query(
    `INSERT INTO question_responses(pid, question_id, answer, timed_out, answered_at, time_taken_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (pid, question_id)
     DO UPDATE SET
       answer = EXCLUDED.answer,
       timed_out = EXCLUDED.timed_out,
       answered_at = EXCLUDED.answered_at,
       time_taken_ms = EXCLUDED.time_taken_ms`,
    [
      params.pid,
      params.questionId,
      normalizeChoice(params.answer),
      params.timedOut,
      at.toISOString(),
      params.timeTakenMs,
    ]
  );
}

export type FinalizeResult = {
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string;
};

export async function finalizeAttempt(
  pid: string,
  now = new Date()
): Promise<FinalizeResult> {
  const existing = await loadAttempt(pid);
  if (existing?.score !== null && existing?.score !== undefined) {
    return {
      totalScore: Number(existing.score),
      completionTimeSeconds: Number(existing.completion_time_seconds ?? 0),
      completedAt: existing.completed_at
        ? new Date(existing.completed_at).toISOString()
        : now.toISOString(),
    };
  }

  // Fill any missing questions as unanswered timed-out.
  const map = await loadResponseMap(pid);
  for (const q of questions) {
    if (!(q.id in map)) {
      await upsertQuestionResponse({
        pid,
        questionId: q.id,
        answer: "",
        timedOut: true,
        timeTakenMs: QUESTION_TIME_LIMIT_SECONDS * 1000,
        answeredAt: now,
      });
    }
  }

  const answerStr = await rebuildAnswersBlob(pid);
  const totalScore = scoreFromAnswerString(answerStr);

  const part = await query<{
    quiz_started_at: string | null;
    registered_at: string | null;
  }>(
    `SELECT quiz_started_at, registered_at FROM participants WHERE pid = $1 LIMIT 1`,
    [pid]
  );
  const startedAtMs = quizStartMs(
    part[0]?.quiz_started_at,
    part[0]?.registered_at,
    now.getTime()
  );
  const completionTimeSeconds = quizElapsedSeconds(startedAtMs, now.getTime());
  const completedAt = now.toISOString();

  await query(
    `UPDATE attempts
       SET score = $2,
           completion_time_seconds = $3,
           completed_at = $4,
           question_deadline = NULL,
           updated_at = $4
     WHERE pid = $1`,
    [pid, totalScore, completionTimeSeconds, completedAt]
  );

  await query(
    `UPDATE participants
       SET status = 'completed',
           last_activity_at = $2
     WHERE pid = $1 AND status <> 'blocked'`,
    [pid, completedAt]
  );

  invalidateLeaderboardCache();
  invalidateCollegeLeaderboardCache();

  void gasSaveAnswers({
    pid,
    answers: answerStr,
    score: totalScore,
    completionTimeSeconds,
    completedAt,
    status: "completed",
  }).catch(() => undefined);
  void gasSubmit({
    pid,
    totalScore,
    completionTimeSeconds,
    completedAt,
    answers: answerStr,
  }).catch(() => undefined);

  return { totalScore, completionTimeSeconds, completedAt };
}

export function questionIndexForId(questionId: string): number {
  return questions.findIndex((q) => q.id === questionId);
}

export function nextUnansweredIndex(
  map: Record<string, { answer: string }>,
  fromIndex = 0
): number {
  for (let i = fromIndex; i < questions.length; i++) {
    if (!(questions[i].id in map)) return i;
  }
  // If all recorded (including empty), find first without full answer for resume
  for (let i = fromIndex; i < questions.length; i++) {
    if (!map[questions[i].id]) return i;
  }
  return questions.length;
}

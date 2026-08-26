import {
  QUESTION_DEADLINE_GRACE_MS,
  QUESTION_TIME_LIMIT_SECONDS,
  QUIZ_TIME_LIMIT_SECONDS,
} from "./config";

export {
  QUESTION_TIME_LIMIT_SECONDS,
  QUESTION_DEADLINE_GRACE_MS,
  QUIZ_TIME_LIMIT_SECONDS,
};

export function quizStartMs(
  quizStartedAt: string | Date | number | null | undefined,
  registeredAt?: string | Date | number | null | undefined,
  fallbackMs = Date.now()
): number {
  const toMs = (value: string | Date | number) => {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number") return value;
    return new Date(value).getTime();
  };

  if (quizStartedAt != null) {
    const ms = toMs(quizStartedAt);
    if (!Number.isNaN(ms)) return ms;
  }
  if (registeredAt != null) {
    const ms = toMs(registeredAt);
    if (!Number.isNaN(ms)) return ms;
  }
  return fallbackMs;
}

/** Elapsed seconds from quiz start to now (uncapped; used for completion time). */
export function quizElapsedSeconds(
  startedAtMs: number,
  nowMs = Date.now()
): number {
  return Math.max(0, Math.round((nowMs - startedAtMs) / 1000));
}

export function remainingMsUntil(
  deadlineAt: string | Date | number | null | undefined,
  nowMs = Date.now()
): number {
  if (deadlineAt == null) return 0;
  const deadlineMs =
    deadlineAt instanceof Date
      ? deadlineAt.getTime()
      : typeof deadlineAt === "number"
        ? deadlineAt
        : new Date(deadlineAt).getTime();
  if (Number.isNaN(deadlineMs)) return 0;
  return Math.max(0, deadlineMs - nowMs);
}

export function remainingSecondsUntil(
  deadlineAt: string | Date | number | null | undefined,
  nowMs = Date.now()
): number {
  return Math.ceil(remainingMsUntil(deadlineAt, nowMs) / 1000);
}

export function isPastDeadline(
  deadlineAt: string | Date | number | null | undefined,
  nowMs = Date.now(),
  graceMs = QUESTION_DEADLINE_GRACE_MS
): boolean {
  if (deadlineAt == null) return true;
  const deadlineMs =
    deadlineAt instanceof Date
      ? deadlineAt.getTime()
      : typeof deadlineAt === "number"
        ? deadlineAt
        : new Date(deadlineAt).getTime();
  if (Number.isNaN(deadlineMs)) return true;
  return nowMs > deadlineMs + graceMs;
}

export function questionDeadlineFromStart(
  startedAt: Date | string | number = Date.now(),
  limitSeconds = QUESTION_TIME_LIMIT_SECONDS
): Date {
  const startMs =
    startedAt instanceof Date
      ? startedAt.getTime()
      : typeof startedAt === "number"
        ? startedAt
        : new Date(startedAt).getTime();
  return new Date(startMs + limitSeconds * 1000);
}

/** @deprecated Overall quiz expiry - replaced by per-question deadlines. */
export function quizRemainingSeconds(
  startedAtMs: number,
  nowMs = Date.now()
): number {
  return Math.max(
    0,
    QUESTION_TIME_LIMIT_SECONDS -
      Math.min(
        QUESTION_TIME_LIMIT_SECONDS,
        Math.max(0, Math.round((nowMs - startedAtMs) / 1000))
      )
  );
}

/** @deprecated */
export function isQuizTimeExpired(
  startedAtMs: number,
  nowMs = Date.now()
): boolean {
  return quizRemainingSeconds(startedAtMs, nowMs) <= 0;
}

export function formatQuizCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem.toString().padStart(2, "0")}`;
  }
  return String(s);
}

import { QUIZ_TIME_LIMIT_SECONDS } from "./config";

export { QUIZ_TIME_LIMIT_SECONDS };

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

export function quizElapsedSeconds(
  startedAtMs: number,
  nowMs = Date.now()
): number {
  return Math.min(
    QUIZ_TIME_LIMIT_SECONDS,
    Math.max(0, Math.round((nowMs - startedAtMs) / 1000))
  );
}

export function quizRemainingSeconds(
  startedAtMs: number,
  nowMs = Date.now()
): number {
  return Math.max(0, QUIZ_TIME_LIMIT_SECONDS - quizElapsedSeconds(startedAtMs, nowMs));
}

export function isQuizTimeExpired(
  startedAtMs: number,
  nowMs = Date.now()
): boolean {
  return quizRemainingSeconds(startedAtMs, nowMs) <= 0;
}

export function formatQuizCountdown(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

import { questions, type Question } from "./questions";

export function normalizeChoice(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-f]/g, "")
    .split("")
    .filter((ch, i, arr) => arr.indexOf(ch) === i)
    .sort()
    .join("");
}

/** Pipe-separated answers, e.g. "b|c|ab|bcd". Legacy compact "abcd..." still parses. */
export function splitAnswerString(answerStr: string): string[] {
  const raw = (answerStr || "").trim().toLowerCase();
  if (!raw) return [];
  if (raw.includes("|")) {
    return raw.split("|").map(normalizeChoice);
  }
  return raw.split("").filter((ch) => /^[a-f]$/.test(ch));
}

/**
 * Always exactly one slot per question, joined by `|`.
 * Unanswered / timed-out empty slots stay as empty segments, e.g.
 * `b||c|ab|||||||||||...` (26 parts for 26 questions).
 */
export function allAnswersString(answers: Record<string, string>): string {
  return questions.map((q) => normalizeChoice(answers[q.id] ?? "")).join("|");
}

/** Normalize any answer blob to a full pipe string (pad/truncate to question count). */
export function toFullPipeAnswerString(answerStr: string): string {
  const parts = splitAnswerString(answerStr);
  const answers: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    answers[questions[i].id] = parts[i] ?? "";
  }
  return allAnswersString(answers);
}

export function answersFromString(answerStr: string): Record<string, string> {
  const parts = splitAnswerString(answerStr);
  const out: Record<string, string> = {};
  for (let i = 0; i < questions.length; i++) {
    out[questions[i].id] = parts[i] ?? "";
  }
  return out;
}

export function selectCountFor(q: Question): number {
  return q.selectCount ?? 1;
}

export function isQuestionAnswered(q: Question, answer?: string): boolean {
  return normalizeChoice(answer ?? "").length === selectCountFor(q);
}

export function isAnswerSetComplete(answers: Record<string, string>): boolean {
  return questions.every((q) => isQuestionAnswered(q, answers[q.id]));
}

export function isAnswerStringComplete(answerStr: string): boolean {
  const parts = splitAnswerString(answerStr);
  if (parts.length !== questions.length) return false;
  return questions.every((q, i) => isQuestionAnswered(q, parts[i]));
}

export function formatAnswerLetters(answer?: string): string {
  const letters = normalizeChoice(answer ?? "");
  if (!letters) return "None";
  return letters
    .split("")
    .map((ch) => ch.toUpperCase())
    .join(", ");
}

export function isValidAnswerPayload(answerStr: string): boolean {
  const raw = (answerStr || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.includes("|")) {
    return /^[a-f]*(\|[a-f]*)*$/.test(raw);
  }
  return /^[a-f]+$/.test(raw);
}

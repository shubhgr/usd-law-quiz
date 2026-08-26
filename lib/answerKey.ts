import "server-only";

import { splitAnswerString } from "./answerString";
import { questions } from "./questions";

// Answer key stays on the server - never import this from client components.
// Must match apps-script/Code.gs CORRECT_KEY (pipe-separated).
export const CORRECT: Record<string, string> = {
  q1: "b",
  q2: "b",
  q3: "b",
  q4: "c",
  q5: "b",
  q6: "c",
  q7: "c",
  q8: "a",
  q9: "b",
  q10: "b",
  q11: "b",
  q12: "b",
  q13: "b",
  q14: "c",
  q15: "c",
  q16: "b",
  q17: "ab",
  q18: "b",
  q19: "c",
  q20: "a",
  q21: "ab",
  q22: "b",
  q23: "a",
  q24: "a",
  q25: "bd",
  q26: "bcd",
};

export function isCorrectAnswer(questionId: string, answer: string): boolean {
  const expected = CORRECT[questionId];
  if (!expected) return false;
  return answer.toLowerCase().replace(/[^a-f]/g, "").split("").sort().join("") ===
    expected;
}

export function scoreFromAnswers(answers: Record<string, string>): number {
  let total = 0;
  for (const [id, correct] of Object.entries(CORRECT)) {
    const got = (answers[id] ?? "")
      .toLowerCase()
      .replace(/[^a-f]/g, "")
      .split("")
      .sort()
      .join("");
    if (got === correct) total += 1;
  }
  return total;
}

export function scoreFromAnswerString(answerStr: string): number {
  const parts = splitAnswerString(answerStr);
  let total = 0;
  for (let i = 0; i < questions.length; i += 1) {
    const id = questions[i].id;
    if (parts[i] === CORRECT[id]) total += 1;
  }
  return total;
}

/** Per-question correct/wrong map for PDFs (no answer key leaked to client). */
export function gradeAnswerString(answerStr: string): Record<string, boolean> {
  const parts = splitAnswerString(answerStr);
  const graded: Record<string, boolean> = {};
  for (let i = 0; i < questions.length; i += 1) {
    const id = questions[i].id;
    if (!parts[i]) continue;
    graded[id] = parts[i] === CORRECT[id];
  }
  return graded;
}

import { questions, questionsByCarousel } from "./questions";
import {
  allAnswersString,
  isQuestionAnswered,
} from "./answerString";

export { allAnswersString } from "./answerString";

export const QUESTIONS_PER_SCREEN = 3;
export const carousels = questionsByCarousel();

export function screenQuestions(screenIndex: number) {
  return carousels[screenIndex] ?? [];
}

export function isScreenComplete(
  screenIndex: number,
  answers: Record<string, string>
): boolean {
  return screenQuestions(screenIndex).every((q) =>
    isQuestionAnswered(q, answers[q.id])
  );
}

export function questionScreenIndex(questionId: string): number {
  const q = questions.find((item) => item.id === questionId);
  return q ? q.carousel - 1 : -1;
}

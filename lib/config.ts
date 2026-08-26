export const COMPETITION_NAME = "USD Law Quiz";

/**
 * Testing: registration UI only asks for name + email.
 * Other lead fields are filled with placeholders on submit.
 * Keep false for production / deploy.
 */
export const MINIMAL_REGISTER_FORM = false;

/** Seconds allowed for each individual question (server-authoritative). */
export const QUESTION_TIME_LIMIT_SECONDS = 30;


/** Small grace for network latency when validating answer deadlines. */
export const QUESTION_DEADLINE_GRACE_MS = 1500;

/** @deprecated Kept for any residual imports; quiz uses per-question timer. */
export const QUIZ_TIME_LIMIT_MINUTES = 0;
/** Total wall-clock budget ≈ questions × per-question limit (display/docs only). */
export const QUIZ_TIME_LIMIT_SECONDS =
  QUESTION_TIME_LIMIT_SECONDS; // per-question; not overall

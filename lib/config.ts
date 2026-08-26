// Product decisions flagged as configurable.
// "allow restart" (rather than hard lockout) is the demo default:
// an in-progress participant who returns after this many days of
// inactivity gets their prior answers cleared and may restart.
export const RESTART_AFTER_DAYS = 30;

export const COMPETITION_NAME = "USD Law Quiz";

/** Total allowed quiz duration from quizStartedAt. */
export const QUIZ_TIME_LIMIT_MINUTES = 45;
export const QUIZ_TIME_LIMIT_SECONDS = QUIZ_TIME_LIMIT_MINUTES * 60;

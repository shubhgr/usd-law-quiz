export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function quizUrl(email: string): string {
  return `/quiz?email=${encodeURIComponent(normalizeEmail(email))}`;
}

export function resultsUrl(email: string): string {
  return `/results?email=${encodeURIComponent(normalizeEmail(email))}`;
}

export function leaderboardUrl(email: string): string {
  return `/leaderboard?email=${encodeURIComponent(normalizeEmail(email))}`;
}

export const STANDINGS_PATH = "/leaderboard";
export const COLLEGE_STANDINGS_PATH = "/college-leaderboard";

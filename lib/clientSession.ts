export interface LocalSession {
  pid: string;
  token: string;
  name: string;
  email: string;
  phone: string;
  workExperience: string;
  domain: string;
  linkedinUrl: string;
  collegeName: string;
  bestDescribeYou: string;
  considerMasters: string;
  planningYear: string;
  interestsMost: string;
  registeredAt: number | null;
  registered: boolean;
  answers: Record<string, string>;
  syncedAnswerString: string;
  completed: boolean;
  submitted: boolean;
  score: number | null;
  completionTimeSeconds: number | null;
  completedAt: string | null;
  /** When the user clicked Start (timer begins). Null until then. */
  quizStartedAt?: number | null;
  /** Cached leaderboard rank once known. */
  rank?: number | null;
  /** How many times they left the quiz tab. */
  tabSwitches?: number;
}

const KEY = "usd-session";

// Fallback when localStorage is blocked (third-party iframes like Framer).
// Survives in-app navigation; lost only on full page reload.
let memorySession: LocalSession | null = null;

function normalize(session: LocalSession): LocalSession {
  return {
    ...session,
    registered: session.registered ?? false,
    syncedAnswerString: session.syncedAnswerString ?? "",
    rank: session.rank ?? null,
    linkedinUrl: session.linkedinUrl ?? "",
    collegeName: session.collegeName ?? "",
    bestDescribeYou: session.bestDescribeYou ?? "",
    considerMasters: session.considerMasters ?? "",
    planningYear: session.planningYear ?? "",
    interestsMost: session.interestsMost ?? "",
    quizStartedAt: session.quizStartedAt ?? null,
    tabSwitches: Number(session.tabSwitches) || 0,
  };
}

function readStore(storage: Storage): LocalSession | null {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalSession;
    if (!parsed?.pid) return null;
    return normalize(parsed);
  } catch {
    return null;
  }
}

function writeStore(storage: Storage, session: LocalSession): boolean {
  try {
    storage.setItem(KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): LocalSession | null {
  if (typeof window === "undefined") return null;
  const fromLocal = readStore(window.localStorage);
  if (fromLocal) {
    memorySession = fromLocal;
    return fromLocal;
  }
  const fromSession = readStore(window.sessionStorage);
  if (fromSession) {
    memorySession = fromSession;
    return fromSession;
  }
  return memorySession;
}

/**
 * Always keeps an in-memory copy. Prefers localStorage, then sessionStorage
 * (sessionStorage usually still works in Framer iframes and survives reloads
 * inside the same tab).
 * Returns true when something durable was written (local or session storage).
 */
export function saveSession(session: LocalSession): boolean {
  if (typeof window === "undefined") return false;
  const next = normalize(session);
  memorySession = next;
  if (writeStore(window.localStorage, next)) return true;
  if (writeStore(window.sessionStorage, next)) return true;
  return false;
}

export function clearSession(): void {
  memorySession = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** True when the active session is memory-only (no durable storage). */
export function isMemoryOnlySession(): boolean {
  if (typeof window === "undefined") return false;
  if (!memorySession) return false;
  try {
    if (window.localStorage.getItem(KEY)) return false;
  } catch {
    // ignore
  }
  try {
    if (window.sessionStorage.getItem(KEY)) return false;
  } catch {
    // ignore
  }
  return true;
}

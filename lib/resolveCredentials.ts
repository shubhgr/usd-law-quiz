import { loadSession, saveSession, clearSession } from "./clientSession";
import { normalizeEmail } from "./quizUrls";
import { allAnswersString, answersFromString } from "./answerString";
import { isTabBlocked } from "./tabSwitch";

export interface ResolvedCredentials {
  pid: string;
  token: string;
  name: string;
  email: string;
  status: string;
  answers?: string;
  score?: {
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string | null;
  } | null;
  rank?: number | null;
  tabSwitches?: number;
  blocked?: boolean;
}

export async function resolveCredentialsByEmail(
  email: string
): Promise<ResolvedCredentials | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const local = loadSession();
  const hasLocal =
    Boolean(local) &&
    normalizeEmail(local!.email) === normalized &&
    Boolean(local!.token) &&
    Boolean(local!.pid);

  if (hasLocal && isTabBlocked(local!.tabSwitches)) {
    return {
      pid: local!.pid,
      token: local!.token,
      name: local!.name,
      email: local!.email,
      status: "blocked",
      blocked: true,
      tabSwitches: local!.tabSwitches ?? 0,
      score: null,
      rank: null,
    };
  }

  // Instant path only when we already have a score — otherwise we still need
  // Sheets (or /api/score) to finish scoring for results/leaderboard.
  if (hasLocal && local!.score !== null) {
    return {
      pid: local!.pid,
      token: local!.token,
      name: local!.name,
      email: local!.email,
      status: local!.completed
        ? "completed"
        : local!.registered
          ? "in_progress"
          : "not_started",
      score: {
        totalScore: local!.score,
        completionTimeSeconds: local!.completionTimeSeconds ?? 0,
        completedAt: local!.completedAt,
      },
      rank: local!.rank ?? null,
      answers: allAnswersString(local!.answers),
      tabSwitches: local!.tabSwitches ?? 0,
    };
  }

  try {
    const res = await fetch("/api/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: normalized }),
    });
    const data = (await res.json()) as ResolvedCredentials & { error?: string };
    if (res.ok) {
      if (local && normalizeEmail(local.email) !== normalized) {
        clearSession();
      }
      return {
        pid: data.pid,
        token: data.token,
        name: local?.name ?? data.name ?? "",
        email: normalized,
        status: data.status,
        answers: data.answers ?? "",
        score: data.score ?? null,
        rank: data.rank ?? null,
        tabSwitches: data.tabSwitches ?? 0,
        blocked: Boolean(data.blocked) || data.status === "blocked",
      };
    }
  } catch {
    // Fall through to local credentials if present.
  }

  // Sheets slow/unavailable — still let quiz continue with local pid/token.
  if (hasLocal) {
    return {
      pid: local!.pid,
      token: local!.token,
      name: local!.name,
      email: local!.email,
      status: local!.completed
        ? "completed"
        : local!.registered
          ? "in_progress"
          : "not_started",
      score: null,
      rank: local!.rank ?? null,
      answers: allAnswersString(local!.answers),
      tabSwitches: local!.tabSwitches ?? 0,
      blocked: isTabBlocked(local!.tabSwitches),
    };
  }

  return null;
}

export function persistResolvedCredentials(
  creds: ResolvedCredentials,
  patch?: Partial<ReturnType<typeof loadSession>>
): void {
  const existing = loadSession();
  const fromAnswers = creds.answers ? answersFromString(creds.answers) : {};
  saveSession({
    pid: creds.pid,
    token: creds.token,
    name: existing?.name || creds.name || "",
    email: creds.email,
    phone: existing?.phone ?? "",
    workExperience: existing?.workExperience ?? "",
    domain: existing?.domain ?? "",
    linkedinUrl: existing?.linkedinUrl ?? "",
    collegeName: existing?.collegeName ?? "",
    bestDescribeYou: existing?.bestDescribeYou ?? "",
    considerMasters: existing?.considerMasters ?? "",
    planningYear: existing?.planningYear ?? "",
    interestsMost: existing?.interestsMost ?? "",
    registeredAt: existing?.registeredAt ?? Date.now(),
    registered: true,
    answers:
      Object.keys(existing?.answers ?? {}).length > 0
        ? existing!.answers
        : fromAnswers,
    syncedAnswerString: existing?.syncedAnswerString ?? creds.answers ?? "",
    completed:
      creds.blocked || creds.status === "blocked"
        ? false
        : existing?.completed || creds.status === "completed",
    submitted:
      creds.blocked || creds.status === "blocked"
        ? false
        : existing?.submitted || creds.status === "completed",
    score:
      creds.blocked || creds.status === "blocked"
        ? null
        : existing?.score ?? creds.score?.totalScore ?? null,
    completionTimeSeconds:
      existing?.completionTimeSeconds ??
      creds.score?.completionTimeSeconds ??
      null,
    completedAt:
      existing?.completedAt ?? creds.score?.completedAt ?? null,
    rank: existing?.rank ?? creds.rank ?? null,
    quizStartedAt: existing?.quizStartedAt ?? null,
    tabSwitches: Math.max(existing?.tabSwitches ?? 0, creds.tabSwitches ?? 0),
    ...patch,
  });
}

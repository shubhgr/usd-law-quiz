const GAS_URL = process.env.GAS_URL ?? "";
const GAS_API_KEY = process.env.GAS_API_KEY ?? "";

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly code: string = "ERROR"
  ) {
    super(message);
    this.name = "SheetsError";
  }
}

function wrapGasError(err: unknown): SheetsError {
  if (err instanceof SheetsError) return err;
  if (err instanceof Error) {
    const isTimeout =
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      /timeout|aborted/i.test(err.message);
    return new SheetsError(
      isTimeout
        ? "Apps Script request timed out. Please try again."
        : err.message || "Apps Script request failed",
      isTimeout ? "TIMEOUT" : "NETWORK"
    );
  }
  return new SheetsError("Apps Script request failed", "NETWORK");
}

interface GasResponse {
  ok?: boolean;
  code?: string;
  error?: string;
}

// Apps Script may hand back sheet dates as locale strings (e.g.
// "Wed Aug 12 2026 12:00:11 GMT+0530") when the instanceof Date check inside
// the script doesn't trigger. Normalize to ISO so the front-end always gets a
// consistent format.
function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function gas<T extends GasResponse>(
  params: Record<string, string | number | boolean>
): Promise<T> {
  if (!GAS_URL) {
    throw new SheetsError("GAS_URL is not configured");
  }
  const url = new URL(GAS_URL);
  if (GAS_API_KEY) {
    url.searchParams.set("key", GAS_API_KEY);
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  // Apps Script web apps occasionally return an HTML "Page not found" page.
  // Prefer more short retries over two long 35s waits.
  const ATTEMPTS = 4;
  const TIMEOUT_MS = 12_000;
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const text = await res.text();
      let data: T;
      try {
        data = JSON.parse(text) as T;
      } catch {
        lastError = new SheetsError(
          `Apps Script returned a non-JSON response (attempt ${attempt + 1})`,
          "NETWORK"
        );
        continue;
      }
      if (data.ok === false) {
        const code = data.code ?? "ERROR";
        if (code === "BUSY" && attempt < ATTEMPTS - 1) {
          lastError = new SheetsError(
            data.error ?? "Server busy, please retry",
            "BUSY"
          );
          continue;
        }
        throw new SheetsError(
          data.error ?? "Apps Script request failed",
          code
        );
      }
      return data;
    } catch (err) {
      if (err instanceof SheetsError) {
        if (err.code === "BUSY" && attempt < ATTEMPTS - 1) {
          lastError = err;
          continue;
        }
        throw err;
      }
      lastError = wrapGasError(err);
    }
  }
  throw wrapGasError(lastError);
}

export interface ResponseRow {
  questionId: string;
  answer: string;
  answeredAt: string | null;
}

export interface ScoreInfo {
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string | null;
}

export interface ProgressInfo {
  ok: true;
  pid: string;
  name: string;
  email: string;
  status: string;
  registeredAt: string | null;
  lastActivityAt: string | null;
  responses: ResponseRow[];
  score: ScoreInfo | null;
  rank?: number | null;
  quizStartedAt?: string | null;
}

export interface RegistrationInfo {
  ok: true;
  pid: string;
  name: string;
  email: string;
  status: string;
  registeredAt: string | null;
  lastActivityAt: string | null;
  answers?: string;
  score?: ScoreInfo | null;
  rank?: number | null;
  tabSwitches?: number;
  blocked?: boolean;
  quizStartedAt?: string | null;
}

export interface LeaderboardEntry {
  pid: string;
  name: string;
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string | null;
}

export interface LeaderboardInfo {
  ok: true;
  topEntries: LeaderboardEntry[];
  me: {
    rank: number;
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string | null;
  } | null;
}

export async function gasRegister(params: {
  pid: string;
  name: string;
  email: string;
  phone: string;
  workExperience?: string;
  domain?: string;
  linkedinUrl?: string;
  collegeName?: string;
  bestDescribeYou?: string;
  considerMasters?: string;
  planningYear?: string;
  interestsMost?: string;
  pageUrl?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
}): Promise<RegistrationInfo & { existing: boolean }> {
  const result = await gas<RegistrationInfo & { existing: boolean }>({
    action: "register",
    pid: params.pid,
    name: params.name,
    email: params.email,
    phone: params.phone,
    workExperience: params.workExperience ?? "",
    domain: params.domain ?? "",
    linkedinUrl: params.linkedinUrl ?? "",
    collegeName: params.collegeName ?? "",
    bestDescribeYou: params.bestDescribeYou ?? "",
    considerMasters: params.considerMasters ?? "",
    planningYear: params.planningYear ?? "",
    interestsMost: params.interestsMost ?? "",
    pageUrl: params.pageUrl ?? "",
    utm_source: params.utm_source ?? "",
    utm_medium: params.utm_medium ?? "",
    utm_campaign: params.utm_campaign ?? "",
    utm_term: params.utm_term ?? "",
    utm_content: params.utm_content ?? "",
    utm_id: params.utm_id ?? "",
  });
  return {
    ...result,
    registeredAt: toIso(result.registeredAt),
    lastActivityAt: toIso(result.lastActivityAt),
  };
}

export async function gasResume(email: string): Promise<RegistrationInfo> {
  const result = await gas<RegistrationInfo>({ action: "resume", email });
  return {
    ...result,
    registeredAt: toIso(result.registeredAt),
    lastActivityAt: toIso(result.lastActivityAt),
    score: result.score
      ? {
          ...result.score,
          completedAt: toIso(result.score.completedAt),
        }
      : result.score ?? null,
    rank: result.rank ?? null,
    answers: result.answers ?? "",
    tabSwitches: result.tabSwitches ?? 0,
    quizStartedAt: result.quizStartedAt
      ? toIso(result.quizStartedAt)
      : null,
    blocked: Boolean(result.blocked),
  };
}

export async function gasGetProgress(pid: string): Promise<ProgressInfo> {
  const result = await gas<ProgressInfo>({ action: "getProgress", pid });
  return {
    ...result,
    registeredAt: toIso(result.registeredAt),
    lastActivityAt: toIso(result.lastActivityAt),
    responses: result.responses.map((r) => ({
      ...r,
      answeredAt: toIso(r.answeredAt),
    })),
    score: result.score
      ? {
          ...result.score,
          completedAt: toIso(result.score.completedAt),
        }
      : null,
    rank: result.rank ?? null,
    quizStartedAt: result.quizStartedAt
      ? toIso(result.quizStartedAt)
      : null,
  };
}

export async function gasSaveAnswers(params: {
  pid: string;
  answers: string;
}): Promise<{
  ok: true;
  completed?: boolean;
  totalScore?: number;
  completionTimeSeconds?: number;
  completedAt?: string | null;
}> {
  const answers = params.answers.trim().toLowerCase();

  const result = await gas<{
    ok: true;
    completed?: boolean;
    totalScore?: number;
    completionTimeSeconds?: number;
    completedAt?: string | null;
  }>({
    action: "saveAnswers",
    pid: params.pid,
    answers,
  });
  return {
    ...result,
    completedAt: result.completedAt ? toIso(result.completedAt) : null,
  };
}

export async function gasClearResponses(pid: string): Promise<{ ok: true }> {
  return gas<{ ok: true }>({ action: "clearResponses", pid });
}

export async function gasSubmit(pid: string): Promise<{
  ok: true;
  alreadyCompleted: boolean;
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string | null;
}> {
  const result = await gas<{
    ok: true;
    alreadyCompleted: boolean;
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string | null;
  }>({
    action: "submit",
    pid: pid,
  });
  return { ...result, completedAt: toIso(result.completedAt) };
}

export async function gasLeaderboard(params: {
  pid?: string;
  limit: number;
}): Promise<LeaderboardInfo> {
  const result = await gas<LeaderboardInfo>({
    action: "leaderboard",
    ...(params.pid ? { pid: params.pid } : {}),
    limit: params.limit,
  });
  return {
    ...result,
    topEntries: result.topEntries.map((e) => ({
      ...e,
      completedAt: toIso(e.completedAt),
    })),
    me: result.me
      ? {
          ...result.me,
          completedAt: toIso(result.me.completedAt),
        }
      : null,
  };
}

export async function gasTabSwitch(params: {
  pid: string;
  count: number;
}): Promise<{ ok: true; tabSwitches?: number; blocked?: boolean }> {
  return gas<{ ok: true; tabSwitches?: number; blocked?: boolean }>({
    action: "tabSwitch",
    pid: params.pid,
    count: params.count,
  });
}

export async function gasQuizStart(params: {
  pid: string;
}): Promise<{
  ok: true;
  quizStartedAt?: string | null;
  alreadyStarted?: boolean;
}> {
  const result = await gas<{
    ok: true;
    quizStartedAt?: string | null;
    alreadyStarted?: boolean;
  }>({
    action: "quizStart",
    pid: params.pid,
  });
  return {
    ...result,
    quizStartedAt: result.quizStartedAt ? toIso(result.quizStartedAt) : null,
  };
}

import { loadSession, saveSession } from "./clientSession";
import { quizUrl, resultsUrl, leaderboardUrl } from "./quizUrls";
import { allAnswersString } from "./quizScreens";
import { isAnswerSetComplete, isAnswerStringComplete } from "./answerString";
import { attributionForRegister } from "./utm";
import { showToast } from "./toast";
import { MINIMAL_REGISTER_FORM } from "./config";

const POST_ATTEMPTS = 2;
const POST_RETRY_DELAY_MS = 500;
const MAX_PASSES = 8;
const PASS_DELAY_MS = 800;

let active = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let lastRegisterErrorToast = 0;

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function errorMessage(data: unknown, fallback: string): string {
  if (data instanceof Error && data.message) return data.message;
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function toastRegisterError(message: string) {
  const now = Date.now();
  if (now - lastRegisterErrorToast < 10_000) return;
  lastRegisterErrorToast = now;
  showToast(message);
}

async function postJson(
  url: string,
  body: unknown,
  attempts = POST_ATTEMPTS
) {
  let lastError: unknown;
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await delay(POST_RETRY_DELAY_MS * i);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      lastStatus = res.status;
      const text = await res.text();
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // non-JSON body
      }
      if (res.ok) {
        return {
          ok: true as const,
          status: res.status,
          data: data as Record<string, unknown>,
        };
      }
      if (res.status === 404 || res.status === 409) {
        return { ok: false as const, status: res.status, data: data as Record<string, unknown> };
      }
      lastError = data;
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false as const, status: lastStatus, data: lastError };
}

function syncUrlEmail(email: string) {
  if (typeof window === "undefined") return;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  const path = window.location.pathname;
  if (path === "/quiz") {
    window.history.replaceState(null, "", quizUrl(normalized));
  } else if (path === "/results") {
    window.history.replaceState(null, "", resultsUrl(normalized));
  } else if (path === "/leaderboard") {
    window.history.replaceState(null, "", leaderboardUrl(normalized));
  }
}

function pendingWork(session: ReturnType<typeof loadSession>): boolean {
  if (!session) return false;
  if (!session.registered) return true;

  const answerStr = allAnswersString(session.answers);
  if (answerStr && answerStr !== session.syncedAnswerString) return true;

  return session.completed && !session.submitted;
}

async function syncAnswers(session: ReturnType<typeof loadSession>) {
  if (!session) return false;

  const answerStr = allAnswersString(session.answers);
  if (!answerStr || answerStr === session.syncedAnswerString) return true;

  const res = await postJson("/api/progress", {
    pid: session.pid,
    token: session.token,
    answers: answerStr,
  });

  if (res.status === 401) {
    saveSession({ ...session, registered: false });
    return false;
  }

  if (res.status === 404) return false;

  if (res.ok) {
    const updated = loadSession();
    if (updated) {
      const patch: Partial<typeof updated> = {
        syncedAnswerString: answerStr,
      };
      if (res.data.completed) {
        patch.submitted = true;
        patch.completed = true;
        const score = Number(res.data.totalScore);
        const completionTimeSeconds = Number(res.data.completionTimeSeconds);
        const completedAt = String(res.data.completedAt ?? "");
        if (!Number.isNaN(score)) patch.score = score;
        if (!Number.isNaN(completionTimeSeconds)) {
          patch.completionTimeSeconds = completionTimeSeconds;
        }
        if (completedAt) patch.completedAt = completedAt;
      }
      saveSession({ ...updated, ...patch });
    }
    return true;
  }

  return false;
}

async function runOnce(): Promise<void> {
  let session = loadSession();
  if (!session) return;

  if (!session.registered) {
    const reg = await postJson("/api/register", {
      pid: session.pid,
      name: session.name,
      email: session.email,
      phone: session.phone || (MINIMAL_REGISTER_FORM ? "0000000000" : ""),
      workExperience: session.workExperience,
      domain: session.domain,
      linkedinUrl: session.linkedinUrl,
      collegeName:
        session.collegeName ||
        (MINIMAL_REGISTER_FORM ? "Test College" : ""),
      bestDescribeYou: session.bestDescribeYou,
      considerMasters:
        session.considerMasters ||
        (MINIMAL_REGISTER_FORM ? "Not currently" : ""),
      planningYear:
        session.planningYear ||
        (MINIMAL_REGISTER_FORM ? "Not decided" : ""),
      interestsMost:
        session.interestsMost ||
        (MINIMAL_REGISTER_FORM
          ? "Just curious to see what the quiz is about"
          : ""),
      ...attributionForRegister(),
    });

    if (!reg.ok) {
      const message = errorMessage(
        reg.data,
        "Couldn't save your registration. We'll keep retrying in the background."
      );
      if (reg.status === 400) {
        toastRegisterError(message);
      }
      return;
    }

    const canonicalPid = String(reg.data.pid ?? session.pid);
    const canonicalToken = String(reg.data.token ?? session.token);
    const status = String(reg.data.status ?? "");
    const existing = Boolean(reg.data.existing);

    session = {
      ...session,
      pid: canonicalPid,
      token: canonicalToken,
      registered: true,
    };
    saveSession(session);
    syncUrlEmail(session.email);

    if (existing && status === "completed") {
      saveSession({ ...session, completed: true, submitted: true });
      if (
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/quiz")
      ) {
        window.location.href = resultsUrl(session.email);
      }
      return;
    }
  }

  session = loadSession();
  if (!session?.registered) return;

  const answerStr = allAnswersString(session.answers);
  if (answerStr && answerStr !== session.syncedAnswerString) {
    await syncAnswers(session);
    return;
  }

  session = loadSession();
  if (!session?.completed || session.submitted) return;

  // Fallback: explicit submit if answers synced but score not finalized yet.
  if (
    isAnswerSetComplete(session.answers) &&
    isAnswerStringComplete(session.syncedAnswerString)
  ) {
    const res = await postJson("/api/submit", {
      pid: session.pid,
      token: session.token,
    });

    if (res.status === 401) {
      saveSession({ ...session, registered: false });
      return;
    }

    if (res.ok) {
      const cur = loadSession();
      if (cur) {
        const score = Number((res.data as { totalScore?: number }).totalScore);
        const completionTimeSeconds = Number(
          (res.data as { completionTimeSeconds?: number }).completionTimeSeconds
        );
        const completedAt = String(
          (res.data as { completedAt?: string }).completedAt ?? cur.completedAt ?? ""
        );
        cur.submitted = true;
        if (!Number.isNaN(score)) cur.score = score;
        if (!Number.isNaN(completionTimeSeconds)) {
          cur.completionTimeSeconds = completionTimeSeconds;
        }
        if (completedAt) cur.completedAt = completedAt;
        saveSession(cur);
      }
      return;
    }

    // Poll progress for score if submit still pending.
    try {
      const res = await fetch(
        `/api/progress?pid=${encodeURIComponent(session.pid)}&token=${encodeURIComponent(session.token)}`
      );
      if (res.ok) {
        const body = (await res.json()) as {
          score?: {
            totalScore: number;
            completionTimeSeconds: number;
            completedAt: string;
          } | null;
        };
        if (body.score) {
          saveSession({
            ...session,
            submitted: true,
            score: body.score.totalScore,
            completionTimeSeconds: body.score.completionTimeSeconds,
            completedAt: body.score.completedAt,
            syncedAnswerString: allAnswersString(session.answers),
          });
        }
      }
    } catch {
      // retry later
    }
  }
}

export async function syncSession(): Promise<void> {
  if (active) return;
  active = true;
  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      await runOnce();
      if (!pendingWork(loadSession())) break;
      await delay(PASS_DELAY_MS);
    }
    const leftover = loadSession();
    if (pendingWork(leftover)) {
      if (leftover && !leftover.registered) {
        toastRegisterError(
          "Couldn't save your registration. We'll keep retrying in the background."
        );
      }
      scheduleDeferred();
    }
  } finally {
    active = false;
  }
}

function scheduleDeferred(): void {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void syncSession();
  }, 3000);
}

export function scheduleSync(): void {
  void syncSession();
}

export function flushPendingOnUnload(): void {
  const session = loadSession();
  if (!session) return;

  const blobOf = (body: unknown) =>
    new Blob([JSON.stringify(body)], { type: "application/json" });

  if (!session.registered) {
    try {
      navigator.sendBeacon(
        "/api/register",
        blobOf({
          pid: session.pid,
          name: session.name,
          email: session.email,
          phone: session.phone || (MINIMAL_REGISTER_FORM ? "0000000000" : ""),
          workExperience: session.workExperience,
          domain: session.domain,
          linkedinUrl: session.linkedinUrl,
          collegeName:
            session.collegeName ||
            (MINIMAL_REGISTER_FORM ? "Test College" : ""),
          bestDescribeYou: session.bestDescribeYou,
          considerMasters:
            session.considerMasters ||
            (MINIMAL_REGISTER_FORM ? "Not currently" : ""),
          planningYear:
            session.planningYear ||
            (MINIMAL_REGISTER_FORM ? "Not decided" : ""),
          interestsMost:
            session.interestsMost ||
            (MINIMAL_REGISTER_FORM
              ? "Just curious to see what the quiz is about"
              : ""),
          ...attributionForRegister(),
        })
      );
    } catch {
      // ignore
    }
    return;
  }

  const answerStr = allAnswersString(session.answers);
  if (answerStr && answerStr !== session.syncedAnswerString) {
    try {
      navigator.sendBeacon(
        "/api/progress",
        blobOf({
          pid: session.pid,
          token: session.token,
          answers: answerStr,
        })
      );
    } catch {
      // ignore
    }
  }

  if (session.completed && !session.submitted) {
    try {
      navigator.sendBeacon(
        "/api/submit",
        blobOf({ pid: session.pid, token: session.token })
      );
    } catch {
      // ignore
    }
  }
}

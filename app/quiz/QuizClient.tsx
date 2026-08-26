"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadSession, saveSession, clearSession } from "@/lib/clientSession";
import { scheduleSync, flushPendingOnUnload } from "@/lib/backgroundSync";
import { questions } from "@/lib/questions";
import { resultsUrl, normalizeEmail } from "@/lib/quizUrls";
import {
  resolveCredentialsByEmail,
  persistResolvedCredentials,
} from "@/lib/resolveCredentials";
import { allAnswersString } from "@/lib/quizScreens";
import { prefetchStandings } from "@/lib/rankEstimate";
import {
  isQuestionAnswered,
  normalizeChoice,
  selectCountFor,
} from "@/lib/answerString";
import { isTabBlocked, TAB_SWITCH_LIMIT, tabSwitchWarning } from "@/lib/tabSwitch";
import {
  formatQuizCountdown,
  quizElapsedSeconds,
  quizRemainingSeconds,
} from "@/lib/quizTime";
import { QUIZ_TIME_LIMIT_MINUTES } from "@/lib/config";
import EmailBlocked from "@/components/EmailBlocked";

const TOTAL_QUESTIONS = questions.length;

interface ProgressResponse {
  pid: string;
  name: string;
  email: string;
  status: "not_started" | "in_progress" | "completed" | "expired";
  lastActivityAt: string;
  daysSinceLastActivity: number;
  restarted: boolean;
  answeredQuestionIds: string[];
  answers: Record<string, { answer: string; isCorrect?: boolean }>;
  score: {
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string;
  } | null;
  quizStartedAt?: string | null;
}

export default function QuizClient({ email }: { email: string }) {
  const router = useRouter();
  const linkResults = resultsUrl(email);

  const [pid, setPid] = useState(() => {
    const session = loadSession();
    return session &&
      normalizeEmail(session.email) === email &&
      !session.completed
      ? session.pid
      : "";
  });
  const [token, setToken] = useState(() => {
    const session = loadSession();
    return session &&
      normalizeEmail(session.email) === email &&
      !session.completed
      ? session.token
      : "";
  });
  // Questions ship with the client — show them immediately when we already
  // have a local in-progress session (no network wait).
  const [ready, setReady] = useState(() => {
    const session = loadSession();
    return Boolean(
      session &&
        normalizeEmail(session.email) === email &&
        session.pid &&
        session.token &&
        !session.completed
    );
  });
  const [error, setError] = useState("");
  const [restartNotice, setRestartNotice] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const session = loadSession();
    return session &&
      normalizeEmail(session.email) === email &&
      !session.completed
      ? session.answers
      : {};
  });
  const [saveError, setSaveError] = useState("");
  const [tabWarning, setTabWarning] = useState(false);
  const [tabLeaveCount, setTabLeaveCount] = useState(() => {
    const session = loadSession();
    return session && normalizeEmail(session.email) === email
      ? session.tabSwitches ?? 0
      : 0;
  });
  const [blocked, setBlocked] = useState(() => {
    const session = loadSession();
    return Boolean(
      session &&
        normalizeEmail(session.email) === email &&
        isTabBlocked(session.tabSwitches)
    );
  });
  const [quizStarted, setQuizStarted] = useState(() => {
    const session = loadSession();
    if (!session || normalizeEmail(session.email) !== email || session.completed) {
      return false;
    }
    if (session.quizStartedAt) return true;
    return Object.keys(session.answers ?? {}).length > 0;
  });
  const [starting, setStarting] = useState(false);
  const tabCountRef = useRef(0);
  const pendingTabWarningRef = useRef(false);

  const submittingRef = useRef(false);
  const timeExpiredRef = useRef(false);
  const firstUnansweredRef = useRef<HTMLElement | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [timeExpired, setTimeExpired] = useState(false);

  useEffect(() => {
    tabCountRef.current = tabLeaveCount;
  }, [tabLeaveCount]);

  useEffect(() => {
    const flush = () => flushPendingOnUnload();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  useEffect(() => {
    const block = (e: Event) => {
      e.preventDefault();
    };
    const blockKeys = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (
        (e.metaKey || e.ctrlKey) &&
        (key === "c" ||
          key === "x" ||
          key === "a" ||
          key === "p" ||
          key === "s" ||
          key === "u")
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener("copy", block);
    document.addEventListener("cut", block);
    document.addEventListener("paste", block);
    document.addEventListener("contextmenu", block);
    document.addEventListener("dragstart", block);
    document.addEventListener("selectstart", block);
    document.addEventListener("keydown", blockKeys);
    return () => {
      document.removeEventListener("copy", block);
      document.removeEventListener("cut", block);
      document.removeEventListener("paste", block);
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("selectstart", block);
      document.removeEventListener("keydown", blockKeys);
    };
  }, []);

  useEffect(() => {
    if (!ready || !quizStarted) return;
    const onVisibility = () => {
      if (submittingRef.current) return;

      if (document.hidden) {
        const next = tabCountRef.current + 1;
        tabCountRef.current = next;
        setTabLeaveCount(next);
        const cur = loadSession();
        if (cur) saveSession({ ...cur, tabSwitches: next });
        if (pid && token) {
          void fetch("/api/tab-switch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid, token, count: next }),
          }).catch(() => undefined);
        }
        if (next >= TAB_SWITCH_LIMIT) {
          pendingTabWarningRef.current = true;
          return;
        }
        pendingTabWarningRef.current = true;
        return;
      }

      if (pendingTabWarningRef.current) {
        pendingTabWarningRef.current = false;
        setTabWarning(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ready, quizStarted, pid, token]);

  useEffect(() => {
    let cancelled = false;

    const goResults = () => {
      // Hard navigation so the quiz UI never sticks for completed attempts.
      window.location.replace(linkResults);
    };

    (async () => {
      const localFirst = loadSession();
      if (
        localFirst &&
        normalizeEmail(localFirst.email) === email &&
        isTabBlocked(localFirst.tabSwitches)
      ) {
        setBlocked(true);
        return;
      }
      if (
        localFirst &&
        normalizeEmail(localFirst.email) === email &&
        localFirst.completed
      ) {
        goResults();
        return;
      }

      // Local in-progress: questions are already on screen. Confirm completion
      // in the background and redirect only if the server says finished.
      if (
        localFirst &&
        normalizeEmail(localFirst.email) === email &&
        localFirst.pid &&
        localFirst.token &&
        !localFirst.completed
      ) {
        setPid(localFirst.pid);
        setToken(localFirst.token);
        setReady(true);
        scheduleSync();

        try {
          const creds = await resolveCredentialsByEmail(email);
          if (cancelled) return;
          if (
            creds &&
            (creds.blocked ||
              creds.status === "blocked" ||
              isTabBlocked(creds.tabSwitches))
          ) {
            persistResolvedCredentials(creds);
            setBlocked(true);
            return;
          }
          if (creds?.status === "completed") {
            persistResolvedCredentials(creds);
            goResults();
          }
        } catch {
          // Stay on quiz with local session.
        }
        return;
      }

      const creds = await resolveCredentialsByEmail(email);
      if (cancelled) return;
      if (!creds) {
        setError("No registration found for this email.");
        return;
      }

      if (creds.blocked || creds.status === "blocked" || isTabBlocked(creds.tabSwitches)) {
        persistResolvedCredentials(creds);
        setBlocked(true);
        return;
      }

      if (creds.status === "completed") {
        persistResolvedCredentials(creds);
        goResults();
        return;
      }

      setPid(creds.pid);
      setToken(creds.token);
      persistResolvedCredentials(creds);

      const local = loadSession();
      if (local && normalizeEmail(local.email) === email && local.completed) {
        goResults();
        return;
      }

      if (local && normalizeEmail(local.email) === email && local.pid && local.token) {
        setPid(local.pid);
        setToken(local.token);
        if (Object.keys(local.answers).length > 0) {
          setAnswers(local.answers);
        }
        setReady(true);
        scheduleSync();
        return;
      }

      if (local && normalizeEmail(local.email) !== email) {
        clearSession();
      }

      // Show questions immediately — hydrate saved answers from progress after.
      setReady(true);

      try {
        const res = await fetch(
          `/api/progress?pid=${encodeURIComponent(creds.pid)}&token=${encodeURIComponent(creds.token)}`
        );
        const data = (await res.json()) as ProgressResponse & { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Unable to load your quiz.");
          return;
        }
        if (cancelled) return;

        if (data.status === "completed") {
          persistResolvedCredentials({
            ...creds,
            status: "completed",
            score: data.score
              ? {
                  totalScore: data.score.totalScore,
                  completionTimeSeconds: data.score.completionTimeSeconds,
                  completedAt: data.score.completedAt,
                }
              : creds.score,
          });
          goResults();
          return;
        }

        setRestartNotice(data.restarted);

        const savedAnswers: Record<string, string> = {};
        for (const qid of Object.keys(data.answers)) {
          savedAnswers[qid] = data.answers[qid].answer;
        }
        const hasAnswers = Object.keys(savedAnswers).length > 0;
        const startedMs = data.quizStartedAt
          ? new Date(data.quizStartedAt).getTime()
          : hasAnswers
            ? Date.now()
            : null;
        if (startedMs) setQuizStarted(true);
        else setQuizStarted(false);
        const existing = loadSession();
        saveSession({
          pid: creds.pid,
          token: creds.token,
          name: data.name,
          email: data.email,
          phone: existing?.phone ?? "",
          workExperience: existing?.workExperience ?? "",
          domain: existing?.domain ?? "",
          linkedinUrl: existing?.linkedinUrl ?? "",
          collegeName: existing?.collegeName ?? "",
          bestDescribeYou: existing?.bestDescribeYou ?? "",
          considerMasters: existing?.considerMasters ?? "",
          planningYear: existing?.planningYear ?? "",
          interestsMost: existing?.interestsMost ?? "",
          registeredAt: data.lastActivityAt
            ? new Date(data.lastActivityAt).getTime()
            : existing?.registeredAt ?? Date.now(),
          registered: true,
          answers: savedAnswers,
          syncedAnswerString: allAnswersString(savedAnswers),
          completed: false,
          submitted: false,
          score: data.score?.totalScore ?? null,
          completionTimeSeconds: data.score?.completionTimeSeconds ?? null,
          completedAt: data.score?.completedAt ?? null,
          quizStartedAt: startedMs,
          tabSwitches: existing?.tabSwitches ?? 0,
        });
        setAnswers(savedAnswers);
        scheduleSync();
      } catch {
        if (!cancelled) setError("Network error. Please refresh to retry.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [email, linkResults]);

  useEffect(() => {
    if (!ready || !quizStarted || !firstUnansweredRef.current) return;
    firstUnansweredRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [ready, quizStarted]);

  useEffect(() => {
    if (!ready || !quizStarted) return;
    prefetchStandings();
  }, [ready, quizStarted]);

  const startQuiz = useCallback(async () => {
    if (starting || quizStarted) return;
    setStarting(true);
    const startedAt = Date.now();
    const session = loadSession();
    if (session) {
      saveSession({ ...session, quizStartedAt: startedAt });
    }
    setQuizStarted(true);

    if (pid && token) {
      try {
        const res = await fetch("/api/quiz-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, token }),
        });
        if (res.ok) {
          const body = (await res.json()) as { quizStartedAt?: string | null };
          if (body.quizStartedAt) {
            const serverMs = new Date(body.quizStartedAt).getTime();
            const cur = loadSession();
            if (cur && !Number.isNaN(serverMs)) {
              saveSession({ ...cur, quizStartedAt: serverMs });
            }
          }
        }
      } catch {
        // Local start time still applies if the API is slow.
      }
    }
    setStarting(false);
  }, [starting, quizStarted, pid, token]);

  const submit = useCallback(() => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaveError("");

    const session = loadSession();
    const startedAt =
      session?.quizStartedAt ?? session?.registeredAt ?? Date.now();
    const completedAt = new Date();
    const completionTimeSeconds = quizElapsedSeconds(
      startedAt,
      completedAt.getTime()
    );
    const apiPid = session?.pid ?? pid;
    const apiToken = session?.token ?? token;
    const answerStr = allAnswersString(answers);

    saveSession({
      pid: apiPid,
      token: apiToken,
      name: session?.name ?? "",
      email: session?.email ?? email,
      phone: session?.phone ?? "",
      workExperience: session?.workExperience ?? "",
      domain: session?.domain ?? "",
      linkedinUrl: session?.linkedinUrl ?? "",
      collegeName: session?.collegeName ?? "",
      bestDescribeYou: session?.bestDescribeYou ?? "",
      considerMasters: session?.considerMasters ?? "",
      planningYear: session?.planningYear ?? "",
      interestsMost: session?.interestsMost ?? "",
      registeredAt: session?.registeredAt ?? Date.now(),
      quizStartedAt: startedAt,
      registered: session?.registered ?? false,
      answers,
      syncedAnswerString: session?.syncedAnswerString ?? "",
      completed: true,
      submitted: false,
      score: null,
      completionTimeSeconds,
      completedAt: completedAt.toISOString(),
    });

    // Score on the server only (answer key never ships to the browser).
    // Kick off scoring, then navigate — results page retries if this is slow.
    void fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pid: apiPid,
        token: apiToken,
        answers: answerStr,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { totalScore?: number };
        const totalScore = Number(body.totalScore);
        const cur = loadSession();
        if (cur && !Number.isNaN(totalScore)) {
          saveSession({ ...cur, score: totalScore });
        }
      })
      .catch(() => {
        // Results page will score via /api/score if this fails.
      });

    scheduleSync();
    router.replace(linkResults);
  }, [answers, pid, token, email, router, linkResults]);

  useEffect(() => {
    if (!ready || !quizStarted) return;

    const tick = () => {
      const session = loadSession();
      const startedAt = session?.quizStartedAt;
      if (!startedAt) return;

      const remaining = quizRemainingSeconds(startedAt);
      setRemainingSeconds(remaining);

      if (
        remaining <= 0 &&
        !timeExpiredRef.current &&
        !submittingRef.current
      ) {
        timeExpiredRef.current = true;
        setTimeExpired(true);
        submit();
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [ready, quizStarted, submit]);

  const answer = useCallback(
    (questionId: string, option: string) => {
      const question = questions.find((item) => item.id === questionId);
      const need = question ? selectCountFor(question) : 1;
      const prev = answers[questionId] ?? "";

      let nextValue = option;
      if (need > 1) {
        const set = new Set(normalizeChoice(prev).split("").filter(Boolean));
        if (set.has(option)) set.delete(option);
        else if (set.size < need) set.add(option);
        else return;
        nextValue = [...set].sort().join("");
      } else if (prev === option) {
        return;
      }

      setAnswers((a) => {
        const next = { ...a };
        if (nextValue) next[questionId] = nextValue;
        else delete next[questionId];
        return next;
      });
      setSaveError("");

      const session = loadSession();
      const nextAnswers = { ...(session?.answers ?? answers) };
      if (nextValue) nextAnswers[questionId] = nextValue;
      else delete nextAnswers[questionId];

      if (session) {
        saveSession({
          ...session,
          answers: nextAnswers,
          registeredAt: session.registeredAt ?? Date.now(),
          registered: session.registered ?? false,
        });
      } else {
        saveSession({
          pid,
          token,
          name: "",
          email,
          phone: "",
          workExperience: "",
          domain: "",
          linkedinUrl: "",
          collegeName: "",
          bestDescribeYou: "",
          considerMasters: "",
          planningYear: "",
          interestsMost: "",
          registeredAt: Date.now(),
          registered: false,
          answers: nextAnswers,
          syncedAnswerString: "",
          completed: false,
          submitted: false,
          score: null,
          completionTimeSeconds: null,
          completedAt: null,
        });
      }

      scheduleSync();
    },
    [answers, email, pid, token]
  );

  if (blocked) {
    return <EmailBlocked email={email} />;
  }

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">This link isn&apos;t valid</h1>
          <p className="mt-3 text-slate-400">{error}</p>
          <Link
            href="/"
            className="cta-button-gradient mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
          >
            Go to registration
          </Link>
        </div>
      </main>
    );
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16 text-slate-400">
        Loading…
      </main>
    );
  }

  if (!quizStarted) {
    return (
      <div className="binary-bg flex min-h-dvh flex-col">
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 py-12 sm:px-8">
          <div className="register-form-panel w-full p-6 text-left sm:p-8">
            <h1 className="text-center text-2xl font-bold text-white sm:text-3xl">
              Ready to take the challenge?
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
              You have {QUIZ_TIME_LIMIT_MINUTES} minutes to answer{" "}
              {TOTAL_QUESTIONS} questions. Your timer will start as soon as you
              click &ldquo;Take the Challenge&rdquo; and will continue running
              until you submit.
            </p>
            <p className="mt-4 text-sm font-medium text-slate-200 sm:text-base">
              A few things to keep in mind before you start:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400 sm:text-[0.9375rem]">
              <li>You have one attempt and cannot restart the challenge.</li>
              <li>
                Make sure you have a stable internet connection before you begin.
              </li>
              <li>
                Please stay on the challenge page throughout. Switching tabs or
                windows may lead to disqualification.
              </li>
              <li>
                If you do not submit within {QUIZ_TIME_LIMIT_MINUTES} minutes,
                your answers will be submitted automatically.
              </li>
              <li>
                Your score and completion time will be recorded for the
                leaderboard.
              </li>
              <li>
                If two participants have the same score, the faster completion
                time will determine the higher rank.
              </li>
            </ul>
            <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
              Make sure you&apos;re ready before you begin.
            </p>
            <button
              type="button"
              onClick={() => void startQuiz()}
              disabled={starting}
              className="register-btn-primary mt-7"
            >
              {starting ? "Starting…" : "Take the Challenge"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const answeredCount = questions.filter((q) =>
    isQuestionAnswered(q, answers[q.id])
  ).length;
  const allComplete = answeredCount === TOTAL_QUESTIONS;
  const progressPct = Math.round((answeredCount / TOTAL_QUESTIONS) * 100);
  const firstUnansweredId = questions.find(
    (q) => !isQuestionAnswered(q, answers[q.id])
  )?.id;
  const incompleteNumbers = questions
    .map((q, i) => (isQuestionAnswered(q, answers[q.id]) ? null : i + 1))
    .filter((n): n is number => n !== null);

  const jumpToIncomplete = () => {
    firstUnansweredRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };
  const activeTabWarning = tabSwitchWarning(tabLeaveCount);

  return (
    <div
      className="quiz-nocopy flex min-h-dvh flex-col"
      onCopy={(e) => e.preventDefault()}
      onCut={(e) => e.preventDefault()}
      onPaste={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
    >
      {tabWarning && activeTabWarning && (
        <div
          className="quiz-tab-warning"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="quiz-tab-warning-title"
        >
          <div className="quiz-tab-warning-card">
            <p id="quiz-tab-warning-title" className="quiz-tab-warning-title">
              {activeTabWarning.title}
            </p>
            <p className="quiz-tab-warning-body">
              {activeTabWarning.body}
            </p>
            <button
              type="button"
              className="register-btn-primary"
              onClick={() => {
                setTabWarning(false);
                if (tabLeaveCount >= TAB_SWITCH_LIMIT) {
                  setBlocked(true);
                }
              }}
            >
              Okay
            </button>
          </div>
        </div>
      )}
      {/* Sticky header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#001426]/95 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto w-full max-w-6xl space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-slate-300">
              Questions answered
            </p>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Time left
                </p>
                <p
                  className={`quiz-timer text-sm tabular-nums font-bold ${
                    remainingSeconds !== null && remainingSeconds <= 300
                      ? "quiz-timer--urgent"
                      : ""
                  }`}
                >
                  {remainingSeconds !== null
                    ? formatQuizCountdown(remainingSeconds)
                    : "—"}
                </p>
              </div>
              <p className="text-sm tabular-nums text-white">
                <span className="font-bold text-[#75BEE9]">{answeredCount}</span>
                <span className="text-slate-500"> / {TOTAL_QUESTIONS}</span>
              </p>
            </div>
          </div>
          <div className="quiz-progress-track" aria-hidden="true">
            <div
              className="quiz-progress-fill"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </header>

      {/* Scrollable questions */}
      <main className="relative mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-[#0074C8]/15 blur-[110px]" />

        {restartNotice && (
          <p className="relative mb-4 rounded-lg border border-amber-300/20 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
            More than 30 days passed since your last activity, so your previous
            answers were cleared and you&apos;ve been restarted from question 1.
          </p>
        )}

        <div className="glass-panel relative rounded-2xl border border-white/10 px-5 py-7 sm:px-8 sm:py-9">
          {questions.map((q, globalIndex) => {
            const selected = answers[q.id] ?? "";
            const need = selectCountFor(q);
            const complete = isQuestionAnswered(q, selected);
            const picked = normalizeChoice(selected).length;
            const isFirstUnanswered = q.id === firstUnansweredId;
            return (
              <article
                key={q.id}
                id={`question-${q.id}`}
                ref={isFirstUnanswered ? firstUnansweredRef : undefined}
                className={`quiz-question-block${complete ? "" : " quiz-question-block--incomplete"}`}
              >
                <div className="flex items-start gap-3.5 sm:gap-4">
                  <span className="quiz-q-badge" aria-hidden="true">
                    {globalIndex + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="quiz-q-text whitespace-pre-wrap">{q.text}</h2>
                    {need > 1 && (
                      <p className="mt-2 text-sm text-[#75BEE9]">
                        Select {need} options ({picked}/{need})
                      </p>
                    )}
                    <fieldset className="mt-5 space-y-2.5 border-0 p-0">
                      <legend className="sr-only">
                        Question {globalIndex + 1} options
                      </legend>
                      {Object.entries(q.options).map(([key, label]) => {
                        if (!label) return null;
                        const isSelected = normalizeChoice(selected).includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            role={need > 1 ? "checkbox" : "radio"}
                            aria-checked={isSelected}
                            onClick={() => answer(q.id, key)}
                            className={`quiz-option ${
                              isSelected ? "quiz-option-selected" : ""
                            }`}
                          >
                            <span className="quiz-option-letter">
                              {key.toUpperCase()}
                            </span>
                            <span className="min-w-0 flex-1 pt-px">
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </fieldset>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {saveError && (
          <p className="relative mt-4 rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {saveError}
          </p>
        )}

        {/* Spacer so content isn't hidden behind sticky footer */}
        <div className="h-24" aria-hidden="true" />
      </main>

      {/* Sticky footer with single submit */}
      <footer className="sticky bottom-0 z-20 border-t border-white/10 bg-[#001426]/95 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <p className="text-sm tabular-nums text-slate-400">
            <span className="font-medium text-white">{answeredCount}</span>
            <span> / {TOTAL_QUESTIONS} answered</span>
            {!allComplete && incompleteNumbers.length > 0 && (
              <>
                <span className="mx-2 text-white/20">·</span>
                <button
                  type="button"
                  onClick={jumpToIncomplete}
                  className="text-[#fbbf24] hover:underline"
                >
                  Go to question {incompleteNumbers[0]}
                </button>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={!allComplete && !timeExpired}
            className="cta-button-gradient shrink-0 rounded-lg px-8 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {timeExpired ? "Submitting…" : "Submit"}
          </button>
        </div>
      </footer>
    </div>
  );
}

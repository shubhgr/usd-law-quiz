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
import { formatQuizCountdown, remainingMsUntil, remainingSecondsUntil } from "@/lib/quizTime";
import { QUESTION_TIME_LIMIT_SECONDS } from "@/lib/config";
import EmailBlocked from "@/components/EmailBlocked";

const TOTAL_QUESTIONS = questions.length;

function markSubmittedThrough(
  answers: Record<string, string>,
  currentIndex: number
) {
  const set = new Set<number>();
  for (let i = 0; i < currentIndex; i++) set.add(i);
  for (let i = 0; i < questions.length; i++) {
    if (questions[i].id in answers) set.add(i);
  }
  return set;
}

interface ProgressResponse {
  pid: string;
  name: string;
  email: string;
  status: string;
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
  currentQuestionIndex?: number;
  deadlineAt?: string | null;
  tabSwitches?: number;
  blocked?: boolean;
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
  const [questionIndex, setQuestionIndex] = useState(0);
  const [deadlineAt, setDeadlineAt] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  const tabCountRef = useRef(0);
  const pendingTabWarningRef = useRef(false);
  const submittingRef = useRef(false);
  const inFlightIndexRef = useRef<number | null>(null);
  const submittedIndexesRef = useRef<Set<number>>(new Set());
  const advanceGraceUntilRef = useRef(0);
  const deadlineRef = useRef<string | null>(null);
  const questionIndexRef = useRef(0);
  const answersRef = useRef(answers);
  const submitQuestionRef = useRef<
    ((opts: { timedOut: boolean; answerOverride?: string }) => Promise<void>) | null
  >(null);
  const saveQueueRef = useRef(Promise.resolve());


  useEffect(() => {
    tabCountRef.current = tabLeaveCount;
  }, [tabLeaveCount]);

  useEffect(() => {
    deadlineRef.current = deadlineAt;
  }, [deadlineAt]);

  useEffect(() => {
    questionIndexRef.current = questionIndex;
  }, [questionIndex]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

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
          key === "u" ||
          key === "v")
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
          })
            .then(async (res) => {
              if (!res.ok) return;
              const body = (await res.json()) as {
                tabSwitches?: number;
                blocked?: boolean;
              };
              if (typeof body.tabSwitches === "number") {
                tabCountRef.current = body.tabSwitches;
                setTabLeaveCount(body.tabSwitches);
                const s = loadSession();
                if (s) saveSession({ ...s, tabSwitches: body.tabSwitches });
              }
              if (body.blocked) {
                pendingTabWarningRef.current = true;
              }
            })
            .catch(() => undefined);
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

  const finishQuiz = useCallback(
    (payload: {
      totalScore?: number;
      completionTimeSeconds?: number;
      completedAt?: string | null;
    }) => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      const session = loadSession();
      const nextAnswers = answersRef.current;
      saveSession({
        pid: session?.pid ?? pid,
        token: session?.token ?? token,
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
        quizStartedAt: session?.quizStartedAt ?? Date.now(),
        registered: true,
        answers: nextAnswers,
        syncedAnswerString: allAnswersString(nextAnswers),
        completed: true,
        submitted: true,
        score:
          typeof payload.totalScore === "number"
            ? payload.totalScore
            : session?.score ?? null,
        completionTimeSeconds:
          typeof payload.completionTimeSeconds === "number"
            ? payload.completionTimeSeconds
            : session?.completionTimeSeconds ?? null,
        completedAt:
          payload.completedAt ?? session?.completedAt ?? new Date().toISOString(),
        tabSwitches: session?.tabSwitches ?? tabCountRef.current,
      });
      router.replace(linkResults);
    },
    [pid, token, email, router, linkResults]
  );

  const applyAdvance = useCallback(
    (body: {
      completed?: boolean;
      totalScore?: number;
      completionTimeSeconds?: number;
      completedAt?: string | null;
      nextQuestionIndex?: number;
      nextQuestionId?: string;
      deadlineAt?: string | null;
      remainingMs?: number;
    }) => {
      if (body.completed) {
        finishQuiz({
          totalScore: body.totalScore,
          completionTimeSeconds: body.completionTimeSeconds,
          completedAt: body.completedAt,
        });
        return;
      }

      // Only sync the deadline for the question we are already showing.
      // Never jump forward/back from a stale server response (that caused Q1→Q5 skips).
      if (
        typeof body.nextQuestionIndex === "number" &&
        body.nextQuestionIndex === questionIndexRef.current &&
        body.deadlineAt
      ) {
        const serverRemaining =
          typeof body.remainingMs === "number"
            ? body.remainingMs
            : remainingMsUntil(body.deadlineAt);
        // Ignore near-zero server remaining right after an advance (stale/expired arm).
        if (serverRemaining >= 1500) {
          setDeadlineAt(body.deadlineAt);
          deadlineRef.current = body.deadlineAt;
          setRemainingSeconds(Math.ceil(serverRemaining / 1000));
        }
      }
    },
    [finishQuiz]
  );

  const advanceOptimistically = useCallback((fromIndex: number) => {
    const nextIndex = fromIndex + 1;
    submittedIndexesRef.current.add(fromIndex);
    advanceGraceUntilRef.current = Date.now() + 1500;
    if (nextIndex >= TOTAL_QUESTIONS) {
      return { done: true as const, nextIndex };
    }
    const localDeadline = new Date(
      Date.now() + QUESTION_TIME_LIMIT_SECONDS * 1000
    ).toISOString();
    setQuestionIndex(nextIndex);
    questionIndexRef.current = nextIndex;
    setDeadlineAt(localDeadline);
    deadlineRef.current = localDeadline;
    setRemainingSeconds(QUESTION_TIME_LIMIT_SECONDS);
    return { done: false as const, nextIndex };
  }, []);

  const submitCurrentQuestion = useCallback(
    async (opts: { timedOut: boolean; answerOverride?: string }) => {
      if (submittingRef.current) return;
      const index = questionIndexRef.current;
      const q = questions[index];
      if (!q) return;
      if (submittedIndexesRef.current.has(index)) return;
      if (inFlightIndexRef.current === index) return;

      const apiPid = loadSession()?.pid ?? pid;
      const apiToken = loadSession()?.token ?? token;
      if (!apiPid || !apiToken) return;

      const answerValue =
        opts.answerOverride !== undefined
          ? opts.answerOverride
          : answersRef.current[q.id] ?? "";

      // Mark + advance UI immediately (one step only).
      inFlightIndexRef.current = index;
      submittedIndexesRef.current.add(index);

      const session = loadSession();
      if (session) {
        const nextAnswers = { ...session.answers };
        nextAnswers[q.id] = normalizeChoice(answerValue);
        saveSession({
          ...session,
          answers: nextAnswers,
          syncedAnswerString: allAnswersString(nextAnswers),
        });
        setAnswers(nextAnswers);
        answersRef.current = nextAnswers;
      }

      const optimistic = advanceOptimistically(index);
      setSaveError("");

      // Serialize network writes so Q2 never races ahead of Q1 on the server.
      saveQueueRef.current = saveQueueRef.current
        .then(async () => {
          const res = await fetch("/api/progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              pid: apiPid,
              token: apiToken,
              questionId: q.id,
              questionIndex: index,
              answer: answerValue,
              timedOut: opts.timedOut,
            }),
          });
          const body = (await res.json()) as {
            error?: string;
            blocked?: boolean;
            completed?: boolean;
            totalScore?: number;
            completionTimeSeconds?: number;
            completedAt?: string | null;
            nextQuestionIndex?: number;
            deadlineAt?: string | null;
            remainingMs?: number;
          };

          if (res.status === 403 || body.blocked) {
            setBlocked(true);
            return;
          }

          if (!res.ok) {
            // Do not jump the UI on 409 - stay on the optimistic question.
            if (res.status !== 409) {
              setSaveError(body.error ?? "Could not save answer.");
            }
            return;
          }

          if (body.completed || optimistic.done) {
            if (body.completed) {
              applyAdvance(body);
            } else {
              const sub = await fetch("/api/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pid: apiPid, token: apiToken }),
              });
              if (sub.ok) {
                const sb = (await sub.json()) as {
                  totalScore?: number;
                  completionTimeSeconds?: number;
                  completedAt?: string | null;
                };
                finishQuiz(sb);
              }
            }
            return;
          }

          applyAdvance(body);
        })
        .catch(() => {
          setSaveError("Network error - your answer is saved locally.");
        })
        .finally(() => {
          if (inFlightIndexRef.current === index) {
            inFlightIndexRef.current = null;
          }
        });

      await saveQueueRef.current;
    },
    [pid, token, applyAdvance, finishQuiz, advanceOptimistically]
  );

  useEffect(() => {
    submitQuestionRef.current = submitCurrentQuestion;
  }, [submitCurrentQuestion]);

  useEffect(() => {
    let cancelled = false;

    const goResults = () => {
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
            return;
          }

          // Hydrate current question + deadline from server.
          const res = await fetch(
            `/api/progress?pid=${encodeURIComponent(localFirst.pid)}&token=${encodeURIComponent(localFirst.token)}`
          );
          if (res.ok && !cancelled) {
            const data = (await res.json()) as ProgressResponse;
            if (data.blocked || data.status === "blocked") {
              setBlocked(true);
              return;
            }
            if (data.status === "completed") {
              goResults();
              return;
            }
            if (typeof data.tabSwitches === "number") {
              setTabLeaveCount(data.tabSwitches);
              tabCountRef.current = data.tabSwitches;
            }
            const savedAnswers: Record<string, string> = {};
            for (const qid of Object.keys(data.answers ?? {})) {
              savedAnswers[qid] = data.answers[qid].answer;
            }
            setAnswers(savedAnswers);
            answersRef.current = savedAnswers;
            if (data.quizStartedAt) {
              setQuizStarted(true);
              const idx = Number(data.currentQuestionIndex ?? 0);
              setQuestionIndex(idx);
              questionIndexRef.current = idx;
              submittedIndexesRef.current = markSubmittedThrough(savedAnswers, idx);
              if (data.deadlineAt) {
                setDeadlineAt(data.deadlineAt);
                deadlineRef.current = data.deadlineAt;
              } else {
                // Re-arm deadline.
                const qs = await fetch("/api/question-start", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    pid: localFirst.pid,
                    token: localFirst.token,
                  }),
                });
                if (qs.ok) {
                  const qb = (await qs.json()) as {
                    questionIndex?: number;
                    deadlineAt?: string | null;
                    remainingMs?: number;
                    done?: boolean;
                  };
                  if (qb.done) {
                    goResults();
                    return;
                  }
                  if (typeof qb.questionIndex === "number") {
                    setQuestionIndex(qb.questionIndex);
                    questionIndexRef.current = qb.questionIndex;
                  }
                  if (qb.deadlineAt) {
                    setDeadlineAt(qb.deadlineAt);
                    deadlineRef.current = qb.deadlineAt;
                  }
                }
              }
            }
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

      if (
        creds.blocked ||
        creds.status === "blocked" ||
        isTabBlocked(creds.tabSwitches)
      ) {
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

      if (local && normalizeEmail(local.email) !== email) {
        clearSession();
      }

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

        if (data.blocked || data.status === "blocked") {
          setBlocked(true);
          return;
        }

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

        const savedAnswers: Record<string, string> = {};
        for (const qid of Object.keys(data.answers ?? {})) {
          savedAnswers[qid] = data.answers[qid].answer;
        }
        const hasProgress =
          Object.keys(savedAnswers).length > 0 || Boolean(data.quizStartedAt);
        if (hasProgress) setQuizStarted(true);

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
          quizStartedAt: data.quizStartedAt
            ? new Date(data.quizStartedAt).getTime()
            : null,
          tabSwitches: data.tabSwitches ?? existing?.tabSwitches ?? 0,
        });
        setAnswers(savedAnswers);
        answersRef.current = savedAnswers;
        if (typeof data.tabSwitches === "number") {
          setTabLeaveCount(data.tabSwitches);
          tabCountRef.current = data.tabSwitches;
        }
        if (hasProgress) {
          const idx = Number(data.currentQuestionIndex ?? 0);
          setQuestionIndex(idx);
          questionIndexRef.current = idx;
          submittedIndexesRef.current = markSubmittedThrough(savedAnswers, idx);
          if (data.deadlineAt) {
            setDeadlineAt(data.deadlineAt);
            deadlineRef.current = data.deadlineAt;
          } else {
            const qs = await fetch("/api/question-start", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pid: creds.pid, token: creds.token }),
            });
            if (qs.ok) {
              const qb = (await qs.json()) as {
                questionIndex?: number;
                deadlineAt?: string | null;
                remainingMs?: number;
              };
              if (typeof qb.questionIndex === "number") {
                setQuestionIndex(qb.questionIndex);
                questionIndexRef.current = qb.questionIndex;
              }
              if (qb.deadlineAt) {
                setDeadlineAt(qb.deadlineAt);
                deadlineRef.current = qb.deadlineAt;
              }
            }
          }
        }
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
    if (!ready || !quizStarted) return;
    prefetchStandings();
  }, [ready, quizStarted]);

  // If the quiz UI is open but we have no server deadline (resume / failed start),
  // arm the current question so the 30s timer always runs.
  useEffect(() => {
    if (!ready || !quizStarted || deadlineAt || !pid || !token) return;
    if (submittingRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/question-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, token }),
        });
        const body = (await res.json()) as {
          error?: string;
          blocked?: boolean;
          completed?: boolean;
          done?: boolean;
          questionIndex?: number;
          deadlineAt?: string | null;
          remainingMs?: number;
        };
        if (cancelled) return;
        if (res.status === 403 || body.blocked) {
          setBlocked(true);
          return;
        }
        if (res.status === 409 || body.completed || body.done) {
          window.location.replace(linkResults);
          return;
        }
        if (!res.ok) {
          // Last resort: local display timer so the UI isn't stuck on "-"
          const localDeadline = new Date(
            Date.now() + QUESTION_TIME_LIMIT_SECONDS * 1000
          ).toISOString();
          setDeadlineAt(localDeadline);
          deadlineRef.current = localDeadline;
          setRemainingSeconds(QUESTION_TIME_LIMIT_SECONDS);
          setSaveError(
            body.error ??
              "Could not sync timer with server. Using local countdown."
          );
          return;
        }
        if (typeof body.questionIndex === "number") {
          setQuestionIndex(body.questionIndex);
          questionIndexRef.current = body.questionIndex;
        }
        if (body.deadlineAt) {
          setDeadlineAt(body.deadlineAt);
          deadlineRef.current = body.deadlineAt;
          setRemainingSeconds(
            typeof body.remainingMs === "number"
              ? Math.ceil(body.remainingMs / 1000)
              : remainingSecondsUntil(body.deadlineAt)
          );
        }
      } catch {
        if (cancelled) return;
        const localDeadline = new Date(
          Date.now() + QUESTION_TIME_LIMIT_SECONDS * 1000
        ).toISOString();
        setDeadlineAt(localDeadline);
        deadlineRef.current = localDeadline;
        setRemainingSeconds(QUESTION_TIME_LIMIT_SECONDS);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, quizStarted, deadlineAt, pid, token, linkResults]);

  // Per-question countdown from deadline (stable callback via ref - avoids effect thrash).
  useEffect(() => {
    if (!ready || !quizStarted || !deadlineAt) return;

    const tick = () => {
      const remaining = remainingSecondsUntil(deadlineRef.current);
      setRemainingSeconds(remaining);
      const index = questionIndexRef.current;
      if (Date.now() < advanceGraceUntilRef.current) return;
      if (remaining > 0) return;
      if (submittedIndexesRef.current.has(index)) return;
      if (inFlightIndexRef.current === index) return;
      if (submittingRef.current) return;
      void submitQuestionRef.current?.({ timedOut: true });
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [ready, quizStarted, deadlineAt]);

  const startQuiz = useCallback(async () => {
    if (starting || quizStarted) return;
    setStarting(true);
    setSaveError("");

    if (!pid || !token) {
      setSaveError("Missing session. Please re-open from your registration link.");
      setStarting(false);
      return;
    }

    // Show a countdown immediately; replace with server deadline when it arrives.
    const optimisticDeadline = new Date(
      Date.now() + QUESTION_TIME_LIMIT_SECONDS * 1000
    ).toISOString();
    setDeadlineAt(optimisticDeadline);
    deadlineRef.current = optimisticDeadline;
    setRemainingSeconds(QUESTION_TIME_LIMIT_SECONDS);
    setQuestionIndex(0);
    questionIndexRef.current = 0;
    submittedIndexesRef.current = new Set();
    advanceGraceUntilRef.current = Date.now() + 1500;
    setQuizStarted(true);

    try {
      const res = await fetch("/api/quiz-start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, token }),
      });
      const body = (await res.json()) as {
        error?: string;
        blocked?: boolean;
        alreadyCompleted?: boolean;
        quizStartedAt?: string | null;
        questionIndex?: number;
        deadlineAt?: string | null;
        remainingMs?: number;
      };

      if (res.status === 403 || body.blocked) {
        setBlocked(true);
        setStarting(false);
        return;
      }
      if (!res.ok) {
        setSaveError(body.error ?? "Could not start quiz.");
        // Keep optimistic timer running so the quiz is usable.
        setStarting(false);
        return;
      }
      if (body.alreadyCompleted) {
        window.location.replace(linkResults);
        return;
      }

      const startedMs = body.quizStartedAt
        ? new Date(body.quizStartedAt).getTime()
        : Date.now();
      const session = loadSession();
      if (session) {
        saveSession({ ...session, quizStartedAt: startedMs });
      }

      if (typeof body.questionIndex === "number") {
        setQuestionIndex(body.questionIndex);
        questionIndexRef.current = body.questionIndex;
      }
      if (body.deadlineAt) {
        setDeadlineAt(body.deadlineAt);
        deadlineRef.current = body.deadlineAt;
        setRemainingSeconds(
          typeof body.remainingMs === "number"
            ? Math.ceil(body.remainingMs / 1000)
            : remainingSecondsUntil(body.deadlineAt)
        );
      } else {
        // quiz-start succeeded but no deadline - arm via question-start
        const qs = await fetch("/api/question-start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid, token }),
        });
        if (qs.ok) {
          const qb = (await qs.json()) as {
            questionIndex?: number;
            deadlineAt?: string | null;
            remainingMs?: number;
          };
          if (typeof qb.questionIndex === "number") {
            setQuestionIndex(qb.questionIndex);
            questionIndexRef.current = qb.questionIndex;
          }
          if (qb.deadlineAt) {
            setDeadlineAt(qb.deadlineAt);
            deadlineRef.current = qb.deadlineAt;
            setRemainingSeconds(
              typeof qb.remainingMs === "number"
                ? Math.ceil(qb.remainingMs / 1000)
                : remainingSecondsUntil(qb.deadlineAt)
            );
          }
        }
      }
    } catch {
      setSaveError("Network error - timer is running locally.");
    } finally {
      setStarting(false);
    }
  }, [starting, quizStarted, pid, token, linkResults]);

  const answer = useCallback((questionId: string, option: string) => {
    if (submittingRef.current) return;
    const index = questionIndexRef.current;
    if (submittedIndexesRef.current.has(index)) return;
    if (inFlightIndexRef.current === index) return;
    const question = questions.find((item) => item.id === questionId);
    if (!question) return;
    if (question.id !== questions[index]?.id) return;
    const need = selectCountFor(question);
    const prev = answersRef.current[questionId] ?? "";

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

    const nextAnswers = { ...answersRef.current };
    if (nextValue) nextAnswers[questionId] = nextValue;
    else delete nextAnswers[questionId];
    setAnswers(nextAnswers);
    answersRef.current = nextAnswers;
    setSaveError("");

    const session = loadSession();
    if (session) {
      saveSession({
        ...session,
        answers: nextAnswers,
        registeredAt: session.registeredAt ?? Date.now(),
        registered: session.registered ?? false,
      });
    }
    // Selection only - user must click Submit (timer still auto-submits at 0).
  }, []);

  const submitSelected = useCallback(() => {
    const index = questionIndexRef.current;
    const q = questions[index];
    if (!q) return;
    if (!isQuestionAnswered(q, answersRef.current[q.id])) return;
    void submitCurrentQuestion({
      timedOut: false,
      answerOverride: answersRef.current[q.id] ?? "",
    });
  }, [submitCurrentQuestion]);

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
              Ready for the USD Law Quiz?
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-slate-300 sm:text-base">
              You will see one question at a time. Each question has{" "}
              {QUESTION_TIME_LIMIT_SECONDS} seconds. Select your answer, then
              click Submit. If time runs out, the question is submitted
              automatically (with your selection if any, otherwise blank).
            </p>
            <p className="mt-4 text-sm font-medium text-slate-200 sm:text-base">
              A few things to keep in mind before you start:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-400 sm:text-[0.9375rem]">
              <li>You have one attempt and cannot restart the quiz.</li>
              <li>
                Make sure you have a stable internet connection before you begin.
              </li>
              <li>
                Please stay on the quiz page throughout. Switching tabs or
                windows may lead to disqualification.
              </li>
              <li>Copying and pasting is disabled.</li>
              <li>
                Your score and completion time will be recorded for the
                leaderboard.
              </li>
              <li>
                If two participants have the same score, the faster completion
                time will determine the higher rank.
              </li>
            </ul>
            {saveError && (
              <p className="mt-4 text-sm text-red-300">{saveError}</p>
            )}
            <button
              type="button"
              onClick={() => void startQuiz()}
              disabled={starting}
              className="register-btn-primary mt-7"
            >
              {starting ? "Starting…" : "Start the Quiz"}
            </button>
          </div>
        </main>
      </div>
    );
  }

  const q = questions[questionIndex] ?? questions[0]!;
  const selected = answers[q.id] ?? "";
  const need = selectCountFor(q);
  const picked = normalizeChoice(selected).length;
  const canSubmit = isQuestionAnswered(q, selected);
  const progressPct = Math.round(((questionIndex + 1) / TOTAL_QUESTIONS) * 100);
  const activeTabWarning = tabSwitchWarning(tabLeaveCount);
  const urgent =
    remainingSeconds !== null && remainingSeconds <= 5;

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
            <p className="quiz-tab-warning-body">{activeTabWarning.body}</p>
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

      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#001426]/95 px-4 py-4 backdrop-blur-md sm:px-6">
        <div className="mx-auto w-full max-w-3xl space-y-2">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium text-slate-300">
              Question {questionIndex + 1} of {TOTAL_QUESTIONS}
            </p>
            <div className="text-right">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
                Time left
              </p>
              <p
                className={`quiz-timer text-lg tabular-nums font-bold ${
                  urgent ? "quiz-timer--urgent" : ""
                }`}
              >
                {remainingSeconds !== null
                  ? formatQuizCountdown(remainingSeconds)
                  : "-"}
              </p>
            </div>
          </div>
          <div className="quiz-progress-track" aria-hidden="true">
            <div
              className="quiz-progress-fill"
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>
      </header>

      <main className="relative mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:px-6">
        <div className="glass-panel relative rounded-2xl border border-white/10 px-5 py-7 sm:px-8 sm:py-9">
          <article className="quiz-question-block">
            <div className="flex items-start gap-3.5 sm:gap-4">
              <span className="quiz-q-badge" aria-hidden="true">
                {questionIndex + 1}
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
                    Question {questionIndex + 1} options
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
                        <span className="min-w-0 flex-1 pt-px">{label}</span>
                      </button>
                    );
                  })}
                </fieldset>
              </div>
            </div>
          </article>
        </div>

        <div className="relative mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-400">
            {canSubmit
              ? "Ready - click Submit to continue."
              : need > 1
                ? `Select ${need} options, then Submit.`
                : "Select an answer, then Submit."}
          </p>
          <button
            type="button"
            onClick={submitSelected}
            disabled={!canSubmit}
            className="cta-button-gradient shrink-0 rounded-lg px-8 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Submit
          </button>
        </div>

        {saveError && (
          <p className="relative mt-4 rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-sm text-red-300">
            {saveError}
          </p>
        )}
      </main>
    </div>
  );
}

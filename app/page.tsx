"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { saveSession, clearSession, loadSession } from "@/lib/clientSession";
import { scheduleSync } from "@/lib/backgroundSync";
import { quizUrl, resultsUrl, STANDINGS_PATH, normalizeEmail } from "@/lib/quizUrls";
import { requestEmbedStorageAccess } from "@/lib/embed";
import { showToast } from "@/lib/toast";
import { errorMessage, fetchJson } from "@/lib/fetchJson";
import { prefetchStandings } from "@/lib/rankEstimate";
import { isTabBlocked } from "@/lib/tabSwitch";
import EmailBlocked from "@/components/EmailBlocked";
import {
  attributionForRegister,
  captureLandingAttribution,
} from "@/lib/utm";
import { MINIMAL_REGISTER_FORM } from "@/lib/config";

const PHONE_MIN_DIGITS = 10;
const PHONE_MAX_DIGITS = 12;

function digitsOnly(value: string, max = PHONE_MAX_DIGITS) {
  return value.replace(/\D/g, "").slice(0, max);
}

/** Soft Next navigations often fail inside Framer iframes - use a full load. */
function go(path: string) {
  window.location.assign(path);
}

async function withTimeout(promise: Promise<unknown>, ms: number) {
  await Promise.race([
    promise.catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

export default function LandingPage() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [collegeName, setCollegeName] = useState("");
  const [considerMasters, setConsiderMasters] = useState("");
  const [planningYear, setPlanningYear] = useState("");
  const [interestsMost, setInterestsMost] = useState("");

  const [showResume, setShowResume] = useState(false);
  const [resumeEmail, setResumeEmail] = useState("");
  const [resumeError, setResumeError] = useState("");
  const [resumeSubmitting, setResumeSubmitting] = useState(false);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blockedEmail, setBlockedEmail] = useState("");

  useEffect(() => {
    prefetchStandings();
    captureLandingAttribution();
  }, []);

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setError("");

    await withTimeout(requestEmbedStorageAccess(), 400);

    const fullName = `${firstName} ${lastName}`.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const phoneDigits = MINIMAL_REGISTER_FORM
      ? "0000000000"
      : digitsOnly(phone);
    if (
      !MINIMAL_REGISTER_FORM &&
      (phoneDigits.length < PHONE_MIN_DIGITS ||
        phoneDigits.length > PHONE_MAX_DIGITS)
    ) {
      const message = "Phone number must be 10 to 12 digits.";
      setError(message);
      showToast(message);
      return;
    }

    setSubmitting(true);

    try {
      const begin = await fetchJson<{
        pid?: string;
        token?: string;
        error?: string;
      }>("/api/begin", { method: "POST", timeoutMs: 12_000 });

      if (!begin.ok || !begin.data.pid || !begin.data.token) {
        const message =
          begin.data.error ?? "Registration failed. Please try again.";
        setError(message);
        showToast(message);
        return;
      }

      const pid = String(begin.data.pid);
      const token = String(begin.data.token);
      const registerPayload = {
        pid,
        name: fullName,
        email: normalizedEmail,
        phone: phoneDigits,
        linkedinUrl: MINIMAL_REGISTER_FORM ? "" : linkedInUrl,
        collegeName: MINIMAL_REGISTER_FORM
          ? "Test College"
          : collegeName,
        bestDescribeYou: "",
        considerMasters: MINIMAL_REGISTER_FORM
          ? "Not currently"
          : considerMasters,
        planningYear: MINIMAL_REGISTER_FORM ? "Not decided" : planningYear,
        interestsMost: MINIMAL_REGISTER_FORM
          ? "Just curious to see what the quiz is about"
          : interestsMost,
        ...attributionForRegister(),
      };

      const durable = saveSession({
        pid,
        token,
        name: fullName,
        email: normalizedEmail,
        phone: phoneDigits,
        workExperience: "",
        domain: "",
        linkedinUrl: registerPayload.linkedinUrl,
        collegeName: registerPayload.collegeName,
        bestDescribeYou: "",
        considerMasters: registerPayload.considerMasters,
        planningYear: registerPayload.planningYear,
        interestsMost: registerPayload.interestsMost,
        registeredAt: Date.now(),
        registered: false,
        answers: {},
        syncedAnswerString: "",
        completed: false,
        submitted: false,
        score: null,
        completionTimeSeconds: null,
        completedAt: null,
        quizStartedAt: null,
      });

      if (durable) {
        void fetchJson("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(registerPayload),
          timeoutMs: 35_000,
        })
          .then((reg) => {
            if (!reg.ok) {
              scheduleSync();
              return;
            }
            const regData = reg.data as {
              pid?: string;
              token?: string;
              status?: string;
              existing?: boolean;
              blocked?: boolean;
              tabSwitches?: number;
            };
            const cur = loadSession();
            if (!cur || normalizeEmail(cur.email) !== normalizedEmail) return;
            saveSession({
              ...cur,
              pid: String(regData.pid ?? cur.pid),
              token: String(regData.token ?? cur.token),
              registered: true,
              tabSwitches: regData.tabSwitches ?? cur.tabSwitches ?? 0,
              completed: Boolean(
                regData.existing && regData.status === "completed"
              ),
              submitted: Boolean(
                regData.existing && regData.status === "completed"
              ),
            });
            if (regData.blocked || regData.status === "blocked") {
              setBlockedEmail(normalizedEmail);
              return;
            }
            if (regData.existing && regData.status === "completed") {
              window.location.replace(resultsUrl(normalizedEmail));
            }
          })
          .catch(() => scheduleSync());
        scheduleSync();

        // Already finished? Skip quiz entirely - go straight to results.
        try {
          const resume = await fetchJson<{
            status?: string;
            pid?: string;
            token?: string;
            name?: string;
            blocked?: boolean;
            tabSwitches?: number;
            rank?: number | null;
            score?: {
              totalScore: number;
              completionTimeSeconds: number;
              completedAt: string | null;
            } | null;
          }>("/api/resume", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: normalizedEmail }),
            timeoutMs: 12_000,
          });
          if (
            resume.ok &&
            (resume.data.blocked || resume.data.status === "blocked")
          ) {
            setBlockedEmail(normalizedEmail);
            return;
          }
          if (
            resume.ok &&
            resume.data.status === "completed" &&
            resume.data.pid &&
            resume.data.token
          ) {
            saveSession({
              pid: String(resume.data.pid),
              token: String(resume.data.token),
              name: resume.data.name ?? fullName,
              email: normalizedEmail,
              phone: phoneDigits,
              workExperience: "",
              domain: "",
              linkedinUrl: registerPayload.linkedinUrl,
              collegeName: registerPayload.collegeName,
              bestDescribeYou: "",
              considerMasters: registerPayload.considerMasters,
              planningYear: registerPayload.planningYear,
              interestsMost: registerPayload.interestsMost,
              registeredAt: Date.now(),
              registered: true,
              answers: {},
              syncedAnswerString: "",
              completed: true,
              submitted: true,
              score: resume.data.score?.totalScore ?? null,
              completionTimeSeconds:
                resume.data.score?.completionTimeSeconds ?? null,
              completedAt: resume.data.score?.completedAt ?? null,
              rank: resume.data.rank ?? null,
              quizStartedAt: null,
            });
            window.location.replace(resultsUrl(normalizedEmail));
            return;
          }
        } catch {
          // Fall through to quiz; QuizClient will re-check completion.
        }

        go(quizUrl(normalizedEmail));
        return;
      }

      const reg = await fetchJson<{
        pid?: string;
        token?: string;
        status?: string;
        existing?: boolean;
        blocked?: boolean;
        tabSwitches?: number;
        error?: string;
      }>("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(registerPayload),
        timeoutMs: 20_000,
      });

      if (!reg.ok) {
        const message =
          reg.data.error ?? "Registration failed. Please try again.";
        setError(message);
        showToast(message);
        return;
      }

      saveSession({
        pid: String(reg.data.pid ?? pid),
        token: String(reg.data.token ?? token),
        name: fullName,
        email: normalizedEmail,
        phone: phoneDigits,
        workExperience: "",
        domain: "",
        linkedinUrl: registerPayload.linkedinUrl,
        collegeName: registerPayload.collegeName,
        bestDescribeYou: "",
        considerMasters: registerPayload.considerMasters,
        planningYear: registerPayload.planningYear,
        interestsMost: registerPayload.interestsMost,
        registeredAt: Date.now(),
        registered: true,
        answers: {},
        syncedAnswerString: "",
        completed: Boolean(reg.data.existing && reg.data.status === "completed"),
        submitted: Boolean(reg.data.existing && reg.data.status === "completed"),
        score: null,
        completionTimeSeconds: null,
        completedAt: null,
        quizStartedAt: null,
      });

      scheduleSync();

      if (reg.data.blocked || reg.data.status === "blocked") {
        setBlockedEmail(normalizedEmail);
        return;
      }

      if (reg.data.existing && reg.data.status === "completed") {
        go(resultsUrl(normalizedEmail));
        return;
      }

      go(quizUrl(normalizedEmail));
    } catch (err) {
      const message = errorMessage(
        err,
        "Network error. Please check your connection and try again."
      );
      setError(message);
      showToast(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResume(e: FormEvent) {
    e.preventDefault();
    setResumeError("");
    await withTimeout(requestEmbedStorageAccess(), 400);
    setResumeSubmitting(true);

    try {
      const normalizedEmail = resumeEmail.trim().toLowerCase();

      // Instant path: already have this email saved in this browser/iframe.
      const local = loadSession();
      if (local && normalizeEmail(local.email) === normalizedEmail && local.token) {
        if (isTabBlocked(local.tabSwitches)) {
          setBlockedEmail(normalizedEmail);
          return;
        }
        const page = local.completed ? "results" : "quiz";
        go(
          page === "results"
            ? resultsUrl(normalizedEmail)
            : quizUrl(normalizedEmail)
        );
        return;
      }

      const res = await fetchJson<{
        pid?: string;
        token?: string;
        name?: string;
        email?: string;
        status?: string;
        error?: string;
        blocked?: boolean;
        tabSwitches?: number;
        quizStartedAt?: string | null;
        rank?: number | null;
        score?: {
          totalScore: number;
          completionTimeSeconds: number;
          completedAt: string | null;
        } | null;
      }>("/api/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
        timeoutMs: 45_000,
      });

      if (!res.ok) {
        const message =
          res.data.error ?? "Couldn't find a registration for that email.";
        setResumeError(message);
        showToast(message);
        return;
      }

      if (res.data.blocked || res.data.status === "blocked") {
        setBlockedEmail(normalizedEmail);
        return;
      }

      clearSession();
      if (res.data.pid && res.data.token) {
        saveSession({
          pid: String(res.data.pid),
          token: String(res.data.token),
          name: String(res.data.name ?? ""),
          email: normalizedEmail,
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
          registered: true,
          answers: {},
          syncedAnswerString: "",
          completed: res.data.status === "completed",
          submitted: res.data.status === "completed",
          score: res.data.score?.totalScore ?? null,
          completionTimeSeconds: res.data.score?.completionTimeSeconds ?? null,
          completedAt: res.data.score?.completedAt ?? null,
          rank: res.data.rank ?? null,
          quizStartedAt: res.data.quizStartedAt
            ? new Date(res.data.quizStartedAt).getTime()
            : null,
          tabSwitches: res.data.tabSwitches ?? 0,
        });
      }

      const page = res.data.status === "completed" ? "results" : "quiz";
      go(
        page === "results"
          ? resultsUrl(normalizedEmail)
          : quizUrl(normalizedEmail)
      );
    } catch (err) {
      const message = errorMessage(
        err,
        "Could not reach the registration server. Please try again."
      );
      setResumeError(message);
      showToast(message);
    } finally {
      setResumeSubmitting(false);
    }
  }

  if (blockedEmail) {
    return (
      <div className="binary-bg min-h-dvh">
        <EmailBlocked email={blockedEmail} />
      </div>
    );
  }

  return (
    <div className="binary-bg min-h-dvh">
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-5 py-12 sm:px-8">
        {/* Top text - centered above form */}
        <header className="mb-8 w-full text-center">
          <h1 className="register-headline">
            USD Law Quiz - test your legal knowledge and climb the leaderboard
          </h1>
        </header>

        {/* Form only */}
        <div className="register-form-panel w-full p-6 sm:p-8">
          {showResume ? (
            <form onSubmit={handleResume} className="space-y-4">
              <input
                id="resumeEmail"
                type="email"
                required
                value={resumeEmail}
                onChange={(e) => setResumeEmail(e.target.value)}
                className="register-input"
                placeholder="Email*"
              />

              {resumeError && (
                <p className="rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                  {resumeError}
                </p>
              )}

              <button
                type="submit"
                disabled={resumeSubmitting}
                className="register-btn-primary"
              >
                {resumeSubmitting ? "Looking up your registration…" : "Continue"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <input
                  id="firstName"
                  type="text"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="register-input"
                  placeholder="First Name*"
                />
                <input
                  id="lastName"
                  type="text"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="register-input"
                  placeholder="Last Name*"
                />
              </div>

              {MINIMAL_REGISTER_FORM ? (
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="register-input"
                  placeholder="Email*"
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="register-input"
                    placeholder="Email*"
                  />
                  <input
                    id="phone"
                    type="text"
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                    minLength={PHONE_MIN_DIGITS}
                    maxLength={PHONE_MAX_DIGITS}
                    pattern="[0-9]{10,12}"
                    title="Enter 10 to 12 digits"
                    value={phone}
                    onChange={(e) => setPhone(digitsOnly(e.target.value))}
                    onBeforeInput={(e) => {
                      const data = (e as unknown as InputEvent).data;
                      if (data && /\D/.test(data)) e.preventDefault();
                    }}
                    onKeyDown={(e) => {
                      if (e.ctrlKey || e.metaKey || e.altKey) return;
                      const allowed = [
                        "Backspace",
                        "Delete",
                        "Tab",
                        "Escape",
                        "Enter",
                        "ArrowLeft",
                        "ArrowRight",
                        "Home",
                        "End",
                      ];
                      if (allowed.includes(e.key)) return;
                      if (!/^\d$/.test(e.key)) e.preventDefault();
                    }}
                    onPaste={(e) => {
                      e.preventDefault();
                      const text = e.clipboardData.getData("text");
                      setPhone(digitsOnly(`${phone}${text}`));
                    }}
                    className="register-input"
                    placeholder="Phone Number*"
                  />
                </div>
              )}

              {!MINIMAL_REGISTER_FORM && (
                <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="collegeName" className="register-label">
                    College / University Name*
                  </label>
                  <input
                    id="collegeName"
                    type="text"
                    required
                    value={collegeName}
                    onChange={(e) => setCollegeName(e.target.value)}
                    placeholder="College / University Name*"
                    className="register-input"
                  />
                </div>

                <div>
                  <label htmlFor="considerMasters" className="register-label">
                    Master&apos;s in the U.S.?*
                  </label>
                  <div className="register-select-wrap">
                    <select
                      id="considerMasters"
                      required
                      value={considerMasters}
                      onChange={(e) => setConsiderMasters(e.target.value)}
                      className="register-input register-select"
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      <option value="Yes, actively planning">
                        Yes, actively planning
                      </option>
                      <option value="Yes, exploring my options">
                        Yes, exploring my options
                      </option>
                      <option value="Maybe in the future">
                        Maybe in the future
                      </option>
                      <option value="Not currently">Not currently</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="planningYear" className="register-label">
                    When are you planning to pursue your Master&apos;s?*
                  </label>
                  <div className="register-select-wrap">
                    <select
                      id="planningYear"
                      required
                      value={planningYear}
                      onChange={(e) => setPlanningYear(e.target.value)}
                      className="register-input register-select"
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      <option value="Spring 2027 (Jan - Mar, 2027)">
                        Spring 2027 (Jan - Mar, 2027)
                      </option>
                      <option value="Fall 2027 (July - Sept, 2027)">
                        Fall 2027 (July - Sept, 2027)
                      </option>
                      <option value="Spring 2028 (Jan - Mar, 2028)">
                        Spring 2028 (Jan - Mar, 2028)
                      </option>
                      <option value="Fall 2028 (July - Sept, 2028)">
                        Fall 2028 (July - Sept, 2028)
                      </option>
                      <option value="Not decided">Not decided</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="interestsMost" className="register-label">
                    What interests you most about the USD Law Quiz?*
                  </label>
                  <div className="register-select-wrap">
                    <select
                      id="interestsMost"
                      required
                      value={interestsMost}
                      onChange={(e) => setInterestsMost(e.target.value)}
                      className="register-input register-select"
                    >
                      <option value="" disabled>
                        Select…
                      </option>
                      <option value="Testing my legal knowledge">
                        Testing my legal knowledge
                      </option>
                      <option value="Winning a scholarship for my U.S. Master's">
                        Winning a scholarship for my U.S. Master&apos;s
                      </option>
                      <option value="Competing with others and seeing where I rank">
                        Competing with others and seeing where I rank
                      </option>
                      <option value="Winning the cash prize">
                        Winning the cash prize
                      </option>
                      <option value="Just curious to see what the quiz is about">
                        Just curious to see what the quiz is about
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label htmlFor="linkedInUrl" className="register-label">
                  LinkedIn Profile URL
                </label>
                <input
                  id="linkedInUrl"
                  type="url"
                  value={linkedInUrl}
                  onChange={(e) => setLinkedInUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/your-handle"
                  className="register-input"
                />
              </div>
                </>
              )}

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="register-btn-primary mt-1"
              >
                {submitting ? "Registering…" : "Register Now"}
              </button>
            </form>
          )}

          <p className="mt-5 text-center text-sm text-white/45">
            <button
              type="button"
              onClick={() => setShowResume((s) => !s)}
              className="text-white/70 hover:text-white hover:underline"
            >
              {showResume ? "New here? Register" : "Already registered? Continue"}
            </button>
            <span className="mx-2 text-white/25">·</span>
            <Link href={STANDINGS_PATH} className="text-white/70 hover:text-white hover:underline">
              Leaderboard
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

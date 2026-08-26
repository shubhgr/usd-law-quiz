"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import LeaderboardView from "@/components/LeaderboardView";
import { normalizeEmail } from "@/lib/quizUrls";
import { resolveCredentialsByEmail, persistResolvedCredentials } from "@/lib/resolveCredentials";
import { loadSession, saveSession } from "@/lib/clientSession";
import type { LeaderboardRow, MeInfo } from "@/components/LeaderboardView";
import { isTabBlocked } from "@/lib/tabSwitch";
import EmailBlocked from "@/components/EmailBlocked";
import {
  getLeaderboardClientCache,
  setCachedRank,
  setLeaderboardClientCache,
} from "@/lib/leaderboardClientCache";
import "./leaderboard.css";

interface LeaderboardResponse {
  topEntries?: LeaderboardRow[];
  entries?: { name: string; rank: number; score: number }[];
  me?: MeInfo | null;
  error?: string;
}

const POLL_MS = 30_000;

function readInitialCache() {
  if (typeof window === "undefined") return null;
  return getLeaderboardClientCache();
}

function LeaderboardShell({
  loading = true,
  rows = [],
  me = null,
  myPid = "",
  pendingName = "",
}: {
  loading?: boolean;
  rows?: LeaderboardRow[];
  me?: MeInfo | null;
  myPid?: string;
  pendingName?: string;
}) {
  return (
    <main className="lb-page relative flex w-full flex-1 flex-col">
      <LeaderboardView
        rows={rows}
        me={me}
        myPid={myPid}
        pendingName={pendingName}
        loading={loading}
      />
    </main>
  );
}

export default function LeaderboardPage() {
  const cached = readInitialCache();
  return (
    <Suspense
      fallback={
        <LeaderboardShell
          loading={!cached?.rows.length}
          rows={cached?.rows ?? []}
          me={cached?.me ?? null}
        />
      }
    >
      <Leaderboard />
    </Suspense>
  );
}

function Leaderboard() {
  const searchParams = useSearchParams();
  const email = normalizeEmail(searchParams.get("email") ?? "");
  const cached = readInitialCache();

  const [pid, setPid] = useState("");
  const [token, setToken] = useState("");
  const [credsReady, setCredsReady] = useState(!email);
  const [myName, setMyName] = useState("");
  const [rows, setRows] = useState<LeaderboardRow[]>(cached?.rows ?? []);
  const [me, setMe] = useState<MeInfo | null>(cached?.me ?? null);
  const [ready, setReady] = useState(Boolean(cached?.rows.length));
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(!cached?.rows.length);
  const [pendingName, setPendingName] = useState("");
  const rowsRef = useRef<LeaderboardRow[]>(cached?.rows ?? []);
  const requestIdRef = useRef(0);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    if (!email) {
      setCredsReady(true);
      return;
    }

    let cancelled = false;
    setCredsReady(false);

    const local = loadSession();
    if (local && normalizeEmail(local.email) === email) {
      if (isTabBlocked(local.tabSwitches)) {
        setBlocked(true);
        setCredsReady(true);
        setLoading(false);
        return;
      }
      setMyName(local.name);
      if (local.pid) setPid(local.pid);
      if (local.token) setToken(local.token);
    }

    (async () => {
      const creds = await resolveCredentialsByEmail(email);
      if (cancelled) return;
      if (!creds) {
        setError("No registration found for this email.");
        setCredsReady(true);
        setLoading(false);
        return;
      }
      if (creds.blocked || creds.status === "blocked" || isTabBlocked(creds.tabSwitches)) {
        persistResolvedCredentials(creds);
        setBlocked(true);
        setCredsReady(true);
        setLoading(false);
        return;
      }
      setPid(creds.pid);
      setToken(creds.token);
      if (creds.name) setMyName(creds.name);
      persistResolvedCredentials(creds);
      setCredsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [email]);

  const loadLeaderboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      // Personalized links must wait for email → pid/token before fetching,
      // otherwise standings returns rows without real pids and "(You)" never matches.
      if (email && !credsReady) return;
      if (email && (!pid || !token)) return;

      const requestId = ++requestIdRef.current;
      const hasRows = rowsRef.current.length > 0;
      if (!opts?.silent && !hasRows) setLoading(true);

      try {
        const url =
          pid && token
            ? `/api/leaderboard?limit=100&pid=${encodeURIComponent(pid)}&token=${encodeURIComponent(token)}`
            : "/api/standings?limit=100";
        const res = await fetch(url);
        const body = (await res.json()) as LeaderboardResponse;
        if (requestId !== requestIdRef.current) return;

        if (!res.ok || body.error) {
          if (res.status === 502 && rowsRef.current.length > 0) return;
          throw new Error(body.error ?? "Failed to load");
        }

        const nextRows: LeaderboardRow[] =
          body.topEntries ??
          (body.entries ?? []).map((e) => ({
            pid: `rank-${e.rank}`,
            name: e.name,
            totalScore: e.score,
            completionTimeSeconds: 0,
            completedAt: "",
          }));

        setRows(nextRows);
        setMe(body.me ?? null);
        setLeaderboardClientCache({
          rows: nextRows,
          me: body.me ?? null,
          myRank: body.me?.rank ?? null,
        });

        if (body.me?.rank) {
          setCachedRank(body.me.rank);
          const cur = loadSession();
          if (cur) saveSession({ ...cur, rank: body.me.rank });
        }

        if (pid && token) {
          const inList = nextRows.some((r) => r.pid === pid);
          if (body.me || inList) {
            setPendingName("");
          } else {
            const local = loadSession();
            if (local?.completed) setPendingName(local.name || myName);
          }
        } else {
          setPendingName("");
        }

        setError("");
        setReady(true);
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        if (rowsRef.current.length > 0) return;
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't load the leaderboard. Please try again."
        );
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [email, credsReady, pid, token, myName]
  );

  useEffect(() => {
    void loadLeaderboard({ silent: rowsRef.current.length > 0 });
    const interval = setInterval(
      () => void loadLeaderboard({ silent: true }),
      pendingName ? 5_000 : POLL_MS
    );
    return () => clearInterval(interval);
  }, [loadLeaderboard, pendingName]);

  if (blocked) {
    return <EmailBlocked email={email} />;
  }

  return (
    <main className="lb-page relative flex w-full flex-1 flex-col">
      <div className="lb-nav flex items-center justify-between gap-3">
        <Link
          href="/college-leaderboard"
          className="lb-back ml-auto"
        >
          College championship →
        </Link>
      </div>

      {error && !ready && (
        <div className="relative z-10 mx-auto mt-6 max-w-xl px-5">
          <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-4 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => void loadLeaderboard()}
              disabled={loading}
              className="cta-button-gradient mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Loading…" : "Try again"}
            </button>
          </div>
        </div>
      )}

      <LeaderboardView
        rows={rows}
        me={me}
        myPid={pid}
        pendingName={pendingName}
        loading={(loading || (Boolean(email) && !credsReady)) && rows.length === 0}
      />
    </main>
  );
}

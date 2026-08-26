"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import LeaderboardView, {
  type LeaderboardRow,
} from "@/components/LeaderboardView";
import type { CollegeStanding } from "@/lib/collegeStandings";
import { STANDINGS_PATH } from "@/lib/quizUrls";
import "../leaderboard/leaderboard.css";

const POLL_MS = 30_000;

function toLeaderboardRows(entries: CollegeStanding[]): LeaderboardRow[] {
  return entries.map((row) => ({
    pid: `college-${row.rank}-${row.collegeName}`,
    name: row.collegeName,
    totalScore: row.combinedScore,
    completionTimeSeconds: row.participants,
    completedAt: "",
  }));
}

export default function CollegeLeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef(0);
  const rowsRef = useRef<LeaderboardRow[]>([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const requestId = ++requestIdRef.current;
    if (!opts?.silent && rowsRef.current.length === 0) setLoading(true);

    try {
      const res = await fetch("/api/college-leaderboard?limit=10");
      const body = (await res.json()) as {
        entries?: CollegeStanding[];
        error?: string;
      };
      if (requestId !== requestIdRef.current) return;

      if (!res.ok || body.error) {
        if (res.status === 502 && rowsRef.current.length > 0) return;
        throw new Error(body.error ?? "Failed to load");
      }

      setRows(toLeaderboardRows(body.entries ?? []));
      setError("");
      setReady(true);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (rowsRef.current.length > 0) return;
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't load the college leaderboard. Please try again."
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({ silent: rowsRef.current.length > 0 });
    const interval = setInterval(() => void load({ silent: true }), POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <main className="lb-page relative flex w-full flex-1 flex-col">
      <div className="lb-nav flex items-center justify-between gap-3">
        <Link href={STANDINGS_PATH} className="lb-back">
          ← Individual leaderboard
        </Link>
      </div>

      {error && !ready && (
        <div className="relative z-10 mx-auto mt-6 max-w-xl px-5">
          <div className="rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-4 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="cta-button-gradient mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Loading…" : "Try again"}
            </button>
          </div>
        </div>
      )}

      <LeaderboardView rows={rows} loading={loading && rows.length === 0} />
    </main>
  );
}

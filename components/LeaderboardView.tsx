"use client";

import { useEffect, useRef } from "react";
import { questions } from "@/lib/questions";
import CourseFab from "@/components/CourseFab";

export interface LeaderboardRow {
  pid: string;
  name: string;
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string;
}

export interface MeInfo {
  rank: number;
  totalScore: number;
  completionTimeSeconds: number;
  completedAt: string;
}

interface PodiumSlot {
  rank: 1 | 2 | 3;
  row: LeaderboardRow | null;
}

function podiumOrder(rows: LeaderboardRow[]): PodiumSlot[] {
  return [
    { rank: 2, row: rows[1] ?? null },
    { rank: 1, row: rows[0] ?? null },
    { rank: 3, row: rows[2] ?? null },
  ];
}

function heightClass(rank: 1 | 2 | 3) {
  if (rank === 1) return "lb-podium-h1";
  if (rank === 2) return "lb-podium-h2";
  return "lb-podium-h3";
}

interface LeaderboardViewProps {
  rows: LeaderboardRow[];
  me?: MeInfo | null;
  myPid?: string;
  pendingName?: string;
  loading?: boolean;
}

function SkeletonPodium() {
  return (
    <div className="lb-trophy-wrap">
      <div className="lb-trophy-bg" aria-hidden />
      <div className="lb-podium-area">
        <div className="lb-podium-grid">
          {([2, 1, 3] as const).map((rank) => (
            <div key={rank} className="lb-podium-slot">
              <p className="lb-podium-name lb-skeleton-text" aria-hidden>
                &nbsp;
              </p>
              <div
                className={`lb-podium-block lb-podium-block--skeleton ${heightClass(rank)}`}
              >
                <span className="lb-podium-rank">{rank}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <ul className="lb-list" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="lb-row lb-row--skeleton">
          <span className="lb-skeleton-bar lb-skeleton-bar--name" />
          <span className="lb-skeleton-bar lb-skeleton-bar--rank" />
        </li>
      ))}
    </ul>
  );
}

export default function LeaderboardView({
  rows,
  me,
  myPid = "",
  pendingName,
  loading = false,
}: LeaderboardViewProps) {
  const youRef = useRef<HTMLLIElement | null>(null);
  const topThree = rows.slice(0, 3);
  const podium = podiumOrder(topThree);

  // Match by pid from the email link / session.
  // Also match by server-reported me.rank when present (authenticated leaderboard).
  const isMe = (row: LeaderboardRow, rank: number) => {
    if (myPid && row.pid === myPid) return true;
    if (myPid && me?.rank === rank) return true;
    return false;
  };

  const meInRows = rows.some((r, i) => isMe(r, i + 1));
  const showMeBanner = Boolean(me) && !meInRows;
  const showPendingYou = Boolean(pendingName) && !meInRows && !me;
  const showSkeleton = loading && rows.length === 0 && !showPendingYou;

  useEffect(() => {
    if (!youRef.current) return;
    youRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [rows, myPid, me]);

  return (
    <div className="lb-page w-full" aria-busy={loading || undefined}>
      {showSkeleton ? (
        <SkeletonPodium />
      ) : topThree.length > 0 ? (
        <div className="lb-trophy-wrap">
          <div className="lb-trophy-bg" aria-hidden />
          <div className="lb-podium-area">
            <div className="lb-podium-grid">
              {podium.map(({ rank, row }) => {
                const mine = row ? isMe(row, rank) : false;
                return (
                  <div key={rank} className="lb-podium-slot">
                    <p
                      className={`lb-podium-name ${mine ? "lb-podium-name--you" : ""}`}
                      title={row?.name}
                    >
                      {row ? (mine ? `${row.name} (You)` : row.name) : ""}
                    </p>
                    <div
                      className={`lb-podium-block ${heightClass(rank)} ${mine ? "lb-podium-block--you" : ""}`}
                    >
                      <span className="lb-podium-rank">{rank}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="lb-trophy-wrap">
          <div className="lb-trophy-bg" aria-hidden />
          <div className="lb-podium-area">
            <div className="lb-podium-grid">
              {([2, 1, 3] as const).map((rank) => (
                <div key={rank} className="lb-podium-slot">
                  <p className="lb-podium-name" />
                  <div className={`lb-podium-block ${heightClass(rank)}`}>
                    <span className="lb-podium-rank">{rank}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto w-full max-w-xl px-5 pb-24 pt-8">
        {loading && (
          <p className="lb-loading-hint" role="status">
            Loading rankings…
          </p>
        )}

        {showMeBanner && me && (
          <div className="lb-me-banner">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#75BEE9]">
              Your rank
            </p>
            <p className="mt-1 text-3xl font-extrabold text-white">#{me.rank}</p>
            <p className="mt-1 text-sm text-slate-400">
              {me.totalScore} / {questions.length} ·{" "}
              {formatDuration(me.completionTimeSeconds)}
            </p>
          </div>
        )}

        {showSkeleton ? (
          <SkeletonRows />
        ) : (
          <ul className="lb-list">
            {showPendingYou && pendingName && (
              <li className="lb-row lb-row--you" ref={youRef}>
                <span className="lb-row-name" title={pendingName}>
                  {pendingName} (You)
                </span>
                <span className="lb-row-rank lb-row-rank--pending">
                  calculating…
                </span>
              </li>
            )}
            {rows.map((row, i) => {
              const rank = i + 1;
              const mine = isMe(row, rank);
              return (
                <li
                  key={`${row.pid}-${rank}`}
                  ref={mine ? youRef : undefined}
                  className={`lb-row ${mine ? "lb-row--you" : ""}`}
                >
                  <span className="lb-row-name" title={row.name}>
                    {mine ? `${row.name} (You)` : row.name}
                  </span>
                  <span className="lb-row-rank">#{rank}</span>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && rows.length === 0 && !showPendingYou && (
          <p className="mt-4 text-center text-sm text-slate-500">
            No scores yet. Be the first to finish!
          </p>
        )}
      </div>

      <CourseFab />
    </div>
  );
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

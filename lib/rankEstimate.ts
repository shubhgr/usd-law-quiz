import type { LeaderboardRow } from "@/components/LeaderboardView";
import {
  getLeaderboardClientCache,
  setLeaderboardClientCache,
} from "@/lib/leaderboardClientCache";

/** Estimate 1-based rank before Sheets confirms (insert self into sorted list). */
export function estimateRank(
  rows: LeaderboardRow[],
  myScore: number,
  myTimeSeconds: number,
  myPid?: string
): number {
  let better = 0;
  for (const row of rows) {
    if (myPid && row.pid === myPid) continue;
    if (row.totalScore > myScore) {
      better += 1;
      continue;
    }
    if (
      row.totalScore === myScore &&
      row.completionTimeSeconds < myTimeSeconds
    ) {
      better += 1;
    }
  }
  return better + 1;
}

/** Warm the public standings cache in the background (no auth). */
export function prefetchStandings(): void {
  if (typeof window === "undefined") return;
  const existing = getLeaderboardClientCache();
  if (existing && existing.rows.length > 0 && Date.now() - existing.at < 30_000) {
    return;
  }
  void fetch("/api/standings?limit=100")
    .then(async (res) => {
      if (!res.ok) return;
      const body = (await res.json()) as {
        entries?: { name: string; rank: number; score: number }[];
        topEntries?: LeaderboardRow[];
      };
      const rows: LeaderboardRow[] =
        body.topEntries ??
        (body.entries ?? []).map((e) => ({
          pid: `rank-${e.rank}`,
          name: e.name,
          totalScore: e.score,
          completionTimeSeconds: 0,
          completedAt: "",
        }));
      if (rows.length) setLeaderboardClientCache({ rows });
    })
    .catch(() => {
      // ignore
    });
}

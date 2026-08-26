import { hasDatabaseUrl, query } from "@/lib/db";
import type { CollegeStanding } from "@/lib/collegeStandings";

export type { CollegeStanding } from "@/lib/collegeStandings";

const TTL_MS = 45_000;
const FETCH_LIMIT = 100;

interface CacheEntry {
  at: number;
  rows: CollegeStanding[];
}

let cache: CacheEntry | null = null;
let inflight: Promise<CollegeStanding[]> | null = null;

function normalizeCollegeKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function displayCollegeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

async function fetchCollegeStandings(): Promise<CollegeStanding[]> {
  if (!hasDatabaseUrl()) {
    // College aggregation is Postgres-first; Sheets mirror doesn't group by college yet.
    return [];
  }

  const raw = await query<{
    college_name: string | null;
    participants: number;
    combined_score: number;
  }>(
    `SELECT
       TRIM(p.college_name) AS college_name,
       COUNT(*)::int AS participants,
       SUM(a.score)::int AS combined_score
     FROM participants p
     JOIN attempts a ON a.pid = p.pid
     WHERE a.score IS NOT NULL
       AND p.college_name IS NOT NULL
       AND TRIM(p.college_name) <> ''
     GROUP BY TRIM(p.college_name)
     ORDER BY
       SUM(a.score) DESC,
       COUNT(*) DESC,
       TRIM(p.college_name) ASC
     LIMIT $1`,
    [FETCH_LIMIT]
  );

  // Merge case-insensitive duplicates that TRIM alone didn't collapse.
  const merged = new Map<
    string,
    { collegeName: string; participants: number; combinedScore: number }
  >();

  for (const row of raw) {
    const display = displayCollegeName(String(row.college_name ?? ""));
    if (!display) continue;
    const key = normalizeCollegeKey(display);
    const prev = merged.get(key);
    if (prev) {
      prev.participants += Number(row.participants);
      prev.combinedScore += Number(row.combined_score);
    } else {
      merged.set(key, {
        collegeName: display,
        participants: Number(row.participants),
        combinedScore: Number(row.combined_score),
      });
    }
  }

  return [...merged.values()]
    .sort((a, b) => {
      if (b.combinedScore !== a.combinedScore) {
        return b.combinedScore - a.combinedScore;
      }
      if (b.participants !== a.participants) {
        return b.participants - a.participants;
      }
      return a.collegeName.localeCompare(b.collegeName);
    })
    .map((row, i) => ({
      ...row,
      rank: i + 1,
    }));
}

export function invalidateCollegeLeaderboardCache() {
  cache = null;
}

export async function getCachedCollegeLeaderboard(params?: {
  limit?: number;
}): Promise<CollegeStanding[]> {
  const limit = Math.min(
    FETCH_LIMIT,
    Math.max(1, Math.trunc(params?.limit ?? FETCH_LIMIT))
  );

  if (cache && Date.now() - cache.at <= TTL_MS) {
    return cache.rows.slice(0, limit);
  }

  if (!inflight) {
    inflight = fetchCollegeStandings().finally(() => {
      inflight = null;
    });
  }

  try {
    const rows = await inflight;
    cache = { at: Date.now(), rows };
    return rows.slice(0, limit);
  } catch (err) {
    if (cache?.rows.length) return cache.rows.slice(0, limit);
    throw err;
  }
}

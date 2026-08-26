import { gasLeaderboard, type LeaderboardInfo } from "@/lib/sheets";
import { hasDatabaseUrl, query } from "@/lib/db";

const TTL_MS = 45_000;
const FETCH_LIMIT = 100;

type MeInfo = LeaderboardInfo["me"];
type Entry = LeaderboardInfo["topEntries"][number];

interface CacheEntry {
  at: number;
  topEntries: Entry[];
  meByPid: Record<string, MeInfo>;
}

let cache: CacheEntry | null = null;
let inflight: Promise<Entry[]> | null = null;

function meFromEntry(entry: Entry, rank: number): NonNullable<MeInfo> {
  return {
    rank,
    totalScore: entry.totalScore,
    completionTimeSeconds: entry.completionTimeSeconds,
    completedAt: entry.completedAt,
  };
}

function indexEntries(entries: Entry[]) {
  const meByPid: Record<string, MeInfo> = { ...(cache?.meByPid ?? {}) };
  entries.forEach((entry, i) => {
    meByPid[entry.pid] = meFromEntry(entry, i + 1);
  });
  return meByPid;
}

function view(pid: string, limit: number, source: CacheEntry): LeaderboardInfo {
  const topEntries = source.topEntries.slice(0, limit);
  let me: MeInfo = null;
  if (pid) {
    me = source.meByPid[pid] ?? null;
    if (!me) {
      const idx = source.topEntries.findIndex((e) => e.pid === pid);
      if (idx >= 0) me = meFromEntry(source.topEntries[idx], idx + 1);
    }
  }
  return { ok: true, topEntries, me };
}

async function fetchEntries(pid?: string): Promise<Entry[]> {
  if (!hasDatabaseUrl()) {
    const result = await gasLeaderboard({
      pid: pid || undefined,
      limit: FETCH_LIMIT,
    });
    const meByPid = indexEntries(result.topEntries);
    if (pid && result.me) {
      meByPid[pid] = result.me;
    }
    cache = {
      at: Date.now(),
      topEntries: result.topEntries,
      meByPid,
    };
    return result.topEntries;
  }

  // Postgres-first: fetch the public top-100 and compute `me` rank (even if
  // the user isn't in the top 100) using the same ordering rules.
  const topRaw = await query<
    Pick<Entry, "pid" | "name" | "totalScore" | "completionTimeSeconds" | "completedAt">
  >(
    `WITH ranked AS (
       SELECT
         p.pid,
         p.name,
         a.score::int AS "totalScore",
         a.completion_time_seconds::int AS "completionTimeSeconds",
         a.completed_at AS "completedAt",
         ROW_NUMBER() OVER (
           ORDER BY
             a.score DESC,
             a.completion_time_seconds ASC,
             a.completed_at ASC
         ) AS rank
       FROM participants p
       JOIN attempts a ON a.pid = p.pid
       WHERE a.score IS NOT NULL
     )
     SELECT
       pid,
       name,
       "totalScore",
       "completionTimeSeconds",
       "completedAt"
     FROM ranked
     ORDER BY rank
     LIMIT $1`,
    [FETCH_LIMIT]
  );

  const top = topRaw.map((e) => ({
    pid: e.pid,
    name: e.name,
    totalScore: Number(e.totalScore),
    completionTimeSeconds: Number(e.completionTimeSeconds),
    completedAt: e.completedAt ? new Date(e.completedAt as unknown as string).toISOString() : null,
  }));

  const meByPid = indexEntries(top);

  if (pid) {
    const meRows = await query<{
      rank: number;
      totalScore: number;
      completionTimeSeconds: number;
      completedAt: string | null;
    }>(
      `WITH ranked AS (
         SELECT
           p.pid,
           p.name,
           a.score::int AS "totalScore",
           a.completion_time_seconds::int AS "completionTimeSeconds",
           a.completed_at AS "completedAt",
           ROW_NUMBER() OVER (
             ORDER BY
               a.score DESC,
               a.completion_time_seconds ASC,
               a.completed_at ASC
           ) AS rank
         FROM participants p
         JOIN attempts a ON a.pid = p.pid
         WHERE a.score IS NOT NULL
       )
       SELECT
         rank,
         "totalScore",
         "completionTimeSeconds",
         "completedAt"
       FROM ranked
       WHERE pid = $1
       LIMIT 1`,
      [pid]
    );

    if (meRows.length) {
      const m = meRows[0]!;
      meByPid[pid] = {
        rank: Number(m.rank),
        totalScore: Number(m.totalScore),
        completionTimeSeconds: Number(m.completionTimeSeconds),
        completedAt: m.completedAt ? new Date(m.completedAt as unknown as string).toISOString() : null,
      };
    }
  }

  cache = {
    at: Date.now(),
    topEntries: top,
    meByPid,
  };

  return top;
}

export function invalidateLeaderboardCache() {
  cache = null;
}

export async function getCachedLeaderboard(params: {
  pid?: string;
  limit: number;
}): Promise<LeaderboardInfo> {
  const pid = params.pid ?? "";
  const limit = Math.min(FETCH_LIMIT, Math.max(1, params.limit));

  if (cache && Date.now() - cache.at <= TTL_MS) {
    const result = view(pid, limit, cache);
    // Serve cache when we don't need me, or me is already known / in the list.
    if (!pid || result.me) return result;
  }

  if (!inflight) {
    inflight = fetchEntries(pid || undefined).finally(() => {
      inflight = null;
    });
  }

  try {
    await inflight;
    if (cache) {
      const result = view(pid, limit, cache);
      if (!pid || result.me) return result;
      // Shared inflight may have been started without this pid — fetch me specifically.
      await fetchEntries(pid);
      if (cache) return view(pid, limit, cache);
    }
    throw new Error("Leaderboard cache missing after fetch");
  } catch (err) {
    if (cache && cache.topEntries.length > 0) return view(pid, limit, cache);
    throw err;
  }
}

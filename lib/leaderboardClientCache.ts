import type { LeaderboardRow, MeInfo } from "@/components/LeaderboardView";

const KEY = "usd-leaderboard-cache";
const TTL_MS = 5 * 60_000;

export interface LeaderboardClientCache {
  at: number;
  rows: LeaderboardRow[];
  me: MeInfo | null;
  myRank: number | null;
}

let memory: LeaderboardClientCache | null = null;

function readStorage(): LeaderboardClientCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaderboardClientCache;
    if (!parsed?.rows || !Array.isArray(parsed.rows)) return null;
    if (Date.now() - parsed.at > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(cache: LeaderboardClientCache) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // ignore blocked storage
  }
}

export function getLeaderboardClientCache(): LeaderboardClientCache | null {
  if (memory && Date.now() - memory.at <= TTL_MS) return memory;
  const stored = readStorage();
  if (stored) {
    memory = stored;
    return stored;
  }
  return null;
}

export function setLeaderboardClientCache( partial: {
  rows: LeaderboardRow[];
  me?: MeInfo | null;
  myRank?: number | null;
}) {
  const prev = getLeaderboardClientCache();
  const next: LeaderboardClientCache = {
    at: Date.now(),
    rows: partial.rows,
    me: partial.me !== undefined ? partial.me : prev?.me ?? null,
    myRank:
      partial.myRank !== undefined
        ? partial.myRank
        : partial.me?.rank ?? prev?.myRank ?? null,
  };
  memory = next;
  writeStorage(next);
  return next;
}

export function setCachedRank(rank: number) {
  const prev = getLeaderboardClientCache();
  const next: LeaderboardClientCache = {
    at: Date.now(),
    rows: prev?.rows ?? [],
    me: prev?.me ?? null,
    myRank: rank,
  };
  memory = next;
  writeStorage(next);
}

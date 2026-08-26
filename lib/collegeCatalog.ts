import "server-only";

import { readFileSync } from "fs";
import path from "path";
import { hasDatabaseUrl, query } from "@/lib/db";

export interface CollegeCatalogEntry {
  name: string;
  aliases: string[];
  city: string;
  state: string;
}

let cachedCatalog: CollegeCatalogEntry[] | null = null;

function loadCatalog(): CollegeCatalogEntry[] {
  if (cachedCatalog) return cachedCatalog;
  const filePath = path.join(process.cwd(), "data", "college-catalog.json");
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    cachedCatalog = [];
    return cachedCatalog;
  }
  cachedCatalog = parsed
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      if (!name) return null;
      const aliases = Array.isArray(r.aliases)
        ? r.aliases.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
        : [];
      return {
        name,
        aliases,
        city: typeof r.city === "string" ? r.city : "",
        state: typeof r.state === "string" ? r.state : "",
      };
    })
    .filter((x): x is CollegeCatalogEntry => Boolean(x));
  return cachedCatalog;
}

function scoreMatch(entry: CollegeCatalogEntry, q: string, tokens: string[]): number {
  const name = entry.name.toLowerCase();
  const aliases = entry.aliases.map((a) => a.toLowerCase());
  const hay = [name, ...aliases, entry.city.toLowerCase(), entry.state.toLowerCase()].join(" ");

  if (!tokens.every((t) => hay.includes(t))) return -1;

  let score = 0;
  if (aliases.some((a) => a === q)) score += 100;
  if (aliases.some((a) => a.startsWith(q))) score += 60;
  if (name.startsWith(q)) score += 50;
  if (name.includes(q)) score += 30;
  if (aliases.some((a) => a.includes(q))) score += 25;
  // Prefer shorter names when equally relevant
  score += Math.max(0, 20 - Math.floor(entry.name.length / 10));
  return score;
}

async function loadDbCollegeNames(): Promise<string[]> {
  if (!hasDatabaseUrl()) return [];
  try {
    const rows = await query<{ name: string }>(
      `SELECT name FROM colleges ORDER BY lower(name) ASC LIMIT 5000`
    );
    return rows.map((r) => r.name).filter(Boolean);
  } catch {
    // Table may not exist yet.
    return [];
  }
}

export async function searchCollegeNames(query: string, limit = 20): Promise<string[]> {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const tokens = q.split(" ").filter(Boolean);

  const scored: { name: string; score: number }[] = [];
  for (const entry of loadCatalog()) {
    const score = scoreMatch(entry, q, tokens);
    if (score >= 0) scored.push({ name: entry.name, score });
  }

  // Admin-created colleges from Neon
  for (const name of await loadDbCollegeNames()) {
    const lower = name.toLowerCase();
    if (!tokens.every((t) => lower.includes(t))) continue;
    let score = 40;
    if (lower === q) score = 120;
    else if (lower.startsWith(q)) score = 70;
    scored.push({ name, score });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of scored) {
    const key = row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row.name);
    if (out.length >= limit) break;
  }
  return out;
}

export function collegeCatalogSize(): number {
  return loadCatalog().length;
}

export interface CollegeListItem {
  name: string;
  id: number | null;
  source: "catalog" | "custom";
  participantCount: number;
  completedCount: number;
}

type ParticipationRow = {
  name: string;
  participant_count: number;
  completed_count: number;
};

let rankedListCache: { at: number; items: CollegeListItem[] } | null = null;
const RANKED_TTL_MS = 20_000;

export function invalidateCollegeAdminListCache() {
  rankedListCache = null;
}

async function loadParticipationRows(): Promise<ParticipationRow[]> {
  if (!hasDatabaseUrl()) return [];
  try {
    return await query<ParticipationRow>(
      `SELECT
         TRIM(college_name) AS name,
         COUNT(*)::int AS participant_count,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count
       FROM participants
       WHERE college_name IS NOT NULL
         AND TRIM(college_name) <> ''
       GROUP BY TRIM(college_name)`
    );
  } catch {
    return [];
  }
}

async function buildRankedCollegeList(): Promise<CollegeListItem[]> {
  const now = Date.now();
  if (rankedListCache && now - rankedListCache.at < RANKED_TTL_MS) {
    return rankedListCache.items;
  }

  const [managed, stats] = await Promise.all([
    listManagedColleges("", 5000),
    loadParticipationRows(),
  ]);
  const managedByLower = new Map(
    managed.map((m) => [m.name.toLowerCase(), m] as const)
  );
  const statsByLower = new Map(
    stats.map((r) => [r.name.toLowerCase(), r] as const)
  );

  const byLower = new Map<string, CollegeListItem>();

  for (const entry of loadCatalog()) {
    const key = entry.name.toLowerCase();
    const s = statsByLower.get(key);
    const m = managedByLower.get(key);
    byLower.set(key, {
      name: entry.name,
      id: m?.id ?? null,
      source: m ? "custom" : "catalog",
      participantCount: s?.participant_count ?? 0,
      completedCount: s?.completed_count ?? 0,
    });
  }

  for (const m of managed) {
    const key = m.name.toLowerCase();
    const existing = byLower.get(key);
    const s = statsByLower.get(key);
    byLower.set(key, {
      name: existing?.name ?? m.name,
      id: m.id,
      source: "custom",
      participantCount:
        s?.participant_count ?? existing?.participantCount ?? 0,
      completedCount: s?.completed_count ?? existing?.completedCount ?? 0,
    });
  }

  // Assigned names that aren't in catalog/managed yet
  for (const s of stats) {
    const key = s.name.toLowerCase();
    if (byLower.has(key)) continue;
    const m = managedByLower.get(key);
    byLower.set(key, {
      name: s.name,
      id: m?.id ?? null,
      source: m ? "custom" : "catalog",
      participantCount: s.participant_count,
      completedCount: s.completed_count,
    });
  }

  const items = [...byLower.values()].sort(
    (a, b) =>
      b.participantCount - a.participantCount ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  rankedListCache = { at: now, items };
  return items;
}

/** Full catalog + custom colleges, ranked by participant count (most first). */
export async function listCollegesByParticipation(
  search = "",
  offset = 0,
  limit = 80
): Promise<{
  catalogTotal: number;
  results: CollegeListItem[];
  offset: number;
  hasMore: boolean;
}> {
  const capped = Math.min(200, Math.max(1, Math.trunc(limit)));
  const start = Math.max(0, Math.trunc(offset));
  const q = search.trim().toLowerCase().replace(/\s+/g, " ");
  const tokens = q ? q.split(" ").filter(Boolean) : [];

  const ranked = await buildRankedCollegeList();
  const filtered = q
    ? ranked.filter((item) => {
        const hay = item.name.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
    : ranked;

  const slice = filtered.slice(start, start + capped);
  return {
    catalogTotal: filtered.length,
    results: slice,
    offset: start,
    hasMore: start + capped < filtered.length,
  };
}

export async function browseColleges(
  search = "",
  offset = 0,
  limit = 50
): Promise<{
  catalogTotal: number;
  results: CollegeListItem[];
  offset: number;
  hasMore: boolean;
}> {
  const capped = Math.min(100, Math.max(1, Math.trunc(limit)));
  const start = Math.max(0, Math.trunc(offset));
  const managed = await listManagedColleges("", 5000);
  const managedByLower = new Map(
    managed.map((m) => [m.name.toLowerCase(), m] as const)
  );

  const toItem = (name: string): CollegeListItem => {
    const m = managedByLower.get(name.toLowerCase());
    return {
      name,
      id: m?.id ?? null,
      source: m ? "custom" : "catalog",
      participantCount: 0,
      completedCount: 0,
    };
  };

  const q = search.trim();
  if (q) {
    const names = await searchCollegeNames(q, capped);
    return {
      catalogTotal: collegeCatalogSize(),
      results: names.map(toItem),
      offset: 0,
      hasMore: false,
    };
  }

  const catalog = loadCatalog();
  const slice = catalog.slice(start, start + capped);
  return {
    catalogTotal: catalog.length,
    results: slice.map((e) => toItem(e.name)),
    offset: start,
    hasMore: start + capped < catalog.length,
  };
}

export async function addCollegeName(name: string): Promise<string> {
  const cleaned = name.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("College name is required");
  if (!hasDatabaseUrl()) throw new Error("Database is not configured");

  await query(
    `INSERT INTO colleges(name)
     VALUES ($1)
     ON CONFLICT (name) DO NOTHING`,
    [cleaned]
  );
  invalidateCollegeAdminListCache();
  return cleaned;
}

export interface ManagedCollege {
  id: number;
  name: string;
  createdAt: string | null;
}

export async function listManagedColleges(
  search = "",
  limit = 200
): Promise<ManagedCollege[]> {
  if (!hasDatabaseUrl()) return [];
  const q = search.trim().replace(/\s+/g, " ");
  const capped = Math.min(5000, Math.max(1, Math.trunc(limit)));

  try {
    if (!q) {
      return await query<ManagedCollege>(
        `SELECT id, name, created_at AS "createdAt"
         FROM colleges
         ORDER BY lower(name) ASC
         LIMIT $1`,
        [capped]
      );
    }

    return await query<ManagedCollege>(
      `SELECT id, name, created_at AS "createdAt"
       FROM colleges
       WHERE name ILIKE $1
       ORDER BY lower(name) ASC
       LIMIT $2`,
      [`%${q}%`, capped]
    );
  } catch {
    return [];
  }
}

/** Rename a college (managed id and/or any assigned catalog name). */
export async function renameCollegeName(args: {
  id?: number | null;
  fromName?: string;
  toName: string;
}): Promise<{ id: number | null; name: string; oldName: string }> {
  const cleaned = args.toName.trim().replace(/\s+/g, " ");
  if (!cleaned) throw new Error("College name is required");
  if (!hasDatabaseUrl()) throw new Error("Database is not configured");

  let oldName = typeof args.fromName === "string" ? args.fromName.trim() : "";
  let id = typeof args.id === "number" && args.id > 0 ? args.id : null;

  if (id) {
    const existing = await query<{ id: number; name: string }>(
      `SELECT id, name FROM colleges WHERE id = $1`,
      [id]
    );
    if (!existing.length) throw new Error("College not found");
    oldName = existing[0]!.name;
  }

  if (!oldName) throw new Error("Current college name is required");
  if (oldName === cleaned) {
    return { id, name: cleaned, oldName };
  }

  const clash = await query<{ id: number }>(
    `SELECT id FROM colleges WHERE lower(name) = lower($1) LIMIT 1`,
    [cleaned]
  );
  if (clash.length && clash[0]!.id !== id) {
    throw new Error("A college with that name already exists");
  }

  if (id) {
    await query(`UPDATE colleges SET name = $2 WHERE id = $1`, [id, cleaned]);
  } else {
    const inserted = await query<{ id: number }>(
      `INSERT INTO colleges(name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [cleaned]
    );
    if (inserted.length) {
      id = inserted[0]!.id;
    } else {
      const existing = await query<{ id: number }>(
        `SELECT id FROM colleges WHERE lower(name) = lower($1) LIMIT 1`,
        [cleaned]
      );
      id = existing[0]?.id ?? null;
    }

    await query(`DELETE FROM colleges WHERE lower(name) = lower($1)`, [oldName]);
  }

  await query(
    `UPDATE participants
       SET college_name = $2
     WHERE lower(trim(college_name)) = lower($1)`,
    [oldName, cleaned]
  );

  invalidateCollegeAdminListCache();
  return { id, name: cleaned, oldName };
}

export async function renameManagedCollege(
  id: number,
  nextName: string
): Promise<{ id: number; name: string; oldName: string }> {
  const result = await renameCollegeName({ id, toName: nextName });
  if (result.id == null) throw new Error("College not found");
  return { id: result.id, name: result.name, oldName: result.oldName };
}

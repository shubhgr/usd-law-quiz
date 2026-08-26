import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { hasDatabaseUrl, query } from "@/lib/db";

export interface AdminParticipant {
  pid: string;
  name: string;
  email: string;
  phone: string;
  collegeName: string | null;
  status: string;
  score: number | null;
  rank: number | null;
  completionTimeSeconds: number | null;
  registeredAt: string | null;
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 }
    );
  }

  const filter = request.nextUrl.searchParams.get("filter") ?? "all";
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().toLowerCase();

  const rows = await query<{
    pid: string;
    name: string;
    email: string;
    phone: string | null;
    college_name: string | null;
    status: string;
    score: number | null;
    completion_time_seconds: number | null;
    registered_at: string | null;
  }>(
    `SELECT
       p.pid,
       p.name,
       p.email,
       p.phone,
       p.college_name,
       p.status,
       a.score,
       a.completion_time_seconds,
       p.registered_at
     FROM participants p
     LEFT JOIN attempts a ON a.pid = p.pid
     ORDER BY
       (a.score IS NULL) ASC,
       a.score DESC NULLS LAST,
       a.completion_time_seconds ASC NULLS LAST,
       p.registered_at DESC
     LIMIT 1000`
  );

  const scored = rows
    .filter((r) => r.score !== null)
    .sort((a, b) => {
      const scoreDiff = Number(b.score) - Number(a.score);
      if (scoreDiff !== 0) return scoreDiff;
      const timeA = a.completion_time_seconds ?? Number.POSITIVE_INFINITY;
      const timeB = b.completion_time_seconds ?? Number.POSITIVE_INFINITY;
      return timeA - timeB;
    });
  const rankByPid = new Map<string, number>();
  scored.forEach((r, i) => rankByPid.set(r.pid, i + 1));

  let participants: AdminParticipant[] = rows.map((r) => ({
    pid: r.pid,
    name: r.name,
    email: r.email,
    phone: (r.phone ?? "").trim(),
    collegeName: r.college_name?.trim() || null,
    status: r.status,
    score: r.score === null ? null : Number(r.score),
    rank: rankByPid.get(r.pid) ?? null,
    completionTimeSeconds:
      r.completion_time_seconds === null
        ? null
        : Number(r.completion_time_seconds),
    registeredAt: r.registered_at
      ? new Date(r.registered_at).toISOString()
      : null,
  }));

  if (filter === "missing") {
    participants = participants.filter((p) => !p.collegeName);
  } else if (filter === "completed") {
    participants = participants.filter((p) => p.score !== null);
  } else if (filter === "completed_missing") {
    participants = participants.filter((p) => p.score !== null && !p.collegeName);
  }

  if (q) {
    participants = participants.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        (p.collegeName ?? "").toLowerCase().includes(q)
    );
  }

  return NextResponse.json({
    participants,
    counts: {
      total: rows.length,
      missingCollege: rows.filter((r) => !r.college_name?.trim()).length,
      completed: rows.filter((r) => r.score !== null).length,
      completedMissingCollege: rows.filter(
        (r) => r.score !== null && !r.college_name?.trim()
      ).length,
    },
  });
}

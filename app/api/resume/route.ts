import { NextResponse, type NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import { gasResume } from "@/lib/sheets";
import { respondSheetsError } from "@/lib/handleSheetsError";
import { hasDatabaseUrl, query } from "@/lib/db";
import { isTabBlocked } from "@/lib/tabSwitch";
import {
  clearResumeCache,
  getResumeCache,
  setResumeCache,
} from "@/lib/resumeCache";

const RESUME_TTL_MS = 60_000;

interface ResumeBody {
  pid: string;
  token: string;
  name: string;
  email: string;
  status: string;
  lastActivityAt: string | null;
  answers?: string;
  score?: {
    totalScore: number;
    completionTimeSeconds: number;
    completedAt: string | null;
  } | null;
  rank?: number | null;
  tabSwitches?: number;
  blocked?: boolean;
  quizStartedAt?: string | null;
}

async function resumeByEmail(email: string) {
  const normalized =
    typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!normalized) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(normalized)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const cached = getResumeCache(normalized);
  if (cached && Date.now() - cached.at <= RESUME_TTL_MS) {
    return NextResponse.json(cached.body);
  }

  if (hasDatabaseUrl()) {
    const rows = await query<{
      pid: string;
      name: string;
      email: string;
      status: string;
      last_activity_at: string | null;
      answers: string | null;
      score: number | null;
      completion_time_seconds: number | null;
      completed_at: string | null;
      tab_switches: number | null;
      quiz_started_at: string | null;
    }>(
      `SELECT
         p.pid,
         p.name,
         p.email,
         p.status,
         p.last_activity_at,
         a.answers,
         a.score,
         a.completion_time_seconds,
         a.completed_at,
         COALESCE(p.tab_switches, 0) AS tab_switches,
         p.quiz_started_at
       FROM participants p
       LEFT JOIN attempts a ON a.pid = p.pid
       WHERE p.email = $1
       LIMIT 1`,
      [normalized]
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    }

    const r = rows[0]!;
    const tabSwitches = Number(r.tab_switches) || 0;
    if (isTabBlocked(tabSwitches)) {
      const body: ResumeBody = {
        pid: r.pid,
        token: signToken(r.pid),
        name: r.name,
        email: r.email,
        status: "blocked",
        lastActivityAt: r.last_activity_at
          ? new Date(r.last_activity_at).toISOString()
          : null,
        answers: "",
        score: null,
        rank: null,
        tabSwitches,
        blocked: true,
      };
      setResumeCache(normalized, body);
      return NextResponse.json(body);
    }
    const answers = (r.answers ?? "").toString();
    const scoreObj =
      r.score !== null && r.completion_time_seconds !== null
        ? {
            totalScore: Number(r.score),
            completionTimeSeconds: Number(r.completion_time_seconds),
            completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
          }
        : null;

    const computedStatus =
      scoreObj ? "completed" : answers ? "in_progress" : "not_started";

    let rank: number | null = null;
    if (scoreObj) {
      const ranked = await query<{
        rank: number;
      }>(
        `WITH ranked AS (
          SELECT
            p.pid,
            ROW_NUMBER() OVER (
              ORDER BY a.score DESC,
                       a.completion_time_seconds ASC,
                       a.completed_at ASC
            ) AS rank
          FROM participants p
          JOIN attempts a ON a.pid = p.pid
          WHERE a.score IS NOT NULL
        )
        SELECT rank FROM ranked WHERE pid = $1`,
        [r.pid]
      );
      rank = ranked.length ? Number(ranked[0]!.rank) : null;
    }

    const body: ResumeBody = {
      pid: r.pid,
      token: signToken(r.pid),
      name: r.name,
      email: r.email,
      status: computedStatus,
      lastActivityAt: scoreObj?.completedAt ?? null,
      answers,
      score: scoreObj,
      rank,
      tabSwitches,
      blocked: false,
      quizStartedAt: r.quiz_started_at
        ? new Date(r.quiz_started_at).toISOString()
        : null,
    };

    setResumeCache(normalized, body);
    return NextResponse.json(body);
  }

  try {
    const existing = await gasResume(normalized);
    const body: ResumeBody = {
      pid: existing.pid,
      token: signToken(existing.pid),
      name: existing.name,
      email: existing.email,
      status: existing.status,
      lastActivityAt: existing.lastActivityAt,
      answers: existing.answers ?? "",
      score: existing.score ?? null,
      rank: existing.rank ?? null,
      tabSwitches: existing.tabSwitches ?? 0,
      blocked: Boolean(existing.blocked) || existing.status === "blocked",
      quizStartedAt: existing.quizStartedAt ?? null,
    };
    setResumeCache(normalized, body);
    return NextResponse.json(body);
  } catch (err) {
    const response = respondSheetsError(err);
    if (response) return response;
    console.error("[resume]", err);
    return NextResponse.json(
      { error: "Could not reach the registration server. Please try again." },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email") ?? "";
  return resumeByEmail(email);
}

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  return resumeByEmail(body.email ?? "");
}

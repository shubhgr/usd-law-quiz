import crypto from "crypto";
import { NextResponse } from "next/server";
import { signToken } from "@/lib/token";
import { gasRegister } from "@/lib/sheets";
import { hasDatabaseUrl, query } from "@/lib/db";
import { isTabBlocked } from "@/lib/tabSwitch";
import { utmFromRegisterBody } from "@/lib/utm";
import { COMPETITION_NAME, MINIMAL_REGISTER_FORM } from "@/lib/config";

// Zapier Catch Hook for lead capture.
// Kept server-side so the URL isn't exposed to the browser bundle.
const ZAPIER_CATCH_HOOK_URL =
  "https://hooks.zapier.com/hooks/catch/26346452/4tnggzc/";

function postToZapier(payload: Record<string, unknown>) {
  // Fire-and-forget: never block UI registration flow.
  void fetch(ZAPIER_CATCH_HOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}

interface RegisterBody {
  pid?: string;
  name?: string;
  email?: string;
  phone?: string;
  workExperience?: string;
  domain?: string;
  linkedinUrl?: string;
  collegeName?: string;
  bestDescribeYou?: string;
  considerMasters?: string;
  planningYear?: string;
  interestsMost?: string;
  pageUrl?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  utm_id?: string;
}

export async function POST(request: Request) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const workExperience =
    typeof body.workExperience === "string" ? body.workExperience.trim() : null;
  const domain = typeof body.domain === "string" ? body.domain.trim() : null;
  const linkedinUrl =
    typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : null;
  const collegeName =
    (typeof body.collegeName === "string" ? body.collegeName.trim() : "") ||
    (MINIMAL_REGISTER_FORM ? "Test College" : "");
  const bestDescribeYou =
    typeof body.bestDescribeYou === "string" ? body.bestDescribeYou.trim() : null;
  const considerMasters =
    typeof body.considerMasters === "string" ? body.considerMasters.trim() : null;
  const planningYear =
    typeof body.planningYear === "string" ? body.planningYear.trim() : null;
  const interestsMost =
    typeof body.interestsMost === "string" ? body.interestsMost.trim() : null;

  if (!name || !email) {
    return NextResponse.json(
      { error: "name and email are required" },
      { status: 400 }
    );
  }
  if (!collegeName) {
    return NextResponse.json(
      { error: "college / university name is required" },
      { status: 400 }
    );
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Accept a client-supplied pid (issued instantly by /api/begin) so the
  // registration can be written in the background without blocking the UI.
  // Fall back to generating one here for safety.
  const pid =
    typeof body.pid === "string" && /^[0-9a-f-]{36}$/i.test(body.pid)
      ? body.pid
      : crypto.randomUUID();

  const now = new Date();
  const utmPayload = utmFromRegisterBody(body as Record<string, unknown>);

  const zapierBase = {
    source: "usd-law-quiz",
    competition: COMPETITION_NAME,
    name,
    email,
    phone,
    linkedinUrl: linkedinUrl ?? "",
    collegeName,
    bestDescribeYou: bestDescribeYou ?? "",
    considerMasters: considerMasters ?? "",
    planningYear: planningYear ?? "",
    interestsMost: interestsMost ?? "",
    workExperience: workExperience ?? "",
    domain: domain ?? "",
    registeredAt: now.toISOString(),
    ...utmPayload,
  } satisfies Record<string, unknown>;

  // Postgres-first when DATABASE_URL is present.
  if (hasDatabaseUrl()) {
    const existingRows = await query<{
      pid: string;
      status: string;
      last_activity_at: string | null;
      tab_switches: number | null;
    }>(
      "SELECT pid, status, last_activity_at, COALESCE(tab_switches, 0) AS tab_switches FROM participants WHERE email = $1 LIMIT 1",
      [email]
    );

    if (existingRows.length > 0) {
      const existing = existingRows[0]!;
      const tabSwitches = Number(existing.tab_switches) || 0;
      if (isTabBlocked(tabSwitches) || existing.status === "blocked") {
        postToZapier({
          ...zapierBase,
          pid: existing.pid,
          existing: true,
          blocked: true,
          status: existing.status,
          tabSwitches,
        });
        return NextResponse.json({
          pid: existing.pid,
          token: signToken(existing.pid),
          status: "blocked",
          lastActivityAt: existing.last_activity_at
            ? new Date(existing.last_activity_at).toISOString()
            : now.toISOString(),
          existing: true,
          blocked: true,
          tabSwitches,
        });
      }

      await query(
        "INSERT INTO attempts(pid) VALUES ($1) ON CONFLICT (pid) DO NOTHING",
        [existing.pid]
      );

      // Update mutable profile fields, but keep status + timestamps as-is
      // (matches the Sheets behavior where re-register doesn't reset progress).
      await query(
        `UPDATE participants
         SET name = $2,
             phone = $3,
             work_experience = $4,
             domain = $5,
             linkedin_url = $6,
             college_name = $7,
             best_describe_you = $8,
             consider_masters = $9,
             planning_year = $10,
             interests_most = $11
         WHERE pid = $1`,
        [
          existing.pid,
          name,
          phone,
          workExperience ?? "",
          domain ?? "",
          linkedinUrl ?? null,
          collegeName,
          bestDescribeYou ?? null,
          considerMasters ?? null,
          planningYear ?? null,
          interestsMost ?? null,
        ]
      );

      const lastActivityAtIso = existing.last_activity_at
        ? new Date(existing.last_activity_at).toISOString()
        : now.toISOString();

      // Background mirror: keep Google Sheet updated (incl. UTMs).
      void gasRegister({
        pid: existing.pid,
        name,
        email,
        phone,
        workExperience: workExperience ?? "",
        domain: domain ?? "",
        linkedinUrl: linkedinUrl ?? "",
        collegeName,
        bestDescribeYou: bestDescribeYou ?? "",
        considerMasters: considerMasters ?? "",
        planningYear: planningYear ?? "",
        interestsMost: interestsMost ?? "",
        ...utmPayload,
      }).catch(() => {
        // ignore
      });

      postToZapier({
        ...zapierBase,
        pid: existing.pid,
        existing: true,
        blocked: false,
        status: existing.status,
        tabSwitches,
      });

      return NextResponse.json({
        pid: existing.pid,
        token: signToken(existing.pid),
        status: existing.status,
        lastActivityAt: lastActivityAtIso,
        existing: true,
      });
    }

    const inserted = await query<{
      pid: string;
      status: string;
      last_activity_at: string;
    }>(
      `INSERT INTO participants
         (pid, name, email, phone, work_experience, domain, linkedin_url, college_name, best_describe_you, consider_masters, planning_year, interests_most, status, registered_at, last_activity_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'not_started', $13, $14)
       ON CONFLICT (pid)
       DO UPDATE SET
         name = EXCLUDED.name,
         phone = EXCLUDED.phone,
         work_experience = EXCLUDED.work_experience,
         domain = EXCLUDED.domain,
         linkedin_url = EXCLUDED.linkedin_url,
         college_name = EXCLUDED.college_name,
         best_describe_you = EXCLUDED.best_describe_you,
         consider_masters = EXCLUDED.consider_masters,
         planning_year = EXCLUDED.planning_year,
         interests_most = EXCLUDED.interests_most,
         last_activity_at = EXCLUDED.last_activity_at
       RETURNING pid, status, last_activity_at`,
      [
        pid,
        name,
        email,
        phone,
        workExperience ?? "",
        domain ?? "",
        linkedinUrl ?? null,
        collegeName,
        bestDescribeYou ?? null,
        considerMasters ?? null,
        planningYear ?? null,
        interestsMost ?? null,
        now.toISOString(),
        now.toISOString(),
      ]
    );

    await query(
      "INSERT INTO attempts(pid) VALUES ($1) ON CONFLICT (pid) DO NOTHING",
      [pid]
    );

    // Background mirror: keep the Google Sheet updated with the same details + UTMs.
    // This must never block UI latency.
    void gasRegister({
      pid: inserted[0]?.pid ?? pid,
      name,
      email,
      phone,
      workExperience: workExperience ?? "",
      domain: domain ?? "",
      linkedinUrl: linkedinUrl ?? "",
      collegeName,
      bestDescribeYou: bestDescribeYou ?? "",
      considerMasters: considerMasters ?? "",
      planningYear: planningYear ?? "",
      interestsMost: interestsMost ?? "",
      ...utmPayload,
    }).catch(() => {
      // ignore (Sheets might be slow/unavailable; DB-first is the primary flow)
    });

    postToZapier({
      ...zapierBase,
      pid: inserted[0]?.pid ?? pid,
      existing: false,
      blocked: false,
      status: inserted[0]?.status ?? "not_started",
      tabSwitches: 0,
    });

    return NextResponse.json({
      pid: inserted[0]?.pid ?? pid,
      token: signToken(pid),
      status: inserted[0]?.status ?? "not_started",
      lastActivityAt: inserted[0]
        ? new Date(inserted[0].last_activity_at).toISOString()
        : now.toISOString(),
      existing: false,
    });
  }

  // Fallback to Google Sheets.
  const result = await gasRegister({
    pid,
    name,
    email,
    phone,
    workExperience: workExperience ?? "",
    domain: domain ?? "",
    linkedinUrl: linkedinUrl ?? "",
    collegeName,
    bestDescribeYou: bestDescribeYou ?? "",
    considerMasters: considerMasters ?? "",
    planningYear: planningYear ?? "",
    interestsMost: interestsMost ?? "",
    ...utmPayload,
  });

  postToZapier({
    ...zapierBase,
    pid: result.pid,
    existing: Boolean(result.existing),
    blocked: Boolean(result.blocked) || result.status === "blocked",
    status: result.status,
    tabSwitches: result.tabSwitches ?? 0,
  });

  return NextResponse.json({
    pid: result.pid,
    token: signToken(result.pid),
    status: result.status,
    lastActivityAt: result.lastActivityAt,
    existing: result.existing,
    blocked: Boolean(result.blocked) || result.status === "blocked",
    tabSwitches: result.tabSwitches ?? 0,
  });
}

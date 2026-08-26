import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";
import { gasTabSwitch } from "@/lib/sheets";
import { isTabBlocked, TAB_SWITCH_LIMIT } from "@/lib/tabSwitch";
import { clearResumeCache } from "@/lib/resumeCache";

interface Body {
  pid?: string;
  token?: string;
  /** Client's view of count (merged with server via max). */
  count?: number;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pid = typeof body.pid === "string" ? body.pid : "";
  const token = typeof body.token === "string" ? body.token : "";
  const clientCount = Math.max(0, Math.trunc(Number(body.count) || 0));

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  if (hasDatabaseUrl()) {
    try {
      const rows = await query<{
        email: string | null;
        tab_switches: number | null;
        status: string;
      }>(
        `SELECT email, tab_switches, status FROM participants WHERE pid = $1 LIMIT 1`,
        [pid]
      );
      if (!rows.length) {
        return NextResponse.json(
          { error: "Participant not found" },
          { status: 404 }
        );
      }

      const current = Number(rows[0]!.tab_switches) || 0;
      // Server increments at least +1 per event; never trust a lower client count.
      const next = Math.max(current + 1, clientCount, current);

      await query(
        `INSERT INTO integrity_events(pid, event_type, meta)
         VALUES ($1, 'tab_switch', $2::jsonb)`,
        [pid, JSON.stringify({ clientCount, previous: current, next })]
      ).catch(() => undefined);

      const blocked = isTabBlocked(next);
      await query(
        `UPDATE participants
           SET tab_switches = $2,
               status = CASE WHEN $3 THEN 'blocked' ELSE status END,
               last_activity_at = now()
         WHERE pid = $1
         RETURNING email`,
        [pid, next, blocked]
      );

      const email = rows[0]?.email;
      if (email) clearResumeCache(String(email));

      void gasTabSwitch({ pid, count: next, blocked }).catch(() => undefined);

      return NextResponse.json({
        ok: true,
        tabSwitches: next,
        blocked,
        limit: TAB_SWITCH_LIMIT,
      });
    } catch (err) {
      console.error("[tab-switch]", err);
      void gasTabSwitch({
        pid,
        count: clientCount,
        blocked: isTabBlocked(clientCount),
      }).catch(() => undefined);
      return NextResponse.json({
        ok: true,
        tabSwitches: clientCount,
        blocked: isTabBlocked(clientCount),
      });
    }
  }

  const result = await gasTabSwitch({
    pid,
    count: clientCount,
    blocked: isTabBlocked(clientCount),
  });
  clearResumeCache();
  return NextResponse.json({
    ok: true,
    tabSwitches: result.tabSwitches ?? clientCount,
    blocked: Boolean(result.blocked) || isTabBlocked(clientCount),
  });
}

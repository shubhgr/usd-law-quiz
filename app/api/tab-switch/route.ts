import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";
import { gasTabSwitch } from "@/lib/sheets";
import { isTabBlocked } from "@/lib/tabSwitch";
import { clearResumeCache } from "@/lib/resumeCache";

interface Body {
  pid?: string;
  token?: string;
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
  const count = Math.max(0, Math.trunc(Number(body.count) || 0));

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  if (hasDatabaseUrl()) {
    try {
      const rows = await query<{ email: string | null }>(
        `UPDATE participants SET tab_switches = $2 WHERE pid = $1 RETURNING email`,
        [pid, count]
      );
      const email = rows[0]?.email;
      if (email) clearResumeCache(String(email));
    } catch {
      // Column may not exist until init.sql is applied; still mirror to Sheets.
    }
    const blocked = isTabBlocked(count);
    void gasTabSwitch({ pid, count }).catch(() => undefined);
    return NextResponse.json({ ok: true, tabSwitches: count, blocked });
  }

  const result = await gasTabSwitch({ pid, count });
  clearResumeCache();
  return NextResponse.json({
    ok: true,
    tabSwitches: result.tabSwitches ?? count,
    blocked: Boolean(result.blocked) || isTabBlocked(count),
  });
}

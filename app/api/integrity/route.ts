import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { hasDatabaseUrl, query } from "@/lib/db";

const ALLOWED = new Set(["copy", "cut", "paste"]);

interface Body {
  pid?: string;
  token?: string;
  eventType?: string;
  meta?: Record<string, unknown>;
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
  const eventType = String(body.eventType || "").toLowerCase();

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  if (!ALLOWED.has(eventType)) {
    return NextResponse.json(
      { error: "eventType must be copy, cut, or paste" },
      { status: 400 }
    );
  }

  if (!hasDatabaseUrl()) {
    return NextResponse.json({ ok: true, logged: false });
  }

  try {
    await query(
      `INSERT INTO integrity_events(pid, event_type, meta)
       VALUES ($1, $2, $3::jsonb)`,
      [
        pid,
        eventType,
        JSON.stringify(body.meta && typeof body.meta === "object" ? body.meta : {}),
      ]
    );

    const rows = await query<{ copy_paste_count: number }>(
      `UPDATE participants
         SET copy_paste_count = COALESCE(copy_paste_count, 0) + 1,
             last_activity_at = now()
       WHERE pid = $1
       RETURNING copy_paste_count`,
      [pid]
    );

    return NextResponse.json({
      ok: true,
      logged: true,
      copyPasteCount: Number(rows[0]?.copy_paste_count ?? 0),
    });
  } catch (err) {
    console.error("[integrity]", err);
    return NextResponse.json({ ok: true, logged: false });
  }
}

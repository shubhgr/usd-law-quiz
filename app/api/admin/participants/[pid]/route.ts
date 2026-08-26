import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { hasDatabaseUrl, query } from "@/lib/db";
import { invalidateCollegeLeaderboardCache } from "@/lib/collegeLeaderboardCache";
import { invalidateCollegeAdminListCache } from "@/lib/collegeCatalog";

interface Body {
  collegeName?: string | null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ pid: string }> }
) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasDatabaseUrl()) {
    return NextResponse.json(
      { error: "Database is not configured." },
      { status: 503 }
    );
  }

  const { pid } = await context.params;
  if (!pid || !/^[0-9a-f-]{36}$/i.test(pid)) {
    return NextResponse.json({ error: "Invalid pid" }, { status: 400 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const collegeName =
    typeof body.collegeName === "string" ? body.collegeName.trim() : "";
  const nextValue = collegeName || null;

  const updated = await query<{
    pid: string;
    name: string;
    email: string;
    college_name: string | null;
  }>(
    `UPDATE participants
       SET college_name = $2
     WHERE pid = $1
     RETURNING pid, name, email, college_name`,
    [pid, nextValue]
  );

  if (!updated.length) {
    return NextResponse.json({ error: "Participant not found" }, { status: 404 });
  }

  invalidateCollegeLeaderboardCache();
  invalidateCollegeAdminListCache();

  return NextResponse.json({
    ok: true,
    participant: {
      pid: updated[0]!.pid,
      name: updated[0]!.name,
      email: updated[0]!.email,
      collegeName: updated[0]!.college_name?.trim() || null,
    },
  });
}

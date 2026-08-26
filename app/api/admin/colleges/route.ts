import { NextResponse, type NextRequest } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import {
  addCollegeName,
  browseColleges,
  collegeCatalogSize,
  listCollegesByParticipation,
  listManagedColleges,
  renameCollegeName,
  searchCollegeNames,
} from "@/lib/collegeCatalog";
import { invalidateCollegeLeaderboardCache } from "@/lib/collegeLeaderboardCache";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = request.nextUrl.searchParams.get("mode") ?? "";
  const managed = request.nextUrl.searchParams.get("managed") === "1";
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const rawLimit = Number(request.nextUrl.searchParams.get("limit"));
  const rawOffset = Number(request.nextUrl.searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(500, Math.max(1, Math.trunc(rawLimit)))
    : 200;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.trunc(rawOffset))
    : 0;

  if (mode === "participation") {
    const page = await listCollegesByParticipation(q, offset, limit);
    return NextResponse.json(page);
  }

  if (mode === "browse" || mode === "catalog") {
    const page = await browseColleges(q, offset, Math.min(100, limit));
    return NextResponse.json(page);
  }

  if (managed) {
    const colleges = await listManagedColleges(q, Math.min(500, limit));
    return NextResponse.json({ colleges });
  }

  // Assign-modal search
  const results = await searchCollegeNames(q, Math.min(40, limit));
  return NextResponse.json({
    total: collegeCatalogSize(),
    results,
  });
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "College name is required" }, { status: 400 });
  }

  try {
    const saved = await addCollegeName(name);
    return NextResponse.json({ ok: true, name: saved });
  } catch (err) {
    console.error("[admin colleges POST]", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Could not add college. Create the colleges table first.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: number; name?: string; fromName?: string };
  try {
    body = (await request.json()) as {
      id?: number;
      name?: string;
      fromName?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const id = typeof body.id === "number" ? body.id : Number(body.id);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const fromName =
    typeof body.fromName === "string" ? body.fromName.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "College name is required" }, { status: 400 });
  }
  if ((!Number.isFinite(id) || id <= 0) && !fromName) {
    return NextResponse.json(
      { error: "College id or fromName is required" },
      { status: 400 }
    );
  }

  try {
    const updated = await renameCollegeName({
      id: Number.isFinite(id) && id > 0 ? id : null,
      fromName: fromName || undefined,
      toName: name,
    });
    invalidateCollegeLeaderboardCache();
    return NextResponse.json({ ok: true, college: updated });
  } catch (err) {
    console.error("[admin colleges PATCH]", err);
    const message =
      err instanceof Error ? err.message : "Could not rename college";
    const status =
      message === "College not found"
        ? 404
        : message.includes("already exists")
          ? 409
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

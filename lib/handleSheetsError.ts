import { NextResponse } from "next/server";
import { SheetsError } from "@/lib/sheets";

/** Map SheetsError codes to HTTP responses. Returns null if err is not a SheetsError. */
export function respondSheetsError(err: unknown): NextResponse | null {
  if (!(err instanceof SheetsError)) return null;

  switch (err.code) {
    case "NOT_FOUND":
      return NextResponse.json({ error: err.message }, { status: 404 });
    case "BAD_REQUEST":
      return NextResponse.json({ error: err.message }, { status: 400 });
    case "ALREADY_COMPLETED":
      return NextResponse.json({ error: err.message }, { status: 409 });
    case "INCOMPLETE":
      return NextResponse.json({ error: err.message }, { status: 400 });
    case "UNAUTHORIZED":
      return NextResponse.json({ error: err.message }, { status: 401 });
    case "TIMEOUT":
    case "NETWORK":
    case "BUSY":
      return NextResponse.json({ error: err.message }, { status: 502 });
    default:
      return NextResponse.json(
        { error: err.message || "Apps Script request failed" },
        { status: 502 }
      );
  }
}

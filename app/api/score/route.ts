import { NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { questions } from "@/lib/questions";
import { gradeAnswerString, scoreFromAnswerString } from "@/lib/answerKey";
import {
  isValidAnswerPayload,
  splitAnswerString,
} from "@/lib/answerString";

interface ScoreBody {
  pid?: string;
  token?: string;
  answers?: string;
}

export async function POST(request: Request) {
  let body: ScoreBody;
  try {
    body = (await request.json()) as ScoreBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pid = typeof body.pid === "string" ? body.pid : "";
  const token = typeof body.token === "string" ? body.token : "";
  const answers =
    typeof body.answers === "string" ? body.answers.trim().toLowerCase() : "";

  const verifiedPid = verifyToken(token);
  if (!verifiedPid || verifiedPid !== pid) {
    return NextResponse.json(
      { error: "Invalid or tampered token" },
      { status: 401 }
    );
  }

  if (!answers) {
    return NextResponse.json({ error: "answers is required" }, { status: 400 });
  }
  if (!isValidAnswerPayload(answers)) {
    return NextResponse.json({ error: "Invalid answer string" }, { status: 400 });
  }
  if (splitAnswerString(answers).length > questions.length) {
    return NextResponse.json(
      { error: "answers string is too long" },
      { status: 400 }
    );
  }

  // Score whatever was stored (empty slots = unanswered = incorrect).
  return NextResponse.json({
    totalScore: scoreFromAnswerString(answers),
    totalQuestions: questions.length,
    graded: gradeAnswerString(answers),
  });
}

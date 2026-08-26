import Link from "next/link";
import QuizClient from "./QuizClient";
import LegacyEmailRedirect from "@/components/LegacyEmailRedirect";
import { COMPETITION_NAME } from "@/lib/config";

export const metadata = {
  title: `Quiz — ${COMPETITION_NAME}`,
};

interface QuizPageProps {
  searchParams: Promise<{ email?: string; pid?: string; token?: string }>;
}

export default async function QuizPage({ searchParams }: QuizPageProps) {
  const { email, pid, token } = await searchParams;
  const normalized = email?.trim().toLowerCase() ?? "";

  if (normalized) {
    return <QuizClient email={normalized} />;
  }

  const legacyPid = pid?.trim() ?? "";
  const legacyToken = token?.trim() ?? "";
  if (legacyPid && legacyToken) {
    return (
      <LegacyEmailRedirect pid={legacyPid} token={legacyToken} target="quiz" />
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Missing email</h1>
        <p className="mt-3 text-slate-400">
          Start or resume with your registration email, e.g.{" "}
          <code className="text-[#75BEE9]">/quiz?email=you@gmail.com</code>
        </p>
        <Link
          href="/"
          className="cta-button-gradient mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
        >
          Register
        </Link>
      </div>
    </main>
  );
}

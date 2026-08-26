import Link from "next/link";
import ResultsClient from "./ResultsClient";
import LegacyEmailRedirect from "@/components/LegacyEmailRedirect";
import { COMPETITION_NAME } from "@/lib/config";

export const metadata = {
  title: `Results — ${COMPETITION_NAME}`,
};

interface ResultsPageProps {
  searchParams: Promise<{ email?: string; pid?: string; token?: string }>;
}

export default async function ResultsPage({ searchParams }: ResultsPageProps) {
  const { email, pid, token } = await searchParams;
  const normalized = email?.trim().toLowerCase() ?? "";

  if (normalized) {
    return <ResultsClient email={normalized} />;
  }

  const legacyPid = pid?.trim() ?? "";
  const legacyToken = token?.trim() ?? "";
  if (legacyPid && legacyToken) {
    return (
      <LegacyEmailRedirect
        pid={legacyPid}
        token={legacyToken}
        target="results"
      />
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Missing email</h1>
        <p className="mt-3 text-slate-400">
          Open results with your registration email, e.g.{" "}
          <code className="text-[#75BEE9]">/results?email=you@gmail.com</code>
        </p>
        <Link
          href="/"
          className="cta-button-gradient mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-white"
        >
          Go to registration
        </Link>
      </div>
    </main>
  );
}

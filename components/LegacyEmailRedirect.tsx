"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { quizUrl, resultsUrl } from "@/lib/quizUrls";

export default function LegacyEmailRedirect({
  pid,
  token,
  target,
}: {
  pid: string;
  token: string;
  target: "quiz" | "results";
}) {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/progress?pid=${encodeURIComponent(pid)}&token=${encodeURIComponent(token)}`
        );
        const data = (await res.json()) as { email?: string; error?: string };
        if (!res.ok || !data.email) {
          if (!cancelled) setError(data.error ?? "This link isn't valid.");
          return;
        }
        const url =
          target === "results" ? resultsUrl(data.email) : quizUrl(data.email);
        router.replace(url);
      } catch {
        if (!cancelled) setError("Network error. Please refresh to retry.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pid, token, target, router]);

  if (error) {
    return (
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">This link isn&apos;t valid</h1>
          <p className="mt-3 text-slate-400">{error}</p>
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

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16 text-slate-400">
      Loading…
    </main>
  );
}

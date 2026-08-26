"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { quizUrl } from "@/lib/quizUrls";

export default function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Registration failed. Please try again.");
        return;
      }
      // The quiz page itself branches on status (start / resume / completed).
      if (data.existing && data.status === "completed") {
        router.replace(
          `/results?email=${encodeURIComponent(email.toLowerCase())}`
        );
        return;
      }
      router.push(quizUrl(email.toLowerCase()));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium">
          Full name
        </label>
        <input
          id="name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ada Lovelace"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ada@example.com"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          Use the same email to resume a quiz within 30 days — even from another
          device.
        </p>
      </div>

      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium">
          Phone <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <input
          id="phone"
          type="text"
          inputMode="numeric"
          autoComplete="tel"
          maxLength={12}
          pattern="[0-9]*"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 12))}
          onBeforeInput={(e) => {
            const data = (e as unknown as InputEvent).data;
            if (data && /\D/.test(data)) e.preventDefault();
          }}
          onKeyDown={(e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const allowed = [
              "Backspace",
              "Delete",
              "Tab",
              "Escape",
              "Enter",
              "ArrowLeft",
              "ArrowRight",
              "Home",
              "End",
            ];
            if (allowed.includes(e.key)) return;
            if (!/^\d$/.test(e.key)) e.preventDefault();
          }}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text").replace(/\D/g, "");
            setPhone((phone + text).replace(/\D/g, "").slice(0, 12));
          }}
          placeholder="10 to 12 digits"
          className={inputClass}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Starting…" : "Start the challenge"}
      </button>

      <p className="text-center text-xs text-neutral-500 dark:text-neutral-400">
        Already registered? Just submit the same email and you&apos;ll be taken back
        to your quiz.{" "}
        <Link href="/leaderboard" className="text-indigo-600 hover:underline dark:text-indigo-400">
          See the leaderboard
        </Link>
      </p>
    </form>
  );
}

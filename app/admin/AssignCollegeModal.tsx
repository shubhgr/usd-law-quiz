"use client";

import { useEffect, useId, useRef, useState } from "react";

interface AssignCollegeModalProps {
  open: boolean;
  participantName: string;
  currentCollege: string | null;
  saving: boolean;
  onClose: () => void;
  onAssign: (collegeName: string) => Promise<void>;
}

export function AssignCollegeModal({
  open,
  participantName,
  currentCollege,
  saving,
  onClose,
  onAssign,
}: AssignCollegeModalProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setError("");
    setCreating(false);
    const t = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/admin/colleges?q=${encodeURIComponent(q)}&limit=15`
          );
          const body = (await res.json()) as { results?: string[] };
          if (!cancelled && res.ok) setResults(body.results ?? []);
        } catch {
          if (!cancelled) setResults([]);
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  if (!open) return null;

  const trimmed = query.trim();
  const exactMatch = results.some(
    (name) => name.toLowerCase() === trimmed.toLowerCase()
  );
  // Only offer create when the catalog has no matches for this query.
  const canCreate = trimmed.length >= 2 && !searching && results.length === 0 && !exactMatch;

  async function pick(name: string) {
    setError("");
    try {
      await onAssign(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not assign college");
    }
  }

  async function createAndAssign() {
    if (!canCreate || saving || creating) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = (await res.json()) as { error?: string; name?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not create college");
      await onAssign(body.name ?? trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create college");
    } finally {
      setCreating(false);
    }
  }

  const busy = saving || creating;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(88dvh,560px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#001426] shadow-2xl"
      >
        <div className="border-b border-white/10 px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-white">
                Assign college
              </h2>
              <p className="mt-0.5 truncate text-sm text-slate-400">
                {participantName}
                {currentCollege ? ` · currently ${currentCollege}` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-white/5 hover:text-white disabled:opacity-40"
            >
              Close
            </button>
          </div>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search catalog or type a new college"
            className="register-input mt-3 w-full"
            disabled={busy}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {searching && (
            <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>
          )}
          {!searching && trimmed.length < 2 && (
            <p className="px-3 py-2 text-sm text-slate-500">
              Type at least 2 characters to search the college catalog.
            </p>
          )}
          {!searching && trimmed.length >= 2 && results.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-500">
              No catalog matches. Create a new college below.
            </p>
          )}
          <ul>
            {results.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void pick(name)}
                  className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2 border-t border-white/10 px-4 py-3 sm:px-5">
          {canCreate && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void createAndAssign()}
              className="w-full rounded-lg border border-[#75BEE9]/40 px-3 py-2.5 text-sm font-semibold text-[#75BEE9] hover:bg-white/5 disabled:opacity-50"
            >
              {creating ? "Creating…" : `Create “${trimmed}” & assign`}
            </button>
          )}
          {error && <p className="text-sm text-red-300">{error}</p>}
          {busy && !error && (
            <p className="text-sm text-slate-400">
              {creating ? "Creating college…" : "Assigning…"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

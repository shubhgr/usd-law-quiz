"use client";

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { AdminGate } from "../AdminGate";
import {
  collegesCacheKey,
  getCollegesCached,
  getCollegesSnapshot,
  setCollegesSnapshot,
  type AdminCollegeCacheRow,
} from "../adminClientCache";
import { useAdminRefresh } from "../AdminRefresh";
import { AdminStickyTools } from "../AdminStickyTools";

type CollegeListItem = AdminCollegeCacheRow;

function AddCollegeModal({
  open,
  saving,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
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

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-2xl border border-white/15 bg-[#001426] p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-white">
          Add college
        </h2>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || saving) return;
            void onSave(name.trim());
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="College name"
            className="register-input w-full"
            disabled={saving}
          />
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-300 hover:border-white/30 hover:text-white disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="cta-button-gradient rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CollegesAdmin() {
  const cached = getCollegesSnapshot();
  const [searchInput, setSearchInput] = useState(
    () => cached?.searchInput ?? ""
  );
  const [activeQuery, setActiveQuery] = useState(
    () => cached?.activeQuery ?? ""
  );
  const [results, setResults] = useState<CollegeListItem[]>(
    () => cached?.results ?? []
  );
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? false);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const searchInputRef = useRef(searchInput);
  searchInputRef.current = searchInput;

  const persistColleges = useCallback(
    (
      q: string,
      input: string,
      nextResults: CollegeListItem[],
      nextHasMore: boolean
    ) => {
      setCollegesSnapshot({
        key: collegesCacheKey(q),
        searchInput: input,
        activeQuery: q,
        results: nextResults,
        hasMore: nextHasMore,
      });
    },
    []
  );

  const loadColleges = useCallback(
    async (
      q: string,
      nextOffset: number,
      append: boolean,
      opts?: { force?: boolean; searchInputValue?: string }
    ) => {
      const key = collegesCacheKey(q);
      if (!append && !opts?.force) {
        const cachedPage = getCollegesCached(q);
        if (cachedPage) {
          const input = opts?.searchInputValue ?? searchInputRef.current;
          setResults(cachedPage.results);
          setHasMore(cachedPage.hasMore);
          setLoading(false);
          setCollegesSnapshot({
            key,
            searchInput: input,
            activeQuery: q,
            results: cachedPage.results,
            hasMore: cachedPage.hasMore,
          });
          return;
        }
      }

      if (append) setLoadingMore(true);
      else setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({
          mode: "participation",
          limit: "80",
          offset: String(nextOffset),
        });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`/api/admin/colleges?${params}`);
        const body = (await res.json()) as {
          results?: CollegeListItem[];
          hasMore?: boolean;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Failed to load colleges");
        const page = body.results ?? [];
        const nextHasMore = Boolean(body.hasMore);
        setHasMore(nextHasMore);
        setResults((prev) => {
          const next = append ? [...prev, ...page] : page;
          persistColleges(
            q,
            opts?.searchInputValue ?? searchInputRef.current,
            next,
            nextHasMore
          );
          return next;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load colleges");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [persistColleges]
  );

  useEffect(() => {
    void loadColleges(activeQuery, 0, false);
  }, [activeQuery, loadColleges]);

  useAdminRefresh(() =>
    loadColleges(activeQuery, 0, false, {
      force: true,
      searchInputValue: searchInputRef.current,
    })
  );

  function applyQuery(next: string) {
    const q = next.trim();
    setSearchInput(next);
    searchInputRef.current = next;
    if (q === activeQuery) return;
    // Restore instantly from cache when available (e.g. clear search → all colleges).
    const cachedPage = getCollegesCached(q);
    if (cachedPage) {
      setResults(cachedPage.results);
      setHasMore(cachedPage.hasMore);
      setLoading(false);
      setCollegesSnapshot({
        key: collegesCacheKey(q),
        searchInput: next,
        activeQuery: q,
        results: cachedPage.results,
        hasMore: cachedPage.hasMore,
      });
    }
    setActiveQuery(q);
  }

  function runSearch(e?: FormEvent) {
    e?.preventDefault();
    applyQuery(searchInput);
  }

  function onSearchInputChange(value: string) {
    setSearchInput(value);
    // Native search clear (×) should reset the list without waiting for Enter.
    if (!value.trim() && activeQuery) {
      applyQuery("");
    }
  }

  async function handleAddCollege(name: string) {
    setAdding(true);
    setAddError("");
    setMessage("");
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as { error?: string; name?: string };
      if (!res.ok) throw new Error(body.error ?? "Could not add college");
      setMessage(`Added “${body.name ?? name}”`);
      setAddOpen(false);
      await loadColleges(activeQuery, 0, false, {
        force: true,
        searchInputValue: searchInput,
      });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Could not add college");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(college: CollegeListItem) {
    setEditingKey(college.name);
    setEditName(college.name);
    setMessage("");
    setError("");
  }

  function cancelEdit() {
    setEditingKey(null);
    setEditName("");
  }

  async function saveEdit(college: CollegeListItem) {
    const name = editName.trim();
    if (!name) return;
    const key = college.name;
    setSavingKey(key);
    setMessage("");
    setError("");
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: college.id ?? undefined,
          fromName: college.name,
          name,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        college?: { name: string; oldName: string };
      };
      if (!res.ok) throw new Error(body.error ?? "Could not rename college");
      setMessage(
        body.college && body.college.oldName !== body.college.name
          ? `Renamed “${body.college.oldName}” → “${body.college.name}”`
          : "Saved"
      );
      setEditingKey(null);
      setEditName("");
      await loadColleges(activeQuery, 0, false, {
        force: true,
        searchInputValue: searchInput,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename college");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <>
      <AdminStickyTools>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <form onSubmit={runSearch} className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </span>
            <input
              type="search"
              value={searchInput}
              onChange={(e) => onSearchInputChange(e.target.value)}
              placeholder="Search colleges"
              className="register-input w-full pl-10"
              aria-label="Search colleges"
            />
          </form>

          <button
            type="button"
            onClick={() => {
              setAddError("");
              setAddOpen(true);
            }}
            className="cta-button-gradient shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold text-white"
          >
            Add College
          </button>
        </div>
      </AdminStickyTools>

      {message && <p className="mt-3 text-sm text-[#75BEE9]">{message}</p>}
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      {loading && (
        <p className="mt-4 text-sm text-slate-400">Loading colleges…</p>
      )}

      <ul className="mt-6 space-y-3">
        {results.map((college) => {
          const editing = editingKey === college.name;
          const busy = savingKey === college.name;
          return (
            <li
              key={college.id != null ? `id-${college.id}` : college.name}
              className="rounded-xl border border-white/10 bg-[rgba(0,14,28,0.72)] p-4"
            >
              {editing ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="register-input flex-1"
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy || !editName.trim()}
                      onClick={() => void saveEdit(college)}
                      className="cta-button-gradient rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={cancelEdit}
                      className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-300 hover:border-white/30 disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">{college.name}</p>
                    <p className="mt-1 text-sm text-slate-300">
                      <span className="font-semibold text-white">
                        {college.participantCount}
                      </span>{" "}
                      student{college.participantCount === 1 ? "" : "s"}
                      {" · "}
                      <span className="text-slate-400">
                        {college.completedCount} completed
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(college)}
                    className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-300 hover:border-white/30 hover:text-white"
                  >
                    Edit name
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {!loading && results.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">
          {activeQuery
            ? "No colleges match that search."
            : "No colleges found."}
        </p>
      )}

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() =>
              void loadColleges(activeQuery, results.length, true)
            }
            className="rounded-lg border border-white/15 px-4 py-2.5 text-sm text-slate-300 hover:border-white/30 hover:text-white disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}

      <AddCollegeModal
        open={addOpen}
        saving={adding}
        error={addError}
        onClose={() => {
          if (!adding) setAddOpen(false);
        }}
        onSave={handleAddCollege}
      />
    </>
  );
}

export default function AdminCollegesPage() {
  return (
    <AdminGate section="colleges">
      <CollegesAdmin />
    </AdminGate>
  );
}

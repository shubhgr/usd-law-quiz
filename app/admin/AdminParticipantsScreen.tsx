"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminGate } from "./AdminGate";
import { AssignCollegeModal } from "./AssignCollegeModal";
import {
  getParticipantsSnapshot,
  invalidateCollegesSnapshot,
  participantsCacheKey,
  setParticipantsSnapshot,
  updateParticipantsInSnapshot,
  type AdminParticipantCacheRow,
} from "./adminClientCache";
import { useAdminRefresh } from "./AdminRefresh";
import { AdminStickyTools } from "./AdminStickyTools";

type AdminParticipant = AdminParticipantCacheRow;

type Filter = "all" | "missing" | "completed" | "completed_missing";

const filterLabel = {
  all: "All participants",
  missing: "Missing college",
  completed: "Completed",
  completed_missing: "Completed · missing college",
} as const;

const defaultCounts = {
  total: 0,
  missingCollege: 0,
  completed: 0,
  completedMissingCollege: 0,
};

function ParticipantsAdmin({ assignPid }: { assignPid?: string }) {
  const router = useRouter();
  const cached = getParticipantsSnapshot();
  const [filter, setFilter] = useState<Filter>(
    () => (cached?.filter as Filter) ?? "completed_missing"
  );
  const [query, setQuery] = useState(() => cached?.query ?? "");
  const [participants, setParticipants] = useState<AdminParticipant[]>(
    () => cached?.participants ?? []
  );
  const [counts, setCounts] = useState(
    () => cached?.counts ?? defaultCounts
  );
  const [loadingList, setLoadingList] = useState(() => !cached);
  const [listError, setListError] = useState("");

  const [assignTarget, setAssignTarget] = useState<AdminParticipant | null>(
    null
  );
  const [savingPid, setSavingPid] = useState<string | null>(null);
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});

  const loadParticipants = useCallback(
    async (opts?: { force?: boolean }) => {
      const key = participantsCacheKey(filter, query);
      if (!opts?.force) {
        const snap = getParticipantsSnapshot();
        if (snap && snap.key === key) {
          setParticipants(snap.participants);
          setCounts(snap.counts);
          setLoadingList(false);
          return;
        }
      }

      setLoadingList(true);
      setListError("");
      try {
        const params = new URLSearchParams({ filter });
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(`/api/admin/participants?${params}`);
        const body = (await res.json()) as {
          participants?: AdminParticipant[];
          counts?: {
            total: number;
            missingCollege: number;
            completed: number;
            completedMissingCollege: number;
          };
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? "Failed to load participants");
        const nextParticipants = body.participants ?? [];
        const nextCounts = body.counts ?? defaultCounts;
        setParticipants(nextParticipants);
        setCounts(nextCounts);
        setParticipantsSnapshot({
          key,
          filter,
          query,
          participants: nextParticipants,
          counts: nextCounts,
        });
      } catch (err) {
        setListError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoadingList(false);
      }
    },
    [filter, query]
  );

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  useAdminRefresh(() => loadParticipants({ force: true }));

  useEffect(() => {
    if (!assignPid) {
      setAssignTarget(null);
      return;
    }
    const found = participants.find((p) => p.pid === assignPid) ?? null;
    setAssignTarget(found);
  }, [assignPid, participants]);

  function openAssign(p: AdminParticipant) {
    setAssignTarget(p);
    router.push(`/admin/assign/${p.pid}`);
  }

  function closeAssign() {
    setAssignTarget(null);
    router.push("/admin");
  }

  async function assignCollege(pid: string, collegeName: string) {
    setSavingPid(pid);
    setRowMessage((m) => ({ ...m, [pid]: "" }));
    try {
      const res = await fetch(`/api/admin/participants/${pid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeName }),
      });
      const body = (await res.json()) as {
        error?: string;
        participant?: { collegeName: string | null };
      };
      if (!res.ok) throw new Error(body.error ?? "Save failed");

      const nextCollege = body.participant?.collegeName ?? null;
      setParticipants((list) => {
        const next = list.map((p) =>
          p.pid === pid ? { ...p, collegeName: nextCollege } : p
        );
        updateParticipantsInSnapshot(() => next);
        return next;
      });
      invalidateCollegesSnapshot();
      setRowMessage((m) => ({
        ...m,
        [pid]: nextCollege ? `Assigned to ${nextCollege}` : "College cleared",
      }));
      if (collegeName) {
        closeAssign();
      } else {
        setAssignTarget(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Save failed";
      setRowMessage((m) => ({ ...m, [pid]: message }));
      throw err;
    } finally {
      setSavingPid(null);
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Total", counts.total],
          ["Missing college", counts.missingCollege],
          ["Completed", counts.completed],
          ["Done · no college", counts.completedMissingCollege],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-white/10 bg-[rgba(0,20,40,0.55)] px-3 py-3"
          >
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-[#6da6d3]">
              {label}
            </p>
            <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      <AdminStickyTools>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="register-input register-select sm:max-w-xs"
          >
            {(Object.keys(filterLabel) as Filter[]).map((key) => (
              <option key={key} value={key}>
                {filterLabel[key]}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, email, or college"
            className="register-input flex-1"
          />
        </div>
      </AdminStickyTools>

      {listError && <p className="mt-4 text-sm text-red-300">{listError}</p>}
      {loadingList && (
        <p className="mt-4 text-sm text-slate-400">Loading participants…</p>
      )}

      {assignPid && !loadingList && !assignTarget && (
        <p className="mt-4 text-sm text-amber-200">
          Participant not found in this list. Try another filter or refresh.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {participants.map((p) => (
          <li
            key={p.pid}
            className="rounded-xl border border-white/10 bg-[rgba(0,14,28,0.72)] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{p.name}</p>
                <p className="truncate text-sm text-slate-400">{p.email}</p>
                <p className="mt-1 truncate text-sm text-slate-400">
                  {p.phone ? p.phone : "No phone"}
                </p>
              </div>
              <div className="text-right text-sm text-slate-300">
                <p>
                  Rank:{" "}
                  <span className="font-semibold text-white">
                    {p.rank === null || p.rank === undefined ? "—" : p.rank}
                  </span>
                </p>
                <p>
                  Score:{" "}
                  <span className="font-semibold text-white">
                    {p.score === null ? "—" : p.score}
                  </span>
                </p>
                <p className="text-slate-500">{p.status}</p>
              </div>
            </div>

            <p className="mt-3 text-xs uppercase tracking-[0.12em] text-[#6da6d3]">
              Current college:{" "}
              <span className="text-slate-200 normal-case tracking-normal">
                {p.collegeName || "Not assigned"}
              </span>
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={savingPid === p.pid}
                onClick={() => openAssign(p)}
                className="cta-button-gradient rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {p.collegeName ? "Change college" : "Assign college"}
              </button>
              <button
                type="button"
                disabled={savingPid === p.pid || !p.collegeName}
                onClick={() => void assignCollege(p.pid, "")}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-300 hover:border-white/30 disabled:opacity-40"
              >
                Clear college
              </button>
            </div>
            {rowMessage[p.pid] && (
              <p className="mt-2 text-sm text-[#75BEE9]">{rowMessage[p.pid]}</p>
            )}
          </li>
        ))}
      </ul>

      {!loadingList && participants.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">
          No participants match this filter.
        </p>
      )}

      <AssignCollegeModal
        open={Boolean(assignTarget)}
        participantName={assignTarget?.name ?? ""}
        currentCollege={assignTarget?.collegeName ?? null}
        saving={Boolean(assignTarget && savingPid === assignTarget.pid)}
        onClose={() => {
          if (!savingPid) closeAssign();
        }}
        onAssign={async (collegeName) => {
          if (!assignTarget) return;
          await assignCollege(assignTarget.pid, collegeName);
        }}
      />
    </>
  );
}

export function AdminParticipantsScreen({ assignPid }: { assignPid?: string }) {
  return (
    <AdminGate section="participants">
      <ParticipantsAdmin assignPid={assignPid} />
    </AdminGate>
  );
}

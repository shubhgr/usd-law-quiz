"use client";

export type AdminParticipantCacheRow = {
  pid: string;
  name: string;
  email: string;
  phone: string;
  collegeName: string | null;
  status: string;
  score: number | null;
  rank: number | null;
  completionTimeSeconds: number | null;
  registeredAt: string | null;
};

export type AdminParticipantsSnapshot = {
  key: string;
  filter: string;
  query: string;
  participants: AdminParticipantCacheRow[];
  counts: {
    total: number;
    missingCollege: number;
    completed: number;
    completedMissingCollege: number;
  };
};

export type AdminCollegeCacheRow = {
  name: string;
  id: number | null;
  source: "catalog" | "custom";
  participantCount: number;
  completedCount: number;
};

export type AdminCollegesSnapshot = {
  key: string;
  searchInput: string;
  activeQuery: string;
  results: AdminCollegeCacheRow[];
  hasMore: boolean;
};

let participantsSnapshot: AdminParticipantsSnapshot | null = null;
let collegesSnapshot: AdminCollegesSnapshot | null = null;
const collegesByKey = new Map<
  string,
  { results: AdminCollegeCacheRow[]; hasMore: boolean }
>();

export function getParticipantsSnapshot() {
  return participantsSnapshot;
}

export function setParticipantsSnapshot(next: AdminParticipantsSnapshot) {
  participantsSnapshot = next;
}

export function updateParticipantsInSnapshot(
  updater: (
    rows: AdminParticipantCacheRow[]
  ) => AdminParticipantCacheRow[]
) {
  if (!participantsSnapshot) return;
  participantsSnapshot = {
    ...participantsSnapshot,
    participants: updater(participantsSnapshot.participants),
  };
}

export function getCollegesSnapshot() {
  return collegesSnapshot;
}

export function getCollegesCached(query: string) {
  return collegesByKey.get(collegesCacheKey(query)) ?? null;
}

export function setCollegesSnapshot(next: AdminCollegesSnapshot) {
  collegesSnapshot = next;
  collegesByKey.set(next.key, {
    results: next.results,
    hasMore: next.hasMore,
  });
}

export function clearAdminClientCache() {
  participantsSnapshot = null;
  collegesSnapshot = null;
  collegesByKey.clear();
}

export function invalidateCollegesSnapshot() {
  collegesSnapshot = null;
  collegesByKey.clear();
}

export function participantsCacheKey(filter: string, query: string) {
  return `v2::${filter}::${query.trim().toLowerCase()}`;
}

export function collegesCacheKey(query: string) {
  return query.trim().toLowerCase();
}

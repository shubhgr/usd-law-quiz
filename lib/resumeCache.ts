const resumeCache = new Map<string, { at: number; body: unknown }>();

export function getResumeCache(email: string) {
  return resumeCache.get(email);
}

export function setResumeCache(email: string, body: unknown) {
  resumeCache.set(email, { at: Date.now(), body });
}

export function clearResumeCache(email?: string) {
  if (email) resumeCache.delete(email.trim().toLowerCase());
  else resumeCache.clear();
}

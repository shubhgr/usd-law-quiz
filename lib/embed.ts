/** True when this page is running inside a cross-origin iframe (e.g. Framer embed). */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** True when localStorage can round-trip a value. */
export function isStorageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = `__usd_probe_${Date.now()}`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the browser for storage access after a user gesture (form submit).
 * Helps some browsers persist localStorage inside third-party iframes.
 */
export async function requestEmbedStorageAccess(): Promise<boolean> {
  if (typeof document === "undefined") return isStorageAvailable();
  if (isStorageAvailable()) return true;
  try {
    const req = (
      document as Document & {
        requestStorageAccess?: () => Promise<void>;
      }
    ).requestStorageAccess;
    if (typeof req !== "function") return false;
    await req.call(document);
    return isStorageAvailable();
  } catch {
    return false;
  }
}

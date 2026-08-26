export class FetchTimeoutError extends Error {
  constructor(message = "Request timed out. Please try again.") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const { timeoutMs = 20_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    let data = {} as T;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        throw new Error(
          res.ok
            ? "Unexpected response from server."
            : `Server error (${res.status}). Please try again.`
        );
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new FetchTimeoutError();
    }
    if (err instanceof Error) throw err;
    throw new Error("Network error. Please check your connection and try again.");
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

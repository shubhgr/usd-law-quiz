export const UTM_PARAM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

export type UtmParamKey = (typeof UTM_PARAM_KEYS)[number];
export type UtmParams = Partial<Record<UtmParamKey, string>>;

const UTM_STORAGE_KEY = "usd-utm";

export function parseUtmFromSearch(search: string): UtmParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  const out: UtmParams = {};
  for (const key of UTM_PARAM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) out[key] = value;
  }
  return out;
}

export function hasUtm(params: UtmParams): boolean {
  return Object.keys(params).length > 0;
}

/** Read optional UTM + pageUrl fields from a register API body. */
export function utmFromRegisterBody(body: Record<string, unknown>): UtmParams & {
  pageUrl?: string;
} {
  const utm: UtmParams = {};
  for (const key of UTM_PARAM_KEYS) {
    const value =
      typeof body[key] === "string" ? body[key].trim() : "";
    if (value) utm[key] = value;
  }

  const pageUrl =
    typeof body.pageUrl === "string" ? body.pageUrl.trim() : "";

  if (!hasUtm(utm)) return {};

  return pageUrl ? { ...utm, pageUrl } : utm;
}

/** Persist UTMs from the landing URL for later register / background sync. */
export function captureLandingAttribution(): { pageUrl: string; utm: UtmParams } {
  if (typeof window === "undefined") return { pageUrl: "", utm: {} };

  const pageUrl = window.location.href;
  const utm = parseUtmFromSearch(window.location.search);

  if (hasUtm(utm)) {
    try {
      window.sessionStorage.setItem(
        UTM_STORAGE_KEY,
        JSON.stringify({ pageUrl, utm })
      );
    } catch {
      // ignore storage failures in embedded browsers
    }
  }

  return { pageUrl, utm };
}

export function getStoredAttribution(): { pageUrl: string; utm: UtmParams } {
  if (typeof window === "undefined") return { pageUrl: "", utm: {} };

  try {
    const raw = window.sessionStorage.getItem(UTM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { pageUrl?: string; utm?: UtmParams };
      return {
        pageUrl: parsed.pageUrl ?? "",
        utm: parsed.utm ?? {},
      };
    }
  } catch {
    // ignore
  }

  return captureLandingAttribution();
}

/** Flat object to attach to /api/register when UTMs were captured. */
export function attributionForRegister(): Record<string, string> {
  const { pageUrl, utm } = getStoredAttribution();
  if (!hasUtm(utm)) return {};

  const out: Record<string, string> = { ...utm };
  if (pageUrl) out.pageUrl = pageUrl;
  return out;
}

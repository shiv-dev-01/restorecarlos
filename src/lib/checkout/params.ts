import { DEFAULTS, DEFAULT_PLANS, STORAGE_KEY, SESSION_KEY, type Plan } from "./config";

/** Guide Section 5 ad attribution — passthrough to analytics only. */
export const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_campaign_id",
  "utm_adset_name",
  "utm_adset_id",
  "utm_ad_name",
  "utm_ad_id",
  "utm_content",
  "utm_term",
  "fbc_id",
  "h_ad_id",
  "gclid",
  "fbclid",
  "click_id",
] as const;

export const PII_KEYS = [
  "fname",
  "lname",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zip",
] as const;

type Cache = Record<string, string>;

// Cache is scoped per site_id so one brand's theme never bleeds into another
// brand's bare load on a shared browser.
function scopedKey(siteId: string): string {
  return `${STORAGE_KEY}:${siteId}`;
}

function readCache(key: string): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, next: Cache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
    // Legacy unscoped key is no longer used; drop it if present.
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type Resolver = (key: string, fallback?: string) => string;

// Primary names are the fixed upstream contract. Legacy names stay readable
// as aliases so older links keep working.
const ALIASES: Record<string, string[]> = {
  theme_logo_text: ["theme_brand_name"],
  theme_subheadline: ["theme_subhead"],
  theme_button_text: ["theme_cta_text"],
  theme_med_tabs: ["show_tabs"],
  theme_coupon: ["show_coupon"],
  planId: ["plan"],
};

export function buildResolver(query: URLSearchParams): Resolver {
  const siteId = query.get("site_id") || DEFAULTS.site_id;
  const storageKey = scopedKey(siteId);
  const cache = readCache(storageKey);
  const persist: Cache = { ...cache };

  const resolve: Resolver = (key, fallback = "") => {
    const names = [key, ...(ALIASES[key] ?? [])];
    for (const name of names) {
      const fromUrl = query.get(name);
      if (fromUrl !== null && fromUrl !== "") {
        persist[key] = fromUrl;
        return fromUrl;
      }
    }
    const cached = cache[key];
    if (cached !== undefined && cached !== "") return cached;
    return fallback;
  };


  // Warm the cache for theme keys so a later bare load keeps the brand.
  for (const key of Object.keys(DEFAULTS)) {
    if (key.startsWith("theme_")) resolve(key, "");
  }
  resolve("theme_plans", "");
  resolve("theme_logo_url", "");
  resolve("theme_css_url", "");
  resolve("theme_back_url", "");
  writeCache(storageKey, persist);

  return resolve;
}

export function parsePlans(raw: string): { plans: Plan[]; usedFallback: boolean } {
  if (!raw) return { plans: DEFAULT_PLANS, usedFallback: true };
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { plans: DEFAULT_PLANS, usedFallback: true };
  }
  if (!Array.isArray(parsed)) return { plans: DEFAULT_PLANS, usedFallback: true };
  if (parsed.length === 0) return { plans: [], usedFallback: false };
  const plans = (parsed as Plan[]).filter((x) => x && x.id !== undefined);
  if (!plans.length) return { plans: DEFAULT_PLANS, usedFallback: true };
  return { plans, usedFallback: false };
}

export function pickPlan(plans: Plan[], planId: string): Plan | null {
  if (!plans.length) return null;
  const byId = plans.find((x) => String(x.id) === String(planId));
  if (byId) return byId;
  const preferred = plans.find((x) => String(x.id) === "3-month");
  return preferred ?? plans[0] ?? null;
}

export function resolveSessionId(query: URLSearchParams): string {
  const fromUrl = query.get("zlcid");
  if (typeof window === "undefined") return fromUrl ?? "";
  let id = fromUrl ?? "";
  try {
    if (!id) id = window.localStorage.getItem(SESSION_KEY) ?? "";
    if (!id) id = "s_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    window.localStorage.setItem(SESSION_KEY, id);
  } catch {
    /* ignore */
  }
  return id;
}

export function money(n: number): string {
  const v = Number(n || 0);
  return (
    "$" +
    v.toLocaleString("en-US", {
      minimumFractionDigits: Number.isInteger(v) ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
}


export function fillTokens(template: string, price: number): string {
  return template.split("{price}").join(money(price)).split("${today}").join(money(price));
}

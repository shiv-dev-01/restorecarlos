export type BeaconContext = {
  collectorUrl: string;
  siteId: string;
  zlcid: string;
  sku: string;
  planId: string;
  quantity: number;
  duration: number;
  passthrough: Record<string, string>;
};

export type BeaconInput = {
  event: string;
  step: string;
  eventId: string;
  value?: number;
};

// Compliance allowlist: only attribution keys may travel in the collector
// payload. Buyer PII (name/email/phone/address) and planId must never leave
// the page through tracking, so anything outside this list is dropped before
// emission regardless of how passthrough was assembled.
const ALLOWED_PASSTHROUGH = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_ad_name",
  "click_id",
  "fbc_id",
  "h_ad_id",
]);

export function makeEventId(prefix: string): string {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export function sendBeacon(ctx: BeaconContext, input: BeaconInput) {
  const passthrough: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.passthrough || {})) {
    if (ALLOWED_PASSTHROUGH.has(k)) passthrough[k] = v;
  }
  const payload = {
    site_id: ctx.siteId,
    event: input.event,
    event_id: input.eventId,
    step: input.step,
    consent: true,
    ids: { zlcid: ctx.zlcid },
    user: {},
    value: input.value ?? 0,
    currency: "USD",
    properties: {
      sku: ctx.sku,
      quantity: ctx.quantity,
      duration: ctx.duration,
      ...passthrough,
    },
  };
  const body = JSON.stringify(payload);
  post(ctx.collectorUrl, body);
  if (typeof window !== "undefined") {
    const w = window as unknown as { __uppp_beacons?: unknown[] };
    w.__uppp_beacons = w.__uppp_beacons || [];
    w.__uppp_beacons.push(payload);
  }
  return payload;
}

// Simple request only: no preflight, no CORS console noise, fire and forget.
function post(url: string, body: string) {
  let queued = false;
  try {
    const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      queued = navigator.sendBeacon(url, blob);
    }
  } catch {
    queued = false;
  }
  if (queued) return;
  try {
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body,
      keepalive: true,
      mode: "no-cors",
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

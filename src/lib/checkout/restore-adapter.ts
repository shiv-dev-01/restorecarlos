/**
 * Restore adapter #1.
 *
 * Wires the universal payment page to the already-live Restore backend.
 * Every endpoint and every plan mapping is configuration, overridable by URL
 * param, so a later brand can swap them without touching the shell.
 *
 * Compliance: no medication name is ever sent from here. product_name uses the
 * page's compliant display label and sku uses the configured SKU code only.
 */

export type RestoreEndpoints = {
  intentUrl: string;
  orderUrl: string;
  couponUrl: string;
};

export const RESTORE_ENDPOINTS: RestoreEndpoints = {
  intentUrl: "https://panel.whitelabelmd.com/restoredelivered/api/stripe/create-payment-intent",
  orderUrl: "https://panel.whitelabelmd.com/restoredelivered/api/createOrder_stripe",
  couponUrl: "https://panel.whitelabelmd.com/wlmdbackend/api/check_coupons_v3",
};

/** Demo/test PaymentIntent (Stripe test mode). Used only when mode=demo. */
export const RESTORE_SANDBOX_INTENT_URL =
  "https://panel.whitelabelmd.com/restoredelivered/api/stripe/create-payment-intent-sandbox";

/** Restore adapter #1 public config. Overridable per brand via URL params. */
export const RESTORE_SITE_ID = "393";
export const RESTORE_PUBLISHABLE_KEY =
  String(import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY"] || "").trim() ||
  "pk_live_51TvkVOLP5uAprgPreDlwqyulcF8XVwFyeImHOt25HFoTtN8zIbnT4lxqr9GNHc7SDfNh0xnAK9NK2afq3tHSWNEU0099tGG0MO";

/** Stripe test publishable key for mode=demo (sandbox PaymentIntent). */
export const RESTORE_PUBLISHABLE_KEY_TEST =
  String(import.meta.env["VITE_STRIPE_PUBLISHABLE_KEY_TEST"] || "").trim() ||
  "pk_test_51TvkVOLP5uAprgPrZSERD8tW1QVl5XLIX5rIB7crEp12fi5ilaZjrOOxq7ttBpXBHJBClW3aL3t3PJzr9JtkBUXz0054OsR9ph";

/** Per-plan live backend product id. Overridable via restore_product_map. */
export const RESTORE_PRODUCT_MAP: Record<string, string> = {
  "1-month": "13",
  "3-month": "14",
  "6-month": "15",
  "12-month": "16",
};


export type RestoreBuyer = {
  fname: string;
  lname: string;
  email: string;
  phone: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
};

export type RestoreConfig = {
  endpoints: RestoreEndpoints;
  productId: string;
  productName: string;
  sku: string;
  amount: number;
  currency: string;
  coupon: string;
  promoCodes: string[];
  startUrl: string;
  buyer: RestoreBuyer;
};

export type AdapterResult =
  | { ok: true; reference: string }
  | { ok: false; error: string };

const REQUIRED: Array<[keyof RestoreBuyer, string]> = [
  ["fname", "first name"],
  ["lname", "last name"],
  ["email", "email"],
  ["phone", "phone"],
  ["address", "address"],
  ["city", "city"],
  ["state", "state"],
  ["zip", "zip"],
];

export function missingRestoreFields(cfg: RestoreConfig): string[] {
  const missing: string[] = [];
  for (const [key, label] of REQUIRED) {
    if (!String(cfg.buyer[key] || "").trim()) missing.push(label);
  }
  if (!cfg.productId) missing.push("product id");
  if (!(Number(cfg.amount) > 0)) missing.push("amount");
  return missing;
}

export function parseProductMap(raw: string): Record<string, string> {
  if (!raw) return RESTORE_PRODUCT_MAP;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return RESTORE_PRODUCT_MAP;
    }
    const out: Record<string, string> = { ...RESTORE_PRODUCT_MAP };
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v !== null && v !== undefined && String(v) !== "") out[k] = String(v);
    }
    return out;
  } catch {
    return RESTORE_PRODUCT_MAP;
  }
}

type Loose = Record<string, unknown>;

function pick(data: Loose, keys: string[]): string {
  const nested = (data["data"] as Loose | undefined) ?? {};
  for (const key of keys) {
    const direct = data[key];
    if (typeof direct === "string" && direct) return direct;
    if (typeof direct === "number") return String(direct);
    const deep = nested[key];
    if (typeof deep === "string" && deep) return deep;
    if (typeof deep === "number") return String(deep);
  }
  return "";
}

export function readClientSecret(data: Loose): string {
  return pick(data, ["clientSecret", "client_secret"]);
}

export function readIntentId(data: Loose): string {
  return pick(data, ["paymentIntentId", "payment_intent_id", "id"]);
}

export function readOrderReference(data: Loose): string {
  const nested = (data["data"] as Loose | undefined) ?? {};
  const list = (data["success_orders"] ?? nested["success_orders"]) as unknown;
  if (Array.isArray(list) && list.length > 0) {
    const first = list[0] as unknown;
    if (typeof first === "string" || typeof first === "number") return String(first);
    if (first && typeof first === "object") {
      const rec = first as Loose;
      const id = rec["order_id"] ?? rec["id"];
      if (id !== undefined && id !== null) return String(id);
    }
  }
  return pick(data, ["order_id"]);
}

async function postJson(url: string, body: unknown): Promise<Loose> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  let data: Loose = {};
  try {
    data = (await res.json()) as Loose;
  } catch {
    data = {};
  }
  if (!res.ok) {
    const message = typeof data["message"] === "string" ? (data["message"] as string) : "";
    throw new Error(message || `Request failed with status ${res.status}`);
  }
  return data;
}

/** Stripe requires the charge amount in the smallest currency unit. */
export function toCents(amount: number): number {
  return Math.max(0, Math.round(Number(amount || 0) * 100));
}

export function buildIntentBody(cfg: RestoreConfig) {
  const b = cfg.buyer;
  return {
    email: b.email,
    firstName: b.fname,
    lastName: b.lname,
    first_name: b.fname,
    last_name: b.lname,
    product_name: cfg.productName,
    sku: cfg.sku,
    amount: toCents(cfg.amount),
    currency: cfg.currency,
    productId: cfg.productId,
    phone: b.phone,
    address: b.address,
    city: b.city,
    city_name: b.city,
    state: b.state,
    state_name: b.state,
    zip: b.zip,
    zip_code: b.zip,
    coupon: cfg.coupon,
    promo_codes: cfg.promoCodes,
  };
}

export type CouponResult =
  | { ok: true; code: string; discount: number }
  | { ok: false; error: string };

/** Validates a promo code against the live coupon endpoint. */
export async function checkRestoreCoupon(args: {
  couponUrl: string;
  siteId: string;
  code: string;
  productId: string;
  email: string;
}): Promise<CouponResult> {
  const code = String(args.code || "").trim();
  if (!code) return { ok: false, error: "Enter a promo code." };
  try {
    const data = await postJson(args.couponUrl, {
      site_id: Number(args.siteId) || args.siteId,
      promo_codes: code,
      product_id: String(args.productId),
      email: args.email || "traceable@example.com",
    });
    const nested = (data["data"] as Loose | undefined) ?? {};
    const rawDiscount = nested["discount_amount"] ?? data["discount_amount"];
    const discount = Number(String(rawDiscount ?? 0).replace(/,/g, ""));
    const returned = String(nested["code"] ?? data["code"] ?? code);
    if (!Number.isFinite(discount) || discount <= 0) {
      return { ok: false, error: "That promo code is not valid." };
    }
    return { ok: true, code: returned || code, discount };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "";
    return { ok: false, error: message || "That promo code could not be validated." };
  }
}

/** Step 1 only: create the live payment intent. No order is created here. */
export async function createRestoreIntent(
  cfg: RestoreConfig,
): Promise<
  { ok: true; clientSecret: string; intentId: string } | { ok: false; error: string }
> {
  const missing = missingRestoreFields(cfg);
  if (missing.length) {
    return {
      ok: false,
      error: `Checkout is not configured correctly. Missing required details: ${missing.join(", ")}.`,
    };
  }
  try {
    const intent = await postJson(cfg.endpoints.intentUrl, buildIntentBody(cfg));
    const clientSecret = readClientSecret(intent);
    const intentId = readIntentId(intent) || clientSecret.split("_secret")[0] || "";
    if (!clientSecret || !intentId) {
      return { ok: false, error: "Payment could not be started. Please contact support." };
    }
    return { ok: true, clientSecret, intentId };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "";
    return { ok: false, error: message || "Payment could not be started. Please contact support." };
  }
}

/** Step 2 only: create the order after Stripe confirms the payment. */
export async function createRestoreOrder(
  cfg: RestoreConfig,
  paymentIntentId: string,
): Promise<AdapterResult> {
  try {
    const order = await postJson(cfg.endpoints.orderUrl, buildOrderBody(cfg, paymentIntentId));
    const reference = readOrderReference(order);
    if (!reference) {
      return { ok: false, error: "Your order could not be confirmed. Please contact support." };
    }
    return { ok: true, reference };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "";
    return { ok: false, error: message || "Your order could not be confirmed. Please contact support." };
  }
}


export function buildOrderBody(cfg: RestoreConfig, paymentToken: string) {
  const b = cfg.buyer;
  const body: Record<string, unknown> = {
    email: b.email,
    first_name: b.fname,
    last_name: b.lname,
    phone: b.phone,
    address: b.address,
    city_name: b.city,
    state_name: b.state,
    zip_code: b.zip,
    start_url: cfg.startUrl,
    payment_token: paymentToken,
    product_id: [cfg.productId],
    billingSameAsShipping: "YES",
    promo_codes: cfg.promoCodes,
  };
  if (b.address2) body["address2"] = b.address2;
  return body;
}

/** Runs the live Restore payment path. Never fabricates a success reference. */
export async function runRestoreAdapter(cfg: RestoreConfig): Promise<AdapterResult> {
  const missing = missingRestoreFields(cfg);
  if (missing.length) {
    return {
      ok: false,
      error: `Checkout is not configured correctly. Missing required details: ${missing.join(", ")}.`,
    };
  }
  try {
    const intent = await postJson(cfg.endpoints.intentUrl, buildIntentBody(cfg));
    const secret = readClientSecret(intent);
    const intentId = readIntentId(intent);
    if (!secret || !intentId) {
      return { ok: false, error: "Payment could not be started. Please contact support." };
    }
    const order = await postJson(cfg.endpoints.orderUrl, buildOrderBody(cfg, intentId));
    const reference = readOrderReference(order);
    if (!reference) {
      return { ok: false, error: "Your order could not be confirmed. Please contact support." };
    }
    return { ok: true, reference };
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : "";
    return {
      ok: false,
      error: message || "Payment could not be completed. Please contact support.",
    };
  }
}

import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { DEFAULTS, DEFAULT_PLANS, type Plan } from "../lib/checkout/config";
import {
  PII_KEYS,
  UTM_KEYS,
  buildResolver,
  fillTokens,
  money,
  parsePlans,
  pickPlan,
  resolveSessionId,
} from "../lib/checkout/params";
import { makeEventId, sendBeacon, type BeaconContext } from "../lib/checkout/beacon";
import {
  RESTORE_ENDPOINTS,
  RESTORE_PUBLISHABLE_KEY,
  RESTORE_PUBLISHABLE_KEY_TEST,
  RESTORE_SANDBOX_INTENT_URL,
  RESTORE_SITE_ID,
  checkRestoreCoupon,
  missingRestoreFields,
  parseProductMap,

  type RestoreBuyer,
  type RestoreConfig,
} from "../lib/checkout/restore-adapter";
import { RestorePayment, type ConfirmFn } from "../components/RestorePayment";
import { publicUrl } from "../lib/utils";



export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Secure payment" },
      {
        name: "description",
        content: "Enter your card details to complete your secure payment.",
      },
      { property: "og:title", content: "Secure payment" },
      {
        property: "og:description",
        content: "Enter your card details to complete your secure payment.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const query = useMemo(() => new URLSearchParams(searchStr || ""), [searchStr]);
  // Direct-traffic default: a URL with no skin parameter at all resolves to
  // the live Restore checkout. Any explicit skin param keeps prior behavior.
  const hasSkinParam = query.get("skin") !== null;

  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [reference, setReference] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [discount, setDiscount] = useState(0);
  const [couponMsg, setCouponMsg] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const viewTracked = useRef(false);
  const leadTracked = useRef(false);
  const startTracked = useRef(false);
  const payTracked = useRef(false);
  const confirmRef = useRef<ConfirmFn | null>(null);
  const autoCoupon = useRef(false);


  // Resolution order: URL param, then uppp.v1:<site_id> cache, then baked default.
  const cfg = useMemo(() => {
    const p = buildResolver(query);
    const { plans: parsed } = parsePlans(p("theme_plans", ""));
    // Guard: theme_plans must never produce a $0/NaN charge. Only accept the
    // param when every entry is a well-formed Plan (id plus a numeric `today`
    // price). Absent, unparseable, empty, or wrongly-shaped values fall back
    // to the built-in default plan set exactly as if theme_plans was omitted.
    const wellFormed =
      parsed.length > 0 &&
      parsed.every(
        (x) =>
          x &&
          x.id !== undefined &&
          Number.isFinite(Number(x.today)) &&
          Number(x.today) > 0,
      );
    return { p, plans: wellFormed ? parsed : DEFAULT_PLANS };
  }, [query, ready]);

  const { p, plans } = cfg;

  const selected: Plan | null = useMemo(() => {
    const planFallback = hasSkinParam ? "" : "1-month";
    const picked = pickPlan(plans, p("planId", planFallback));
    // Final safety net: a resolved selection without a positive numeric price
    // falls back to the default set (unknown planId -> default selection).
    if (!picked || !Number.isFinite(Number(picked.today)) || Number(picked.today) <= 0) {
      return pickPlan(DEFAULT_PLANS, p("planId", planFallback));
    }
    return picked;
  }, [plans, p, hasSkinParam]);

  const amountParam = Number(p("amount", "0")) || 0;
  const price = selected ? Number(selected.today) : amountParam;

  // PII arrives from the funnel in the URL. It is never rendered as an input.
  const buyer = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of PII_KEYS) out[k] = query.get(k) ?? "";
    return out;
  }, [query]);

  // Hidden pass-through only. Aliases keep older funnel links working.
  const restoreBuyer: RestoreBuyer = useMemo(() => {
    const g = (...names: string[]) => {
      for (const n of names) {
        const v = query.get(n);
        if (v !== null && v !== "") return v;
      }
      return "";
    };
    return {
      fname: g("fname", "first_name", "firstName"),
      lname: g("lname", "last_name", "lastName"),
      email: g("email"),
      phone: g("phone"),
      address: g("address", "address1", "street"),
      address2: g("address2", "apt"),
      city: g("city", "city_name"),
      state: g("state", "state_name"),
      zip: g("zip", "zip_code", "postal_code"),
    };
  }, [query]);

  // Card capture only: buyer fields arrive via URL params from the funnel
  // handoff. The page never collects PII in-page.

  const zlcid = useMemo(() => (ready ? resolveSessionId(query) : ""), [query, ready]);

  const planId = selected ? String(selected.id) : p("planId", "");

  const ctx: BeaconContext = useMemo(
    () => ({
      collectorUrl: p("collector_url", DEFAULTS.collector_url),
      siteId: p("site_id", DEFAULTS.site_id),
      zlcid,
      sku: p("sku", DEFAULTS.sku),
      quantity: Number(p("quantity", "1")) || 1,
      duration: Number(p("duration", "0")) || 0,
      passthrough: Object.fromEntries(
        UTM_KEYS.map((k) => [k, p(k, "")]).filter(([, v]) => v !== ""),
      ) as Record<string, string>,
    }),
    [p, zlcid],
  );

  const accent = p("theme_primary_color", DEFAULTS.theme_primary_color);
  const fontParam = p("theme_font", DEFAULTS.theme_font);
  const cssUrl = p("theme_css_url", "");
  const logoUrl = p("theme_logo_url", "");
  const backUrl = p("theme_back_url", "");
  // Bare /checkout (no skin param) defaults to live mode; explicit skin URLs
  // keep the existing baked default so ?skin=universal&mode=preview is unchanged.
  const isDemo = p("mode", hasSkinParam ? DEFAULTS.mode : "live") === "demo";

  // Presentation-only skin switch. Absent -> Restore skin (direct traffic).
  const isRestore = hasSkinParam
    ? (query.get("skin") || "").toLowerCase() === "restore"
    : true;
  // Adapter gate: live mode plus the Restore skin, or an explicit adapter param.
  const adapterName = (p("adapter", isRestore ? "restore" : "") || "").toLowerCase();
  const useRestoreAdapter = !isDemo && adapterName === "restore";
  /** Demo uses sandbox PI + test publishable key; never createOrder_stripe. */
  const useSandboxDemo = isDemo && (isRestore || adapterName === "restore");
  const useStripePayment = useRestoreAdapter || useSandboxDemo;
  const restoreProductId =
    p("productId", "") ||
    p("api_product_id", "") ||
    (parseProductMap(p("restore_product_map", ""))[String(selected ? selected.id : "")] ?? "");

  const restoreEndpoints = useMemo(
    () => ({
      intentUrl: useSandboxDemo
        ? p("restore_sandbox_intent_url", RESTORE_SANDBOX_INTENT_URL)
        : p("restore_intent_url", RESTORE_ENDPOINTS.intentUrl),
      orderUrl: p("restore_order_url", RESTORE_ENDPOINTS.orderUrl),
      couponUrl: p("restore_coupon_url", RESTORE_ENDPOINTS.couponUrl),
    }),
    [p, useSandboxDemo],
  );
  const restoreSiteId = p("restore_site_id", RESTORE_SITE_ID);
  const stripeKey = useSandboxDemo
    ? p("stripe_pk_test", "") ||
      p("stripe_pk", "") ||
      RESTORE_PUBLISHABLE_KEY_TEST ||
      RESTORE_PUBLISHABLE_KEY
    : p("stripe_pk", RESTORE_PUBLISHABLE_KEY);
  const urlCoupon = p("coupon", "") || p("promo_code", "") || p("promo_codes", "");

  // Coupon math stays on the page: total due is what Stripe is asked to charge.
  const total = Math.max(0, Math.round((price - discount) * 100) / 100);

  const restoreCfg: RestoreConfig = useMemo(
    () => ({
      endpoints: restoreEndpoints,
      productId: restoreProductId,
      productName: p("theme_product_label", DEFAULTS.theme_product_label),
      sku: p("sku", DEFAULTS.sku),
      amount: total,
      currency: "USD",
      coupon: appliedCoupon,
      promoCodes: appliedCoupon ? [appliedCoupon] : [],
      startUrl: typeof window !== "undefined" ? window.location.href : "",
      buyer: restoreBuyer,
    }),
    [restoreEndpoints, restoreProductId, p, total, appliedCoupon, restoreBuyer],
  );

  async function applyCoupon(code: string) {
    const value = String(code || "").trim();
    if (!value || couponBusy) return;
    setCouponBusy(true);
    setCouponMsg("");
    const res = await checkRestoreCoupon({
      couponUrl: restoreEndpoints.couponUrl,
      siteId: restoreSiteId,
      code: value,
      productId: restoreProductId,
      email: restoreBuyer.email,
    });
    if (!res.ok) {
      setDiscount(0);
      setAppliedCoupon("");
      setCouponMsg(res.error);
      setCouponBusy(false);
      return;
    }
    setDiscount(Math.min(res.discount, price));
    setAppliedCoupon(res.code);
    setCouponMsg("");
    setCouponBusy(false);
  }

  // Auto-apply a coupon that arrived in the URL.
  useEffect(() => {
    if (!ready || autoCoupon.current || !urlCoupon || !restoreProductId) return;
    autoCoupon.current = true;
    void applyCoupon(urlCoupon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, urlCoupon, restoreProductId]);


  // URL param beats skin default, skin default beats neutral fallback.
  const sk = (key: string, skinValue: string, fallback: string) => {
    const raw = query.get(key);
    if (raw !== null && raw !== "") return raw;
    return isRestore && skinValue ? skinValue : fallback;
  };

  useEffect(() => {
    if (isRestore) {
      document.documentElement.classList.add("skin-restore");
    }
    return () => document.documentElement.classList.remove("skin-restore");
  }, [isRestore]);

  useEffect(() => {
    setReady(true);
  }, []);

  // Amplifai conversion events. Email is the identity key and is attached
  // as soon as the funnel handoff provides it. Amount, currency, and order
  // id stay off every event except the successful payment.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let tries = 0;
    const fire = () => {
      if (cancelled) return;
      if (typeof window.track !== "function") {
        if (tries++ < 20) window.setTimeout(fire, 50);
        return;
      }
      const email = restoreBuyer.email.trim();
      const sku = ctx.sku || DEFAULTS.sku;
      const programCode = p("program_code", sku) || sku;
      const ads = trackAds(p);
      const identity = email ? { email } : {};

      if (!viewTracked.current) {
        viewTracked.current = true;
        window.track("page_viewed", { ...identity, step: "landing" });
        window.track("step_viewed", { ...identity, step: "checkout" });
      }
      if (email && !leadTracked.current) {
        leadTracked.current = true;
        window.track("lead_captured", { email, step: "email" });
      }
      if (email && !startTracked.current) {
        startTracked.current = true;
        window.track("checkout_started", {
          email,
          step: "payment",
          sku,
          program_code: programCode,
          ...ads,
        });
      }
    };
    fire();
    return () => {
      cancelled = true;
    };
  }, [ready, restoreBuyer.email, ctx.sku, p]);

  useEffect(() => {
    if (!cssUrl) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = cssUrl;
    link.setAttribute("data-uppp-theme-css", "1");
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [cssUrl]);

  useEffect(() => {
    if (isRestore) {
      document.title = "Restore — Secure Checkout";
    }
  }, [isRestore]);

  function finish(_eventId: string, ref: string) {
    const email = restoreBuyer.email.trim();
    const sku = ctx.sku || DEFAULTS.sku;
    const programCode = p("program_code", sku) || sku;
    if (!payTracked.current && typeof window.track === "function") {
      payTracked.current = true;
      window.track("checkout_payment", {
        ...(email ? { email } : {}),
        step: "payment",
        order_id: ref,
        amount: total,
        currency: "USD",
        sku,
        program_code: programCode,
        ...trackAds(p),
      });
    }
    setReference(ref);
    setDone(true);
    setPaying(false);
    window.scrollTo({ top: 0 });
  }

  async function pay() {
    if (paying) return;
    setPayError(null);
    setPaying(true);
    // Demo sandbox or live Restore: confirm Stripe Payment Element in-browser.
    // Demo never calls createOrder_stripe (skipOrder on RestorePayment).
    if (useStripePayment) {
      const missing = missingRestoreFields(restoreCfg);
      if (missing.length) {
        setPayError(
          `Order link is missing required details: ${missing.join(", ")}. Please use the link sent from your enrollment page.`,
        );
        setPaying(false);
        return;
      }
      const confirm = confirmRef.current;
      if (!confirm) {
        setPayError("Payment is still loading. Please try again in a moment.");
        setPaying(false);
        return;
      }
      await confirm();
      return;
    }
    if (isDemo) {
      window.setTimeout(() => {
        const ref = "demo_" + Date.now();
        finish(ref, ref);
      }, 600);
      return;
    }

    try {

      const res = await fetch(publicUrl("api/create-intent"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: ctx.sku,
          planId,
          amount: price,
          quantity: ctx.quantity,
          duration: ctx.duration,
        }),
      });
      const data = (await res.json()) as { client_secret?: string; stub?: boolean };
      const secret = data.client_secret || "";
      // Live mode must never accept a stub/demo secret as a real success.
      if (!isDemo && (data.stub === true || secret.startsWith("demo_secret_"))) {
        setPayError("Live payment provider is not configured. Please contact support.");
        setPaying(false);
        return;
      }
      // Stripe.js confirmation hooks in here once live keys are configured.
      const ref = secret.startsWith("pi_")
        ? (secret.split("_secret")[0] ?? secret)
        : "demo_" + Date.now();
      finish(ref, ref);
    } catch {
      setPaying(false);
    }
  }

  function onBackLink(e: React.MouseEvent) {
    e.preventDefault();
    sendBeacon(ctx, {
      event: "downsell_back",
      step: "back",
      eventId: makeEventId("back"),
    });
    window.location.href = backUrl;
  }

  const fontStack =
    fontParam && fontParam !== "system"
      ? `${fontParam}, ui-sans-serif, system-ui, sans-serif`
      : "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  const payTemplate = p("theme_button_text", DEFAULTS.theme_button_text);
  const productLabel = p("theme_product_label", DEFAULTS.theme_product_label);
  const supplyLabel = p("theme_supply_label", selected ? selected.name : DEFAULTS.theme_supply_label);
  const productImage = p("theme_product_image", "");
  const termsUrl = p("theme_terms_url", DEFAULTS.theme_terms_url);
  const perDay = p("theme_price_per_day", derivePerDay(price, selected, Number(p("duration", "0"))));

  const steps = isRestore
    ? ["Approval", "Shipping", "Payment"]
    : [
        p("theme_step1", DEFAULTS.theme_step1),
        p("theme_step2", DEFAULTS.theme_step2),
        p("theme_step3", DEFAULTS.theme_step3),
      ];

  const months = monthsFromPlan(selected) || Number(p("duration", "0")) || 0;
  const stackLabel = sk(
    "theme_stack_label",
    months ? `${months}-Month plan` : supplyLabel,
    months ? `${months}-Month plan` : supplyLabel,
  );
  const perMonth = selected ? Number(selected.mo) : months ? price / months : 0;
  const legalEntity = p("theme_legal_entity", DEFAULTS.theme_legal_entity);
  const legal1 = sk("theme_legal_1", DEFAULTS.theme_legal_1, "").replace(
    "{entity}",
    legalEntity,
  );
  const legal2 = sk("theme_legal_2", DEFAULTS.theme_legal_2, "").replace(
    "{entity}",
    legalEntity,
  );
  const skinAccent = isRestore && !query.get("theme_primary_color") ? "#065577" : accent;
  const clinicianLine = sk("theme_line_clinician", "Online Clinician Visit", "Online Clinician Visit");
  const shippingLine = sk(
    "theme_line_shipping",
    "Shipping 1-5 days from approval",
    "Shipping",
  );
  const showCoupon =
    p("theme_coupon", DEFAULTS.theme_coupon) !== "0" || !!urlCoupon;

  return (
    <div
      className={isRestore ? "uppp uppp-restore" : "uppp"}
      style={
        {
          "--uppp-accent": skinAccent,
          "--uppp-font": fontStack,
        } as React.CSSProperties
      }
    >
      <div className="uppp-topbar">
        <div className="uppp-topbar-in">
          <div className="uppp-logo">
            {logoUrl ? (
              <img src={logoUrl} alt={p("theme_logo_text", DEFAULTS.theme_logo_text)} />
            ) : isRestore ? (
              <img
                src={publicUrl("restore-logo.svg")}
                width={88}
                height={28}
                alt="Restore Hyper Wellness"
              />
            ) : (
              p("theme_logo_text", DEFAULTS.theme_logo_text)
            )}
          </div>
          {isRestore ? (
            <div className="uppp-hright">
              <ol className="uppp-hsteps">
                {steps.map((label, i) => (
                  <li
                    key={label + String(i)}
                    className={i === 2 ? "on" : "done"}
                    aria-current={i === 2 ? "step" : undefined}
                  >
                    <span className="n">{i === 2 ? "3" : i === 0 ? "1" : "2"}</span>
                    <span className="lbl">{label}</span>
                  </li>
                ))}
              </ol>
              <div className="uppp-secure">SECURE</div>
            </div>
          ) : (
            <div className="uppp-secure">SECURE PAYMENT</div>
          )}
        </div>
      </div>

      <div className="uppp-wrap">
        {isRestore ? null : (
          <ol className="uppp-steps">
            {steps.map((label, i) => (
              <li key={label + String(i)} className={i === 2 ? "on" : ""}>
                {label}
              </li>
            ))}
          </ol>
        )}

        <main>
          {done ? (
            <div className="uppp-ok">
              <h2>Payment confirmed</h2>
              <p className="uppp-ref">
                Confirmation ref {reference}
                {isDemo ? " (demo, no charge made)" : ""}
              </p>
            </div>
          ) : isRestore ? (
            <div className="uppp-rstack">
              <aside className={summaryOpen ? "uppp-rcard is-open" : "uppp-rcard"}>
                <button
                  type="button"
                  className="uppp-rtoggle"
                  aria-expanded={summaryOpen}
                  onClick={() => setSummaryOpen((v) => !v)}
                >
                  <span>Order summary</span>
                  <span className="uppp-rtoggle-amt">
                    {money(total)}
                    <span className="uppp-rchev" aria-hidden="true">
                      {summaryOpen ? "\u2013" : "+"}
                    </span>
                  </span>

                </button>
                <div className="uppp-rcard-body">
                <div className="uppp-rcard-top">
                  <img
                    className="uppp-rvial"
                    src={productImage || publicUrl("product-vial.png")}
                    alt=""
                    width={64}
                    height={96}
                  />
                  <div className="uppp-rcard-head">
                    <div className="uppp-rcard-eyebrow">
                      {sk("theme_product_eyebrow", "YOUR PROGRAM", "YOUR PROGRAM")}
                    </div>
                    <div className="uppp-rcard-title">{productLabel}</div>
                    <div className="uppp-rcard-meta">
                      {stackLabel}
                      {perMonth ? ` \u00b7 ${money(perMonth)}/mo` : ""}
                    </div>
                    {perDay ? (
                      <div className="uppp-rcard-day">As low as {perDay}</div>
                    ) : null}
                  </div>
                </div>

                <ul className="uppp-lines">
                  <li>
                    <span>{stackLabel}</span>
                    <span>{money(price)}</span>
                  </li>
                  {appliedCoupon && discount > 0 ? (
                    <li className="uppp-promo-line">
                      <span>
                        Promo {appliedCoupon}
                        <button
                          type="button"
                          className="uppp-promo-remove"
                          onClick={() => {
                            setAppliedCoupon("");
                            setDiscount(0);
                            setCouponMsg("");
                          }}
                        >
                          remove
                        </button>
                      </span>
                      <span>-{money(discount)}</span>
                    </li>
                  ) : (
                    <li className="inc">
                      <span>Discount</span>
                      <span>INCLUDED</span>
                    </li>
                  )}
                  <li className="inc">
                    <span>{clinicianLine}</span>
                    <span>
                      <span className="was">$49</span>
                      INCLUDED
                    </span>
                  </li>
                  <li className="inc">
                    <span>{shippingLine}</span>
                    <span>
                      <span className="was">$19.99</span>
                      INCLUDED
                    </span>
                  </li>
                </ul>

                <div className="uppp-total">
                  <span>{p("theme_total_label", DEFAULTS.theme_total_label)}</span>
                  <span className="amt">{money(total)}</span>
                </div>

                </div>
              </aside>

              <div className="uppp-rleft">
                <div className="uppp-pills">
                  <span className="uppp-pill">
                    {sk("theme_pill_1", "LegitScript certified", "LegitScript certified")}
                  </span>
                  <span className="uppp-pill">
                    {sk("theme_pill_2", "Refunded if not approved", "Refunded if not approved")}
                  </span>
                </div>

                <h1>{p("theme_headline", DEFAULTS.theme_pay_heading)}</h1>
                <p className="uppp-sub">{p("theme_subheadline", DEFAULTS.theme_pay_sub)}</p>
                <p className="uppp-notice">{p("theme_notice", DEFAULTS.theme_notice)}</p>

                {showCoupon ? (
                  <div className="uppp-promo">
                    <input
                      className="uppp-promo-input"
                      placeholder="Promo code"
                      defaultValue={urlCoupon || ""}
                      onBlur={(e) => {
                        if (e.target.value.trim()) void applyCoupon(e.target.value);
                      }}
                      aria-label="Promo code"
                    />
                    <button
                      type="button"
                      className="uppp-promo-apply"
                      disabled={couponBusy}
                      onClick={(e) => {
                        const input = (
                          e.currentTarget.previousElementSibling as HTMLInputElement
                        )?.value;
                        void applyCoupon(input || urlCoupon);
                      }}
                    >
                      Apply
                    </button>
                  </div>
                ) : null}
                {couponMsg ? <p className="uppp-promo-msg">{couponMsg}</p> : null}
                {appliedCoupon && discount > 0 && !couponMsg ? (
                  <p className="uppp-mini">
                    Promo {appliedCoupon} applied (−{money(discount)})
                  </p>
                ) : null}

                <div className="uppp-restore-paycard">
                  {useStripePayment ? (
                    <RestorePayment
                      publishableKey={stripeKey}
                      cfg={restoreCfg}
                      accent={skinAccent}
                      skipOrder={useSandboxDemo}
                      confirmRef={confirmRef}
                      onError={(m) => {
                        setPayError(m);
                        setPaying(false);
                      }}
                      onSuccess={(ref) => finish(ref, ref)}
                      onBusy={(b) => setPaying(b)}
                    />
                  ) : (
                    <PaymentFields isDemo={isDemo} />
                  )}
                  {payError ? <p className="uppp-error">{payError}</p> : null}

                  <button className="uppp-cta" type="button" onClick={pay} disabled={paying}>
                    {paying ? "Processing" : ctaLabel(payTemplate, total)}
                  </button>

                  <p className="uppp-secured">
                    {sk(
                      "theme_secured",
                      "Secured by Stripe \u00b7 256-bit SSL encryption",
                      p("theme_secured", DEFAULTS.theme_secured),
                    )}
                  </p>
                </div>

                <p className="uppp-fine">
                  {sk(
                    "theme_refund",
                    "You will be refunded if a licensed provider does not approve your prescription.",
                    p("theme_refund", DEFAULTS.theme_refund),
                  )}
                </p>
                <p className="uppp-fine">
                  {sk(
                    "theme_terms",
                    "By completing checkout, you agree to our",
                    p("theme_terms", DEFAULTS.theme_terms),
                  )}{" "}
                  <a href={termsUrl} target="_blank" rel="noreferrer">
                    Terms
                  </a>{" "}
                  and authorize recurring payments according to your selected plan.
                </p>
                {isDemo ? <p className="uppp-mini">Demo mode, no charge will be made.</p> : null}
                {backUrl ? (
                  <p className="uppp-secured">
                    <a className="uppp-back" href={backUrl} onClick={onBackLink}>
                      {p("theme_back_label", DEFAULTS.theme_back_label)}
                    </a>
                  </p>
                ) : null}
                {p("theme_footnote", DEFAULTS.theme_footnote) ? (
                  <p className="uppp-mini">{p("theme_footnote", DEFAULTS.theme_footnote)}</p>
                ) : null}
                <footer className="uppp-footer">
                  {legal1 ? <p>{legal1}</p> : null}
                  {legal2 ? <p>{legal2}</p> : null}
                </footer>
              </div>
            </div>
          ) : (
            <>
              <p className="uppp-notice">{p("theme_notice", DEFAULTS.theme_notice)}</p>

              <section className="uppp-summary">
                <div className="uppp-sum-top">
                  {productImage ? (
                    <img className="uppp-vial" src={productImage} alt={productLabel} />
                  ) : (
                    <div className="uppp-vial" aria-hidden="true" />
                  )}
                  <div>
                    <div className="uppp-sum-title">{productLabel}</div>
                    <div className="uppp-sum-supply">{supplyLabel}</div>
                  </div>
                  {perDay ? <div className="uppp-sum-day">{perDay}</div> : null}
                </div>

                <ul className="uppp-lines">
                  <li>
                    <span>{selected ? selected.name : supplyLabel}</span>
                    <span>{money(price)}</span>
                  </li>
                  <li className="inc">
                    <span>Discount</span>
                    <span>INCLUDED</span>
                  </li>
                  <li className="inc">
                    <span>{clinicianLine}</span>
                    <span>INCLUDED</span>
                  </li>
                  <li className="inc">
                    <span>{shippingLine}</span>
                    <span>INCLUDED</span>
                  </li>
                </ul>

                <div className="uppp-total">
                  <span>{p("theme_total_label", DEFAULTS.theme_total_label)}</span>
                  <span className="amt">{money(price)}</span>
                </div>
              </section>

              <h1>{p("theme_headline", DEFAULTS.theme_pay_heading)}</h1>
              <p className="uppp-sub">{p("theme_subheadline", DEFAULTS.theme_pay_sub)}</p>

              <PaymentFields isDemo={isDemo} />
              {payError ? <p className="uppp-error">{payError}</p> : null}

              <button className="uppp-cta" type="button" onClick={pay} disabled={paying}>
                {paying ? "Processing" : ctaLabel(payTemplate, price)}
              </button>

              <p className="uppp-secured">{p("theme_secured", DEFAULTS.theme_secured)}</p>
              <p className="uppp-fine">{p("theme_refund", DEFAULTS.theme_refund)}</p>
              <p className="uppp-fine">
                {p("theme_terms", DEFAULTS.theme_terms)}{" "}
                <a href={termsUrl}>Terms of Service</a>
              </p>
              {isDemo ? <p className="uppp-mini">Demo mode, no charge will be made.</p> : null}
              {backUrl ? (
                <p className="uppp-secured">
                  <a className="uppp-back" href={backUrl} onClick={onBackLink}>
                    {p("theme_back_label", DEFAULTS.theme_back_label)}
                  </a>
                </p>
              ) : null}
              {p("theme_footnote", DEFAULTS.theme_footnote) ? (
                <p className="uppp-mini">{p("theme_footnote", DEFAULTS.theme_footnote)}</p>
              ) : null}
              <p className="uppp-legal">{p("theme_disclaimer", DEFAULTS.theme_disclaimer)}</p>
            </>
          )}
        </main>
      </div>

      {isRestore && !done ? (
        <div className="uppp-stickybar">
          <button className="uppp-cta" type="button" onClick={pay} disabled={paying}>
            {paying ? "Processing" : ctaLabel(payTemplate, total)}
          </button>
        </div>
      ) : null}
    </div>
  );
}


function trackAds(p: (key: string, fallback?: string) => string): Pick<AmplifaiTrackOptions, "fbc_id" | "h_ad_id"> {
  const ads: Pick<AmplifaiTrackOptions, "fbc_id" | "h_ad_id"> = {};
  const fbc = p("fbc_id", "");
  const had = p("h_ad_id", "");
  if (fbc) ads.fbc_id = fbc;
  if (had) ads.h_ad_id = had;
  return ads;
}

function derivePerDay(price: number, plan: Plan | null, duration: number): string {
  const months = duration || monthsFromPlan(plan);
  if (!price || !months) return "";
  const perDay = price / (months * 30);
  return "$" + perDay.toFixed(2) + "/day";
}

function monthsFromPlan(plan: Plan | null): number {
  if (!plan) return 0;
  const match = /^(\d+)/.exec(String(plan.id));
  return match ? Number(match[1]) : 0;
}

function ctaLabel(template: string, price: number): string {
  const has = template.includes("{price}") || template.includes("${today}");
  const base = fillTokens(template, price);
  return has ? base : `${base}, ${money(price)} today`;
}

function PaymentFields({ isDemo }: { isDemo: boolean }) {
  return (
    <section className="uppp-pay">
      <label htmlFor="card">CARD NUMBER</label>
      <input
        id="card"
        className="uppp-cardnum"
        autoComplete="cc-number"
        inputMode="numeric"
        placeholder="4242 4242 4242 4242"
        defaultValue={isDemo ? "4242 4242 4242 4242" : ""}
        disabled={isDemo}
        onInput={(e) => {
          const digits = e.currentTarget.value.replace(/\D/g, "");
          if (digits.length >= 16) document.getElementById("exp")?.focus();
        }}
      />
      <div className="uppp-grid2">
        <div>
          <label htmlFor="exp">EXPIRY</label>
          <input
            id="exp"
            placeholder="12 / 30"
            defaultValue={isDemo ? "12 / 30" : ""}
            disabled={isDemo}
            inputMode="numeric"
            autoComplete="cc-exp"
            onInput={(e) => {
              const el = e.currentTarget;
              if (el.value.replace(/\D/g, "").length >= 4) {
                document.getElementById("cvc")?.focus();
              }
            }}
          />
        </div>
        <div>
          <label htmlFor="cvc">CVC</label>
          <input
            id="cvc"
            placeholder="123"
            defaultValue={isDemo ? "123" : ""}
            disabled={isDemo}
            inputMode="numeric"
            maxLength={4}
            autoComplete="cc-csc"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Baked-in fallback config only. Every value here is replaceable via URL params.
 * Medication tab labels are DISPLAY-ONLY brand config. They never enter URLs,
 * beacons, or localStorage.
 */

export type Plan = {
  id: string;
  name: string;
  badge?: string;
  save?: string;
  mo: number;
  today: number;
};

export const DEFAULT_PLANS: Plan[] = [
  {
    id: "12-month",
    name: "12-Month Transformation",
    badge: "BEST PRICE",
    save: "Best value · includes Restore Studio benefits",
    mo: 99,
    today: 1188,
  },
  {
    id: "6-month",
    name: "6-Month Optimization",
    badge: "",
    save: "Includes Restore Studio benefits",
    mo: 119,
    today: 714,
  },
  {
    id: "3-month",
    name: "3-Month Momentum",
    badge: "",
    save: "Includes Restore Studio benefits",
    mo: 133,
    today: 399,
  },
  {
    id: "1-month",
    name: "1-Month Starter",
    badge: "",
    save: "Low commitment · cancel anytime",
    mo: 190,
    today: 190,
  },
];

export const DEFAULTS = {
  sku: "WM-003",
  mode: "demo",
  collector_url: "https://amplifai-collector.team-431.workers.dev/collect",
  site_id: "restore-wm",
  theme_logo_text: "Restore Hyper Wellness",
  theme_headline: "Payment Details",
  theme_subheadline: "Enter your card details to complete your secure payment.",
  theme_trust: "LegitScript certified, Refunded if not approved",
  theme_step1: "Approval",
  theme_step2: "Shipping",
  theme_step3: "Payment",
  theme_font: "system",
  theme_primary_color: "#0F766E",
  theme_button_text: "Pay ${today} Securely",
  theme_pay_button: "Pay ${today}",
  theme_back_label: "Change my plan",
  theme_footnote: "",
  theme_coupon: "0",
  theme_med_tabs: "0",
  theme_product_label: "Medical Weight Management Program",
  theme_supply_label: "3 month supply",
  theme_price_per_day: "",
  theme_product_image: "",
  theme_notice: "Final step \u2014 your provider review begins as soon as you complete checkout.",
  theme_pay_heading: "Payment Details",
  theme_pay_sub: "Secure checkout \u2022 Powered by Stripe",
  theme_secured: "Secured by Stripe \u00b7 256-bit SSL encryption",
  theme_refund: "If you are not approved by a licensed clinician, you are refunded in full.",
  theme_terms: "By completing checkout you agree to the Terms of Service and authorize recurring billing for your selected plan.",
  theme_terms_url: "https://restorefunnelv1.lovable.app/termsofservice",
  theme_disclaimer:
    "Prescription products require an online evaluation by a licensed clinician and are dispensed only if deemed appropriate.",
  theme_total_label: "Total Due",
  // Legal entity is configuration, never a hardcoded string in components.
  theme_legal_entity: "Restore Delivered",
  theme_legal_1:
    "Medical services are provided by licensed independent providers. Medications are fulfilled by licensed pharmacies. {entity} provides the technology platform that enables you to access medical care and pharmacy services and does not itself provide medical advice, diagnosis, or treatment, and does not operate as a pharmacy.",
  theme_legal_2:
    "We are committed to making our website accessible to all users. If you experience any difficulty accessing content or using features, please contact support for assistance.",
  theme_line_clinician: "Online Clinician Visit",
  theme_line_shipping: "Shipping 1-5 days from approval",
} as const;

export const STORAGE_KEY = "uppp.v1";
export const SESSION_KEY = "zl_zlcid";

// Theme cache is write-only. Scoped uppp.v1:<site_id> entries must never
// influence resolution, so we neutralize reads of those keys while leaving
// the namespacing (and any writes) intact.
if (typeof window !== "undefined") {
  try {
    const proto = window.Storage.prototype as Storage;
    const original = proto.getItem;
    proto.getItem = function (this: Storage, key: string): string | null {
      if (typeof key === "string" && key.startsWith(`${STORAGE_KEY}:`)) {
        return null;
      }
      return original.call(this, key);
    };
  } catch {
    /* ignore */
  }
}

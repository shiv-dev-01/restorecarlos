/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  /** Stripe test publishable key for mode=demo (sandbox PI). */
  readonly VITE_STRIPE_PUBLISHABLE_KEY_TEST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface AmplifaiTrackOptions {
  step?: string;
  email?: string;
  phone?: string;
  state?: string;
  sku?: string;
  program_code?: string;
  fbc_id?: string;
  h_ad_id?: string;
  utm?: Record<string, string>;
  order_id?: string;
  amount?: number;
  currency?: string;
}

interface Window {
  track?: (event: string, opts?: AmplifaiTrackOptions) => void;
}

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";

import {
  createRestoreIntent,
  createRestoreOrder,
  missingRestoreFields,
  toCents,
  type RestoreConfig,
} from "../lib/checkout/restore-adapter";

export type ConfirmFn = () => Promise<void>;

type Props = {
  publishableKey: string;
  cfg: RestoreConfig;
  accent: string;
  /** When false the intent is not created yet (e.g. buyer form still empty). */
  ready?: boolean;
  /**
   * Demo/sandbox: confirm the card in Stripe only — never call createOrder_stripe.
   * Matches universal_pay_page mode=demo behavior.
   */
  skipOrder?: boolean;
  confirmRef: MutableRefObject<ConfirmFn | null>;
  onError: (message: string) => void;
  onSuccess: (reference: string) => void;
  onBusy: (busy: boolean) => void;
};

const cache = new Map<string, Promise<Stripe | null>>();

function stripePromise(key: string) {
  let existing = cache.get(key);
  if (!existing) {
    existing = loadStripe(key);
    cache.set(key, existing);
  }
  return existing;
}

/**
 * Restore adapter #1 live payment surface. Creates the payment intent, mounts
 * the Stripe Payment Element, confirms in the browser, and only then creates
 * the order. No order is ever created before a confirmed payment.
 */
export function RestorePayment(props: Props) {
  const {
    publishableKey,
    cfg,
    accent,
    ready = true,
    skipOrder = false,
    confirmRef,
    onError,
    onSuccess,
    onBusy,
  } = props;
  const [clientSecret, setClientSecret] = useState("");
  const [intentId, setIntentId] = useState("");
  const [initError, setInitError] = useState("");
  const stripe = useMemo(() => {
    if (!publishableKey) return Promise.resolve(null);
    return stripePromise(publishableKey);
  }, [publishableKey]);

  const amount = cfg.amount;
  const coupon = cfg.coupon;
  const productId = cfg.productId;
  const intentUrl = cfg.endpoints.intentUrl;

  // Missing buyer/config fields must never block the render. When any are
  // absent the card fields mount in Stripe deferred-intent mode (no intent is
  // created) and validation fires at Pay click instead.
  const canInit = missingRestoreFields(cfg).length === 0;

  useEffect(() => {
    let cancelled = false;
    setClientSecret("");
    setIntentId("");
    setInitError("");
    // Do not create an intent until every required field is present.
    if (!ready || !canInit) return;
    void createRestoreIntent(cfg).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setInitError(res.error);
        return;
      }
      setClientSecret(res.clientSecret);
      setIntentId(res.intentId);
    });
    return () => {
      cancelled = true;
    };
    // Intent is re-created whenever the charged amount, coupon, or endpoint changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, coupon, productId, intentUrl, ready, canInit]);

  const appearance = {
    theme: "night" as const,
    variables: {
      colorPrimary: accent,
      colorBackground: "#0a1620",
      colorText: "#e8f0f5",
      borderRadius: "10px",
    },
  };

  if (!publishableKey) {
    return (
      <p className="uppp-error">
        {skipOrder
          ? "Demo Stripe test key is missing. Set VITE_STRIPE_PUBLISHABLE_KEY_TEST."
          : "Stripe publishable key is missing."}
      </p>
    );
  }

  if (!canInit) {
    // Deferred intent: PaymentElement mounts with amount/currency only. Pay
    // click validation in the page stops before any intent is created.
    return (
      <Elements
        key={`deferred-${amount}`}
        stripe={stripe}
        options={{
          mode: "payment",
          amount: toCents(amount) || 100,
          currency: (cfg.currency || "USD").toLowerCase(),
          appearance,
        }}
      >
        <section className="uppp-pay">
          <PaymentElement options={{ layout: "tabs" }} />
        </section>
      </Elements>
    );
  }

  if (initError) {
    return <p className="uppp-error">{initError}</p>;
  }
  if (!clientSecret) {
    return <p className="uppp-secured">Loading secure payment fields</p>;
  }

  return (
    <Elements
      key={clientSecret}
      stripe={stripe}
      options={{
        clientSecret,
        appearance,
      }}
    >
      <PaymentInner
        cfg={cfg}
        intentId={intentId}
        skipOrder={skipOrder}
        confirmRef={confirmRef}
        onError={onError}
        onSuccess={onSuccess}
        onBusy={onBusy}
      />
    </Elements>
  );
}

function PaymentInner({
  cfg,
  intentId,
  skipOrder,
  confirmRef,
  onError,
  onSuccess,
  onBusy,
}: {
  cfg: RestoreConfig;
  intentId: string;
  skipOrder: boolean;
  confirmRef: MutableRefObject<ConfirmFn | null>;
  onError: (message: string) => void;
  onSuccess: (reference: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const latest = useRef({ cfg, intentId, skipOrder });
  latest.current = { cfg, intentId, skipOrder };

  useEffect(() => {
    confirmRef.current = async () => {
      if (!stripe || !elements) {
        onError("Payment is still loading. Please try again in a moment.");
        onBusy(false);
        return;
      }
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
      });
      if (result.error) {
        onError(result.error.message || "Your payment could not be completed.");
        onBusy(false);
        return;
      }
      const pi = result.paymentIntent;
      const status = pi?.status ?? "";
      if (status !== "succeeded" && status !== "processing") {
        onError("Your payment was not completed. Please try another card.");
        onBusy(false);
        return;
      }
      const paymentId = pi?.id || latest.current.intentId;
      if (latest.current.skipOrder) {
        onSuccess(`demo_${paymentId || Date.now()}`);
        return;
      }
      const order = await createRestoreOrder(latest.current.cfg, paymentId);
      if (!order.ok) {
        onError(order.error);
        onBusy(false);
        return;
      }
      onSuccess(order.reference);
    };
    return () => {
      confirmRef.current = null;
    };
  }, [stripe, elements, confirmRef, onError, onSuccess, onBusy]);

  return (
    <section className="uppp-pay">
      <PaymentElement options={{ layout: "tabs" }} />
    </section>
  );
}

import { createFileRoute } from "@tanstack/react-router";

/**
 * Stub PaymentIntent endpoint for mode=live. Server price map wins over any
 * URL-supplied amount. Returns a mock client_secret until real keys are wired.
 */
const PRICE_MAP: Record<string, number> = {
  "12-month": 1188,
  "6-month": 714,
  "3-month": 399,
  "1-month": 190,
};

export const Route = createFileRoute("/api/create-intent")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        const planId = String(body["planId"] ?? "");
        const serverPrice = PRICE_MAP[planId];
        const amount = serverPrice ?? Number(body["amount"] ?? 0);
        return new Response(
          JSON.stringify({
            client_secret: "demo_secret_" + Date.now(),
            amount,
            currency: "USD",
            stub: true,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

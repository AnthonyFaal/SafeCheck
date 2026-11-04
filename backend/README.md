# SafeCheck API

NestJS + PostgreSQL API for the SafeCheck digital-safety companion.

## Run locally

1. Copy `.env.example` to `.env` and replace every placeholder. The mobile app also needs `EXPO_PUBLIC_API_URL` (including `/api/v1`).
2. Start PostgreSQL (and optional MinIO) with `docker compose up -d`. Upstash Redis is optional; set its REST credentials if scan limits must be shared across API instances.
3. Run `npx prisma migrate dev --name companion_foundation`.
4. Run `npm run start:dev`.

The API is versioned at `/api/v1`. `GET /api/v1/health` is the liveness check and `GET /api/v1/health/ready` verifies PostgreSQL readiness. `POST /api/v1/safety/scans` uses the private inference service configured by `INFERENCE_URL`; the model is never exposed to the mobile app. Set the same `INFERENCE_API_KEY` in both services. Production must keep `ALLOW_RULE_FALLBACK=false` so an unavailable model cannot silently present a fabricated model result.

## Full-stack Docker deployment

Copy root `.env.example` to `.env`, copy `backend/.env.example` to `backend/.env`, set strong secrets, and place the trained model artifacts under `safecheck-inference/models`. Then run `docker compose up --build`. The API waits for PostgreSQL and a model-ready inference health check. Run Prisma migrations as a release step before routing production traffic: `docker compose run --rm api npx prisma migrate deploy`.

Never commit `.env`, database credentials, JWT secrets, or third-party keys.

## Premium billing

Set `PAYSTACK_SECRET_KEY`, `PREMIUM_MONTHLY_AMOUNT_KOBO`, and `PREMIUM_CURRENCY` to enable checkout. The app only opens a Paystack-hosted checkout and the API verifies the provider transaction before activating Premium; it never trusts a client-side “paid” claim. Configure an HTTPS `EXPO_PUBLIC_CHECKOUT_CALLBACK_URL` in the mobile app before exposing this feature.

### Paystack webhook

Premium activation is also driven by Paystack's signed `charge.success` webhook, so the customer does not need to reopen the app after payment. In the Paystack dashboard, register this public HTTPS endpoint:

`https://<your-api-domain>/api/v1/webhooks/paystack`

Use the same live or test secret key in `PAYSTACK_SECRET_KEY` that belongs to the dashboard environment sending the event. The endpoint verifies the `x-paystack-signature` HMAC against the raw request body and treats a repeated successful payment reference as an acknowledged duplicate. Do not put this endpoint behind authentication or a proxy that changes the request body.

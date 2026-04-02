# Observability & Alerts (Supabase + Edge Functions)

## Structured logging fields
Log these keys in every Edge Function response path:
- `request_id`
- `user_id` (when authenticated)
- `function_name`
- `status_code`
- `latency_ms`
- `rate_limited` (boolean)

## Recommended production alerts
- Auth anomalies:
  - spike in failed sign-ins
  - unusual password reset bursts
- API abuse:
  - increase in `401` / `403` / `429`
  - repeated blocked origins (CORS)
- Backend reliability:
  - `5xx` rate by function (`chat`, `external-db-proxy`, `external-db-admin`, `execute-query`)
  - latency p95 and p99 threshold breaches
- Cost / usage anomalies:
  - abrupt increase in token consumption
  - users crossing expected monthly usage envelope

## Incident response baseline
1. Identify scope by `request_id` and user.
2. Revoke or rotate impacted credentials.
3. Temporarily tighten rate-limit if abuse is active.
4. Patch, redeploy, and run smoke tests.
5. Publish timeline and preventive actions.


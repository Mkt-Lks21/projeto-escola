# Delphi Proxy

Node.js service that replaces the Supabase Edge `external-db-proxy` when you need control over TLS and the outbound HTTPS stack.

## Endpoints

- `GET /health`
- `POST /external-db-proxy`
- `POST /api/external-db-proxy` (same handler, useful behind Nginx)

## Required env

- `INTERNAL_PROXY_KEY`
- `DELPHI_API_URL`
- `DELPHI_API_TOKEN`
- `DELPHI_AUTH_URL`
- `DELPHI_AUTH_TOKENAPI` or `tokenapi` already embedded in `DELPHI_AUTH_URL`

## Optional env

- `DELPHI_AUTH_BEARER`
- `DELPHI_AUTH_TIMEOUT_MS`
- `DELPHI_AUTH_CACHE_MAX_AGE_SEC`
- `ALLOWED_PROXY_HOSTS`
- `RATE_LIMIT_WINDOW_SEC`
- `RATE_LIMIT_MAX_REQ`
- `PORT`

## Run locally

```bash
npm run proxy:start
```

Or via Docker Compose:

```bash
cp deploy/vps.env.example deploy/vps.env
docker compose --env-file deploy/vps.env up --build
```

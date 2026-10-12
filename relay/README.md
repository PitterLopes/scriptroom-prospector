# Inbox Worker (Cloudflare)

Stable public endpoint for Meta's Instagram webhooks. Verifies `X-Hub-Signature-256` with the Instagram app
secret, stores each event once (by body hash) in a Durable Object with SQLite storage, and serves them in order to
the local prospector worker.

```
GET  /health                    → { ok, configured, total, last }
GET  /webhook?hub.…             → Meta subscription handshake (VERIFY_TOKEN)
POST /webhook                   → stores a signed event; 401 on bad signature; duplicates are ignored
GET  /events?after=<id>&limit=N → Authorization: Bearer RELAY_TOKEN → { events: [{id, receivedAt, body}], last }
```

Deploy from this folder: `npm install && npx wrangler secret put APP_SECRET` (and `VERIFY_TOKEN`, `RELAY_TOKEN`), then
`npx wrangler deploy`. The local system reads `RELAY_URL` and `RELAY_TOKEN` from `.env`. Events are kept 14 days.

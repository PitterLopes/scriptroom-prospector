# Scriptroom Prospector

Autonomous Instagram prospecting for [Scriptroom](https://scriptroom.online), built as a local Node.js app:
a Next.js panel (PT-BR) plus a worker that discovers profiles, scores them in code, writes a personal first DM
with an LLM, sends it through the operator's own Chrome, and continues the conversation through Meta's official
Messaging API once the lead replies. SQLite is the single source of truth. Code, schema and docs are in English;
everything the operator reads is in Portuguese (see `SETUP.md`).

> Operator manual (Portuguese): **[SETUP.md](./SETUP.md)**

## What it does

```
discover_profiles ──► enrich_and_score ──► send_first_dm (Chrome via CDP)
                                                   │
                                   lead replies ───► Meta webhook ──► process_inbound
                                                                           │
                                                   classify → decide → send_api_reply (Graph API)
```

- **Two channels, one owner at a time.** The browser owns the first contact only. The moment a reply arrives
  through the webhook, channel ownership moves to the API and the browser never touches that thread again
  (`src/features/leads/states.ts`, `channelOwner`). Every outbound message has a unique `dedupe_key`; a second
  attempt is refused by the database and trips the circuit breaker.
- **Claims guard.** The model may only state what `config/business.json › claims.verified` says. Every outbound
  text passes `checkClaims` (superlatives, guarantees, reach promises, unverified prices/percentages/social
  proof, competitors, credential requests, foreign links). A refused reply is retried once with the violations,
  then the lead goes to human review.
- **Content-first targeting.** Discovery queries come from the ICP, but qualification is about content: a lead needs
  readable recent posts (ideally reels); up to three are read and the opening must compliment one of them (validated
  by index in code). The worker follows the person right before the first DM on real sends.
- **Honest opening.** The first DM says who is writing, that the app is being built without outside money, asks for a
  test and feedback, and states that a "no" helps too. Three variants of that ask are the shipped experiment.
- **Human pace, by design.** Daily cap (15 by default) with a warm-up schedule, random spacing, operating hours in the operator's
  timezone, per-character typing delay. Instagram restrictions, lost sessions, repeated send failures, opt-out
  spikes, duplicate sends and the AI budget all pause the system automatically.
- **Dry-run by default.** `BROWSER_SEND_ENABLED=false` means the worker does everything except press Enter.
  Real sends need the `.env` flag **and** the panel switch.
- **Measured.** Every model call records model, tokens and cost (`ai_calls`). The dashboard shows cost per
  contacted lead and per active customer. The opening-message experiment ships with three variants and a
  control; weights only shift after the minimum sample and a 5-point lead.

## Stack

Next.js 16 (App Router, Server Components, Server Actions) · React 19 · TypeScript strict · Tailwind 4 · SQLite
(better-sqlite3, WAL) · Drizzle ORM with migrations · Playwright over CDP · OpenRouter (OpenAI-compatible,
structured outputs) · Vitest. Node 22+. npm with a lockfile (pnpm's corepack shim was broken on the dev machine;
the scripts are plain `npm run`).

## Layout

```
config/business.json         real business data — gitignored; see business.example.json
src/app                      panel (PT-BR), server actions, Meta webhook route
src/db                       schema, client (WAL, FK, busy timeout, auto-migrate), queries, backup/restore
src/features/leads           pipeline/channel state machines, dedupe, deterministic ICP scoring
src/features/campaigns       warm-up, daily cap, spacing, operating hours, typing cadence
src/features/conversations   intents, claims guard, conversation engine (opening/classify/decide)
src/features/experiments     weighted assignment with exploration, conservative review
src/integrations/browser     InstagramBrowser contract, Chrome-over-CDP adapter, fake for tests
src/integrations/instagram   webhook signature/parsing, Graph API client, 24h window
src/integrations/openrouter  model client (budget gate, structured output, cost accounting), prompts
src/worker                   durable job loop, scheduler, handlers, safety breakers, simulation
tests                        unit + end-to-end flow tests against fakes (no network)
drizzle                      SQL migrations
```

## Run

```bash
cp .env.example .env            # fill OPENROUTER_API_KEY at least
cp config/business.example.json config/business.json   # already filled for Scriptroom in this checkout
npm install
npm run dev                     # panel on http://localhost:3100 + worker, one command
```

Other commands: `npm run simulate` (end-to-end run against fakes, writes `data/simulation-report.md`),
`npm run worker:once`, `npm run db:backup`, `npm run db:restore -- backups/<file>.db`, `npm run check`
(lint + typecheck + tests + build).

## Data model (SQLite)

`leads` (unique `username`, unique `ig_user_id`, `pipeline_state` + `channel_state` as separate columns),
`conversations` (one per lead, `channel_owner`, `api_window_expires_at`), `messages` (unique `external_id`,
unique `dedupe_key`, `variant_id`), `lead_events` (timeline/audit per lead), `jobs` (durable queue with
`idempotency_key`, attempts, backoff, stale-lock recovery), `ai_calls`, `experiments` / `experiment_variants` /
`experiment_assignments`, `exceptions`, `webhook_events` (idempotency by body hash), `do_not_contact`,
`settings`, `audit_log`. Timestamps are ISO-8601 UTC.

## States

Pipeline (customers): `discovered → qualified → contacted → replied → interested → whatsapp_handoff → registered →
active_customer`, `closed` from anywhere. Pipeline (affiliates, modelled but not scheduled): `… → interested →
joined_affiliate_group → active_affiliate → generated_customer`.

Channel: `browser_contact_pending → browser_contact_sent → waiting_inbound_reply → api_eligible → api_active ⇄
api_window_closed`, plus `human_review_required`, and terminal `do_not_contact`, `blocked`, `completed`.

## Browser layer rules

Connect with `chromium.connectOverCDP(CHROME_CDP_URL)` (127.0.0.1 only), reuse `browser.contexts()[0]`, one new
tab per job closed in `finally`, never `bringToFront`, never leave `instagram.com`, one job at a time
(`withBrowserLock`). CDP down → `browser_unavailable` exception, browser queue paused, nothing opened. Restriction
or login page → whole system paused. Failures save a screenshot, an ARIA snapshot, URL, console errors and failed
requests under `screenshots/` and `traces/`. No fingerprint spoofing, no private API, no workaround of
restrictions. Instagram's DOM changes; selectors live only in `src/integrations/browser/cdp.ts`.

## Official API layer

Webhook: `GET /api/webhooks/instagram` handshake, `POST` with `X-Hub-Signature-256` verification, raw event
stored by hash, one `process_inbound` job per message. Sender IGSID is matched to a lead by `ig_user_id` or by
`GET /{igsid}?fields=username`. Replies go through `POST /me/messages` with the Page token, only while the
24-hour window is open; outside it the lead goes to `api_window_closed` and the operator is told. Nothing ever
falls back to the browser.

## Testing levels

1. `npm test` — 56 tests: state machines, scoring, limits, claims guard, experiments, queue, repository,
   webhook, and the full flow with a fake browser, fake model transport and fake Graph API.
2. `npm run simulate` — the same flow end to end on a disposable database, with a readable report.
3. Dry-run against the real Chrome: everything runs, the message is typed and cleared, nothing is sent.
4. Pilot: `BROWSER_SEND_ENABLED=true` + panel switch, with the warm-up at 5 DMs/day. Only after the operator
   authorises it explicitly.

## Known limits

- Discovery uses Instagram's web search page and profile headers; the DOM is unstable and may need selector
  updates. Profile "recent posts summary" and "last post date" are not extracted yet (scoring works without them).
- Follow-ups are API-only and therefore only possible inside Meta's 24-hour window; otherwise the operator is asked
  to follow up manually (the `HUMAN_AGENT` tag requires Meta approval).
- The affiliates funnel has its states and tables but no scheduler, prompts or UI yet (`affiliates.enabled` is false).
- `active_customer` is set by the operator; the App Store does not report who installed from a DM.

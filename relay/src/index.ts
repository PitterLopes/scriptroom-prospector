/**
 * Meta webhook inbox. Receives Instagram messaging webhooks at a stable public URL, verifies the signature,
 * stores each event in order, and lets the local prospector worker pull them with a bearer token.
 * No message is ever answered from here: this is a mailbox, not a bot.
 */
import { DurableObject } from "cloudflare:workers";

export interface Env {
  INBOX: DurableObjectNamespace<Inbox>;
  APP_SECRET: string;
  VERIFY_TOKEN: string;
  RELAY_TOKEN: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const RETENTION_DAYS = 14;

export class Inbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         hash TEXT UNIQUE NOT NULL,
         received_at TEXT NOT NULL,
         body TEXT NOT NULL
       )`,
    );
  }

  /** Returns the new id, or null when the same body was already stored (Meta retries). */
  append(hash: string, body: string): number | null {
    const existing = this.ctx.storage.sql.exec("SELECT id FROM events WHERE hash = ?", hash).toArray();
    if (existing.length > 0) return null;
    this.ctx.storage.sql.exec("INSERT INTO events (hash, received_at, body) VALUES (?, ?, ?)", hash, new Date().toISOString(), body);
    const row = this.ctx.storage.sql.exec("SELECT last_insert_rowid() AS id").one() as { id: number };
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    this.ctx.storage.sql.exec("DELETE FROM events WHERE received_at < ?", cutoff);
    return row.id;
  }

  list(after: number, limit: number): { events: Array<{ id: number; receivedAt: string; body: string }>; last: number } {
    const rows = this.ctx.storage.sql
      .exec("SELECT id, received_at, body FROM events WHERE id > ? ORDER BY id ASC LIMIT ?", after, limit)
      .toArray() as Array<{ id: number; received_at: string; body: string }>;
    const lastRow = this.ctx.storage.sql.exec("SELECT COALESCE(MAX(id), 0) AS id FROM events").one() as { id: number };
    return { events: rows.map((r) => ({ id: r.id, receivedAt: r.received_at, body: r.body })), last: lastRow.id };
  }

  stats(): { total: number; last: number } {
    const row = this.ctx.storage.sql.exec("SELECT COUNT(*) AS total, COALESCE(MAX(id), 0) AS last FROM events").one() as { total: number; last: number };
    return row;
  }
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const inbox = env.INBOX.get(env.INBOX.idFromName("meta"));

    if (url.pathname === "/health") {
      const stats = await inbox.stats();
      return json({ ok: true, configured: Boolean(env.APP_SECRET && env.VERIFY_TOKEN && env.RELAY_TOKEN), ...stats });
    }

    if (url.pathname === "/webhook" && request.method === "GET") {
      if (!env.VERIFY_TOKEN) return new Response("not configured", { status: 503 });
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (mode === "subscribe" && token && timingSafeEqual(token, env.VERIFY_TOKEN) && challenge) {
        return new Response(challenge, { status: 200 });
      }
      return new Response("forbidden", { status: 403 });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      if (!env.APP_SECRET) return new Response("not configured", { status: 503 });
      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) return new Response("too large", { status: 413 });
      const signature = request.headers.get("x-hub-signature-256") ?? "";
      const expected = `sha256=${await hmacHex(env.APP_SECRET, body)}`;
      if (!timingSafeEqual(signature, expected)) return new Response("invalid signature", { status: 401 });
      const id = await inbox.append(await sha256Hex(body), body);
      return json({ ok: true, stored: id !== null, id });
    }

    if (url.pathname === "/events" && request.method === "GET") {
      const auth = request.headers.get("authorization") ?? "";
      if (!env.RELAY_TOKEN || !timingSafeEqual(auth, `Bearer ${env.RELAY_TOKEN}`)) return new Response("unauthorized", { status: 401 });
      const after = Math.max(Number(url.searchParams.get("after") ?? 0) || 0, 0);
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), 500);
      return json(await inbox.list(after, limit));
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

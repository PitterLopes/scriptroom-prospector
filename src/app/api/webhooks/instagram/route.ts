import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { verifySubscription, verifyWebhookSignature } from "@/integrations/instagram/webhook";
import { ingestWebhookBody } from "@/integrations/instagram/inbox";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

const log = logger("webhook");

export const dynamic = "force-dynamic";

/** Meta's subscription handshake (only used when the webhook points straight at this machine through a tunnel). */
export async function GET(request: Request): Promise<Response> {
  const e = env();
  if (!e.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) return new NextResponse("webhook not configured", { status: 503 });
  const challenge = verifySubscription(new URL(request.url).searchParams, e.INSTAGRAM_WEBHOOK_VERIFY_TOKEN);
  if (!challenge) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

/** Signature first, then the shared ingestion. The route never talks to Instagram or to the model: the worker does. */
export async function POST(request: Request): Promise<Response> {
  const e = env();
  if (!e.INSTAGRAM_APP_SECRET) return new NextResponse("webhook not configured", { status: 503 });
  const raw = await request.text();
  if (!verifyWebhookSignature(raw, request.headers.get("x-hub-signature-256"), e.INSTAGRAM_APP_SECRET)) {
    log.warn("webhook signature rejected");
    return new NextResponse("invalid signature", { status: 401 });
  }
  const result = ingestWebhookBody(getDb(), raw, "route", e.INSTAGRAM_BUSINESS_ACCOUNT_ID);
  return NextResponse.json({ ok: true, ...result });
}

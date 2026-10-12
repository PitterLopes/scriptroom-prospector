import { openTestDatabase, type Db } from "@/db/client";
import { parseBusiness, type BusinessConfig } from "@/lib/config";
import type { Env } from "@/lib/env";
import { OpenRouterClient, type ModelTransport } from "@/integrations/openrouter/client";
import { FakeInstagramBrowser, type FakeBrowserOptions } from "@/integrations/browser/fake";
import { InstagramGraphClient } from "@/integrations/instagram/graph";
import { createContext, type WorkerContext } from "@/worker/context";
import fs from "node:fs";
import path from "node:path";

export const TEST_CONFIG: BusinessConfig = parseBusiness(JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "config/business.json"), "utf8")));

export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    OPENROUTER_API_KEY: "sk-or-v1-test",
    OPENROUTER_MODEL: "test/main",
    OPENROUTER_MODEL_FAST: "test/fast",
    OPENROUTER_MONTHLY_BUDGET_USD: 20,
    CHROME_CDP_URL: "http://127.0.0.1:9222",
    CHROME_PROFILE_DIR: "./.chrome-profile",
    BROWSER_SEND_ENABLED: false,
    INSTAGRAM_APP_SECRET: "secret",
    INSTAGRAM_PAGE_ACCESS_TOKEN: "token",
    INSTAGRAM_WEBHOOK_VERIFY_TOKEN: "verify",
    INSTAGRAM_BUSINESS_ACCOUNT_ID: "17841400000000000",
    META_GRAPH_VERSION: "v24.0",
    DATABASE_URL: ":memory:",
    BACKUP_DIR: "./backups",
    MAX_DMS_PER_DAY: 30,
    MIN_SECONDS_BETWEEN_DMS: 90,
    MAX_SECONDS_BETWEEN_DMS: 240,
    OPERATING_HOURS: "00:00-23:59",
    OPERATING_TIMEZONE: "America/Sao_Paulo",
    WARMUP_START_PER_DAY: 5,
    WARMUP_STEP_PER_WEEK: 5,
    ...overrides,
  };
}

export type CannedAi = {
  opening?: { message: string; detail_used?: string };
  classify?: { intent: string; confidence?: number; summary?: string; objection?: string };
  decide?: { action: string; reply: string; follow_up_hours?: number; pipeline_hint?: string; reasoning?: string };
  costPerCall?: number;
  failStatus?: number;
};

/** A transport that answers with canned JSON per purpose, so tests never touch the network. */
export function fakeTransport(canned: CannedAi, calls: Array<{ purpose: string; body: Record<string, unknown> }> = []): ModelTransport {
  return async (body) => {
    const schemaName = (body.response_format as { json_schema?: { name?: string } } | undefined)?.json_schema?.name ?? "";
    const purpose = schemaName === "opening_message" ? "opening" : schemaName === "inbound_classification" ? "classify" : "decide";
    calls.push({ purpose, body });
    if (canned.failStatus) return { status: canned.failStatus, data: { error: { message: "boom" } } };
    const content =
      purpose === "opening"
        ? { detail_used: canned.opening?.detail_used ?? "bio", message: canned.opening?.message ?? "Vi que você fala de ortodontia nos seus vídeos. Como você decide o tema de cada um?" }
        : purpose === "classify"
          ? { intent: canned.classify?.intent ?? "asked_info", confidence: canned.classify?.confidence ?? 0.9, summary: canned.classify?.summary ?? "perguntou", objection: canned.classify?.objection ?? "" }
          : { action: canned.decide?.action ?? "reply", reply: canned.decide?.reply ?? "Eu ajudo profissionais a gravar vídeo com roteiro pronto. O primeiro roteiro é grátis.", follow_up_hours: canned.decide?.follow_up_hours ?? 0, pipeline_hint: canned.decide?.pipeline_hint ?? "none", reasoning: canned.decide?.reasoning ?? "teste" };
    return {
      status: 200,
      data: { choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 50, cost: canned.costPerCall ?? 0.001 }, model: body.model as string },
    };
  };
}

export type GraphCall = { url: string; body: unknown };

export function fakeGraph(calls: GraphCall[] = [], profile: { username: string } = { username: "dra.ana.sorriso" }, failWith?: { status: number; code: number }): InstagramGraphClient {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (failWith) return new Response(JSON.stringify({ error: { message: "refused", code: failWith.code } }), { status: failWith.status });
    if (url.includes("/me/messages")) return new Response(JSON.stringify({ message_id: `m_${calls.length}`, recipient_id: "123" }), { status: 200 });
    return new Response(JSON.stringify({ id: "123", username: profile.username, name: "Ana" }), { status: 200 });
  };
  return new InstagramGraphClient({ accessToken: "token", graphVersion: "v24.0", fetchImpl });
}

export const SAMPLE_PROFILES: FakeBrowserOptions["profiles"] = [
  {
    username: "dra.ana.sorriso",
    exists: true,
    isPrivate: false,
    fullName: "Dra. Ana Lima",
    bio: "Dentista · CRO-SP 12345 · Ortodontia e clareamento em Campinas. Dicas e vídeos toda semana. Agende pelo link.",
    category: "Dentista",
    followers: 4200,
    following: 500,
    posts: 180,
    isBusiness: true,
    externalUrl: "https://wa.me/5519999999999",
    location: "Campinas, SP",
    recentPostsSummary: "Reels sobre alinhadores e dúvidas de pacientes",
    lastPublicPostAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    keywords: ["dentista", "odontologia"],
  },
  {
    username: "estagiario.odonto",
    exists: true,
    isPrivate: false,
    fullName: "João",
    bio: "Estudante de odontologia · 4º período",
    followers: 300,
    posts: 10,
    isBusiness: false,
    externalUrl: null,
    location: null,
    recentPostsSummary: null,
    lastPublicPostAt: null,
    keywords: ["dentista"],
  },
];

export function buildContext(options: { db?: Db; env?: Partial<Env>; ai?: CannedAi; browser?: FakeBrowserOptions; graph?: InstagramGraphClient | null; aiCalls?: Array<{ purpose: string; body: Record<string, unknown> }>; now?: () => Date } = {}): { ctx: WorkerContext; db: Db; browser: FakeInstagramBrowser } {
  const db = options.db ?? openTestDatabase();
  const env = testEnv(options.env);
  const browser = new FakeInstagramBrowser({ profiles: SAMPLE_PROFILES, ...options.browser });
  const ai = new OpenRouterClient(db, { apiKey: "test", mainModel: env.OPENROUTER_MODEL, fastModel: env.OPENROUTER_MODEL_FAST, monthlyBudgetUsd: env.OPENROUTER_MONTHLY_BUDGET_USD, transport: fakeTransport(options.ai ?? {}, options.aiCalls) });
  const ctx = createContext({ db, env, config: TEST_CONFIG, ai, browser, graph: options.graph === undefined ? fakeGraph() : options.graph, now: options.now, random: () => 0.5, sleep: async () => undefined });
  return { ctx, db, browser };
}

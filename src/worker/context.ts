import { hostname } from "node:os";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { business, type BusinessConfig } from "@/lib/config";
import { env, instagramApiConfigured, type Env } from "@/lib/env";
import { logger, type Logger } from "@/lib/logger";
import { OpenRouterClient } from "@/integrations/openrouter/client";
import { ConversationEngine } from "@/features/conversations/engine";
import type { InstagramBrowser } from "@/integrations/browser/types";
import { RealInstagramBrowser } from "@/integrations/browser/cdp";
import { InstagramGraphClient } from "@/integrations/instagram/graph";
import { getSetting } from "@/db/queries/settings";

export type WorkerContext = {
  db: Db;
  config: BusinessConfig;
  env: Env;
  workerId: string;
  log: Logger;
  now(): Date;
  ai(): OpenRouterClient;
  engine(): ConversationEngine;
  browser(): InstagramBrowser;
  graph(): InstagramGraphClient | null;
  /** Real sends need both the .env flag and the panel switch. Either one off means dry-run. */
  sendEnabled(): boolean;
  random(): number;
  /** Short waits inside a job (spacing before typing). Tests replace it with a no-op. */
  sleep(ms: number): Promise<void>;
};

export type ContextOverrides = Partial<Pick<WorkerContext, "db" | "config" | "env" | "now" | "random" | "sleep">> & {
  ai?: OpenRouterClient;
  browser?: InstagramBrowser;
  graph?: InstagramGraphClient | null;
};

export function createContext(overrides: ContextOverrides = {}): WorkerContext {
  const db = overrides.db ?? getDb();
  const config = overrides.config ?? business();
  const e = overrides.env ?? env();
  let ai: OpenRouterClient | null = overrides.ai ?? null;
  let engine: ConversationEngine | null = null;
  let browser: InstagramBrowser | null = overrides.browser ?? null;
  const graph = overrides.graph !== undefined ? overrides.graph : instagramApiConfigured(e) ? new InstagramGraphClient({ accessToken: e.INSTAGRAM_PAGE_ACCESS_TOKEN!, graphVersion: e.META_GRAPH_VERSION }) : null;
  const ctx: WorkerContext = {
    db,
    config,
    env: e,
    workerId: `${hostname()}-${process.pid}`,
    log: logger("worker"),
    now: overrides.now ?? (() => new Date()),
    random: overrides.random ?? Math.random,
    sleep: overrides.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    ai: () => (ai ??= OpenRouterClient.fromEnv(db)),
    engine: () => (engine ??= new ConversationEngine(db, ctx.ai(), config)),
    browser: () => (browser ??= new RealInstagramBrowser({ cdpUrl: e.CHROME_CDP_URL })),
    graph: () => graph,
    sendEnabled: () => e.BROWSER_SEND_ENABLED && getSetting<boolean>(db, "browser.sendEnabled", false),
  };
  return ctx;
}

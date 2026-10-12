import { z } from "zod";

const boolFromString = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const operatingHours = z
  .string()
  .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "OPERATING_HOURS must look like 09:00-20:00");

const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().min(1).default("deepseek/deepseek-v4-pro-0813"),
  OPENROUTER_MODEL_FAST: z.string().min(1).default("deepseek/deepseek-v4.1-flash"),
  OPENROUTER_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(20),

  CHROME_CDP_URL: z.string().url().default("http://127.0.0.1:9222"),
  CHROME_PROFILE_DIR: z.string().default("./.chrome-profile"),
  BROWSER_SEND_ENABLED: boolFromString.default(false),

  INSTAGRAM_APP_SECRET: z.string().optional(),
  INSTAGRAM_PAGE_ACCESS_TOKEN: z.string().optional(),
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.\d+$/).default("v26.0"),
  /** graph.instagram.com for tokens from "Instagram Login"; graph.facebook.com for Page tokens from Facebook Login. */
  META_GRAPH_BASE: z.string().url().default("https://graph.instagram.com"),

  /** Cloudflare inbox Worker (relay/): stable public webhook URL; the worker pulls events from it. */
  RELAY_URL: z.string().url().optional(),
  RELAY_TOKEN: z.string().optional(),

  DATABASE_URL: z.string().default("./data/prospector.db"),
  BACKUP_DIR: z.string().default("./backups"),

  MAX_DMS_PER_DAY: z.coerce.number().int().min(1).max(200).default(30),
  MIN_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(10).default(90),
  MAX_SECONDS_BETWEEN_DMS: z.coerce.number().int().min(10).default(240),
  OPERATING_HOURS: operatingHours.default("09:00-20:00"),
  OPERATING_TIMEZONE: z.string().default("America/Sao_Paulo"),
  WARMUP_START_PER_DAY: z.coerce.number().int().min(1).default(5),
  WARMUP_STEP_PER_WEEK: z.coerce.number().int().min(0).default(5),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Validated process environment. Fails loudly on the first read if a value is malformed. */
export function env(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  if (parsed.data.MIN_SECONDS_BETWEEN_DMS > parsed.data.MAX_SECONDS_BETWEEN_DMS) {
    throw new Error("Invalid environment: MIN_SECONDS_BETWEEN_DMS is greater than MAX_SECONDS_BETWEEN_DMS");
  }
  cached = parsed.data;
  return cached;
}

/** Test helper: forget the cached environment so the next read re-parses process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function instagramApiConfigured(e: Env = env()): boolean {
  return Boolean(
    e.INSTAGRAM_APP_SECRET &&
      e.INSTAGRAM_PAGE_ACCESS_TOKEN &&
      e.INSTAGRAM_WEBHOOK_VERIFY_TOKEN &&
      e.INSTAGRAM_BUSINESS_ACCOUNT_ID,
  );
}

export function aiConfigured(e: Env = env()): boolean {
  return Boolean(e.OPENROUTER_API_KEY);
}

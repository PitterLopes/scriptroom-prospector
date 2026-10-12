import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const businessSchema = z.object({
  owner: z.object({ name: z.string().min(1), role: z.string().min(1) }),
  company: z.object({
    name: z.string().min(1),
    website: z.string().url(),
    instagramHandle: z.string().min(2),
  }),
  links: z.object({
    appStore: z.string().url().nullable(),
    whatsapp: z.string().url().nullable(),
    affiliateGroup: z.string().url().nullable(),
  }),
  offer: z.object({
    oneLinePitch: z.string().min(10),
    howItWorks: z.array(z.string().min(1)).min(1),
    revenueModel: z.string().min(1),
    /** Honest first-person context for the first DM: who is writing, why, and what a reply (even a "no") does for them. */
    founderStory: z.string().min(20),
    /** What the person gets without paying, said in the words the reply should use ("o primeiro roteiro é grátis, sem cartão"). */
    trialNote: z.string().default("o teste é grátis"),
    /** How the product sits next to agencies and freelancers; used when a lead says someone else makes their videos. */
    positioning: z.array(z.string().min(1)).default([]),
    marketJargon: z.record(z.string(), z.string()),
  }),
  claims: z.object({
    verified: z.array(z.string().min(1)).min(1),
    unverified: z.array(z.string()),
    forbiddenTopics: z.array(z.string()),
  }),
  icp: z.object({
    segments: z.array(z.string().min(1)).min(1),
    keywords: z.array(z.string().min(1)).min(1),
    hashtags: z.array(z.string().min(1)),
    geography: z.string().min(1),
    language: z.string().min(2),
    followerRange: z.object({ min: z.number().int().min(0), max: z.number().int().min(1) }),
    exclude: z.array(z.string()),
  }),
  affiliates: z.object({ enabled: z.boolean(), topics: z.array(z.string()) }),
});

export type BusinessConfig = z.infer<typeof businessSchema>;

const CONFIG_PATH = path.resolve(process.cwd(), "config/business.json");

let cached: BusinessConfig | null = null;

/** The only place real business data lives. Everything else reads from here. */
export function business(): BusinessConfig {
  if (cached) return cached;
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      `config/business.json not found. Copy config/business.example.json and fill it in.`,
    );
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as unknown;
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid config/business.json: ${issues}`);
  }
  if (containsPlaceholder(JSON.stringify(raw))) {
    throw new Error("config/business.json still contains {{PLACEHOLDERS}}");
  }
  cached = parsed.data;
  return cached;
}

export function containsPlaceholder(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}

export function parseBusiness(raw: unknown): BusinessConfig {
  return businessSchema.parse(raw);
}

export function resetBusinessCache(): void {
  cached = null;
}

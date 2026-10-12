import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { FailureArtifacts, InstagramBrowser, ProfileCandidate, PublicProfile, SendOptions, SendOutcome } from "./types";
import { BrowserUnavailableError, InstagramRestrictionError } from "./types";
import { typingPlan } from "@/features/campaigns/limits";
import { logger } from "@/lib/logger";
import { normalizeUsername } from "@/features/leads/dedupe";

const log = logger("browser");
const INSTAGRAM_HOST = /(^|\.)instagram\.com$/;
const RESTRICTION_TEXT = /(try again later|tente novamente mais tarde|we restrict certain activity|restringimos certas atividades|suspicious|suspeita|confirm it's you|confirme que é você|challenge)/i;
const LOGIN_TEXT = /(log in|entrar|phone number, username, or email|telefone, nome de usuário ou email)/i;

/** Probe the CDP endpoint without Playwright. Cheap, and testable against a tiny fake HTTP server. */
export async function probeCdp(cdpUrl: string, timeoutMs = 3000): Promise<{ ok: true; browser: string } | { ok: false; error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL("/json/version", cdpUrl);
    if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
      return { ok: false, error: `CHROME_CDP_URL must point to 127.0.0.1, not ${url.hostname}` };
    }
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: `CDP endpoint answered ${res.status}` };
    const data = (await res.json()) as { Browser?: string };
    return { ok: true, browser: data.Browser ?? "unknown" };
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

export type RealBrowserOptions = { cdpUrl: string; artifactsDir?: string };

/**
 * Drives Instagram inside the operator's own Chrome (already logged in) through the DevTools protocol.
 * Rules: reuse the logged-in context, own tab per job, never bringToFront, never leave instagram.com,
 * close the tab in `finally`, and never open a new Chrome when the endpoint is down.
 */
export class RealInstagramBrowser implements InstagramBrowser {
  readonly kind = "real" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  constructor(private readonly options: RealBrowserOptions) {}

  async connect(): Promise<void> {
    if (this.browser?.isConnected()) return;
    const probe = await probeCdp(this.options.cdpUrl);
    if (!probe.ok) throw new BrowserUnavailableError(`browser_unavailable: ${probe.error}`);
    try {
      this.browser = await chromium.connectOverCDP(this.options.cdpUrl, { timeout: 10_000 });
    } catch (error: unknown) {
      throw new BrowserUnavailableError(`browser_unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    const contexts = this.browser.contexts();
    const context = contexts[0];
    if (!context) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
      throw new BrowserUnavailableError("browser_unavailable: Chrome has no open context (open a window in the dedicated profile)");
    }
    this.context = context;
    log.info("connected to Chrome over CDP", { browser: probe.browser });
  }

  async close(): Promise<void> {
    // Disconnect only; closing would quit the operator's Chrome.
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
  }

  async isLoggedIn(): Promise<boolean> {
    return this.withPage("login-check", async (page) => {
      await this.goto(page, "https://www.instagram.com/");
      const body = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
      const hasLoginForm = (await page.locator('input[name="username"]').count()) > 0;
      return !hasLoginForm && !LOGIN_TEXT.test(body.slice(0, 400));
    });
  }

  async searchProfiles(query: string, limit: number, jobId: string): Promise<ProfileCandidate[]> {
    return this.withPage(jobId, async (page) => {
      const term = query.replace(/^#/, "");
      await this.goto(page, `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(term)}`);
      await page.waitForTimeout(2500);
      await this.assertNotRestricted(page);
      const hrefs = await page.locator('a[href^="/"]').evaluateAll((anchors) => anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
      const seen = new Set<string>();
      const out: ProfileCandidate[] = [];
      for (const href of hrefs) {
        const match = /^\/([a-z0-9._]{1,30})\/?$/i.exec(href);
        if (!match) continue;
        const username = match[1]!.toLowerCase();
        if (["explore", "reels", "direct", "accounts", "p", "stories", "about", "legal"].includes(username)) continue;
        if (seen.has(username)) continue;
        seen.add(username);
        out.push({ username, sourceDetail: query });
        if (out.length >= limit) break;
      }
      return out;
    });
  }

  async readProfile(username: string, jobId: string): Promise<PublicProfile> {
    const handle = normalizeUsername(username);
    return this.withPage(jobId, async (page) => {
      const response = await this.goto(page, `https://www.instagram.com/${handle}/`);
      await page.waitForTimeout(1500);
      await this.assertNotRestricted(page);
      if (response && response.status() === 404) return { username: handle, exists: false, isPrivate: false };
      const bodyText = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
      if (/página não está disponível|page isn't available|sorry, this page/i.test(bodyText.slice(0, 600))) {
        return { username: handle, exists: false, isPrivate: false };
      }
      const description = (await page.locator('meta[property="og:description"]').getAttribute("content").catch(() => null)) ?? "";
      const title = (await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => null)) ?? "";
      const counts = parseOgCounts(description);
      const headerText = await page.locator("header").first().innerText({ timeout: 5000 }).catch(() => "");
      const isPrivate = /esta conta é privada|this account is private/i.test(bodyText);
      const external = await page.locator('header a[href^="http"]:not([href*="instagram.com"])').first().getAttribute("href").catch(() => null);
      const fullName = parseOgName(title) ?? null;
      const headerLines = headerText.split("\n").map((l) => l.trim()).filter(Boolean);
      const bio = extractBio(headerLines, handle, fullName);
      const category = headerLines.find((l) => /^(dentista|advogad|cl[íi]nica|m[ée]dic|nutri|psic|personal|est[ée]tica|corretor|contador|consultor|servi[çc]o|sa[úu]de|educa|empres)/i.test(l) && l.length < 60) ?? null;
      return {
        username: handle,
        exists: true,
        isPrivate,
        fullName,
        bio,
        category,
        followers: counts.followers,
        following: counts.following,
        posts: counts.posts,
        isBusiness: Boolean(category),
        externalUrl: external,
        location: null,
        recentPostsSummary: null,
        lastPublicPostAt: null,
      };
    });
  }

  async sendDirectMessage(username: string, text: string, options: SendOptions): Promise<SendOutcome> {
    const handle = normalizeUsername(username);
    return this.withPage(options.jobId, async (page, artifacts) => {
      try {
        await this.goto(page, `https://www.instagram.com/${handle}/`);
        await page.waitForTimeout(1500);
        await this.assertNotRestricted(page);
        const messageButton = page.getByRole("button", { name: /^(message|enviar mensagem|mensagem)$/i }).first();
        const messageLink = page.getByRole("link", { name: /^(message|enviar mensagem|mensagem)$/i }).first();
        if ((await messageButton.count()) > 0) await messageButton.click();
        else if ((await messageLink.count()) > 0) await messageLink.click();
        else return { status: "failed", error: "message button not found", artifacts: await this.captureFailure(page, artifacts) };
        await page.waitForURL(/instagram\.com\/direct\//, { timeout: 15_000 });
        await page.waitForTimeout(1500);
        await this.assertNotRestricted(page);
        const notNow = page.getByRole("button", { name: /^(not now|agora não)$/i }).first();
        if ((await notNow.count()) > 0) await notNow.click().catch(() => undefined);
        const box = page.getByRole("textbox", { name: /message|mensagem/i }).first();
        await box.waitFor({ state: "visible", timeout: 15_000 });
        await box.click();
        const plan = typingPlan(text, options.random);
        for (let i = 0; i < text.length; i += 1) {
          await page.keyboard.type(text[i]!, { delay: 0 });
          await page.waitForTimeout(plan.perCharMs[i] ?? 60);
        }
        await page.waitForTimeout(plan.pauseBeforeSendMs);
        const typed = (await box.innerText().catch(() => "")).trim();
        if (typed.replace(/\s+/g, " ") !== text.replace(/\s+/g, " ")) {
          await this.clearBox(page);
          return { status: "failed", error: "typed text does not match the planned message", artifacts: await this.captureFailure(page, artifacts) };
        }
        if (options.dryRun) {
          await this.clearBox(page);
          log.info("dry-run: message typed and cleared, not sent", { username: handle, chars: text.length });
          return { status: "dry_run", typedChars: text.length };
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(2500);
        await this.assertNotRestricted(page);
        const thread = await page.locator('div[role="main"], main').first().innerText({ timeout: 5000 }).catch(() => "");
        const confirmed = thread.replace(/\s+/g, " ").includes(text.slice(0, 40).replace(/\s+/g, " "));
        if (!confirmed) return { status: "failed", error: "message not visible in thread after sending", artifacts: await this.captureFailure(page, artifacts) };
        return { status: "sent", sentAt: new Date().toISOString() };
      } catch (error: unknown) {
        if (error instanceof InstagramRestrictionError) throw error;
        return { status: "failed", error: error instanceof Error ? error.message : String(error), artifacts: await this.captureFailure(page, artifacts) };
      }
    });
  }

  private async clearBox(page: Page): Promise<void> {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
    await page.keyboard.press("Backspace");
  }

  private async goto(page: Page, url: string) {
    const host = new URL(url).hostname;
    if (!INSTAGRAM_HOST.test(host)) throw new Error(`Navigation outside instagram.com refused: ${url}`);
    return page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  private async assertNotRestricted(page: Page): Promise<void> {
    const url = page.url();
    if (/\/challenge\//.test(url) || /\/accounts\/login/.test(url)) {
      throw new InstagramRestrictionError("Instagram asked for login or a challenge", url);
    }
    const dialog = await page.locator('div[role="dialog"]').first().innerText({ timeout: 500 }).catch(() => "");
    if (RESTRICTION_TEXT.test(dialog)) throw new InstagramRestrictionError("Instagram showed a restriction dialog", dialog.slice(0, 300));
  }

  private async withPage<T>(jobId: string, fn: (page: Page, artifacts: { consoleErrors: string[]; failedRequests: string[]; jobId: string }) => Promise<T>): Promise<T> {
    if (!this.context) await this.connect();
    const context = this.context!;
    const page = await context.newPage();
    const artifacts = { consoleErrors: [] as string[], failedRequests: [] as string[], jobId };
    page.on("console", (msg) => {
      if (msg.type() === "error") artifacts.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on("requestfailed", (req) => artifacts.failedRequests.push(`${req.method()} ${req.url().slice(0, 200)}`));
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      const host = new URL(frame.url()).hostname;
      if (frame.url() !== "about:blank" && !INSTAGRAM_HOST.test(host)) {
        log.warn("tab left instagram.com; closing it", { url: frame.url() });
        void page.close().catch(() => undefined);
      }
    });
    try {
      return await fn(page, artifacts);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async captureFailure(page: Page, base: { consoleErrors: string[]; failedRequests: string[]; jobId: string }): Promise<FailureArtifacts> {
    const dir = path.resolve(process.cwd(), this.options.artifactsDir ?? ".");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(dir, "screenshots", `${base.jobId}-${stamp}.png`);
    const snapshotPath = path.join(dir, "traces", `${base.jobId}-${stamp}.txt`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 }).catch(() => "");
    fs.writeFileSync(snapshotPath, [`url: ${page.url()}`, "", snapshot, "", "console errors:", ...base.consoleErrors, "", "failed requests:", ...base.failedRequests].join("\n"));
    return { screenshotPath, snapshotPath, url: page.url(), consoleErrors: base.consoleErrors, failedRequests: base.failedRequests, jobId: base.jobId };
  }
}

export function parseOgCounts(description: string): { followers: number | null; following: number | null; posts: number | null } {
  const grab = (label: RegExp) => {
    const match = description.match(label);
    return match ? parseCompactNumber(match[1]!) : null;
  };
  return {
    followers: grab(/([\d.,]+\s?[KkMm]?)\s+(?:followers|seguidores)/i),
    following: grab(/([\d.,]+\s?[KkMm]?)\s+(?:following|seguindo)/i),
    posts: grab(/([\d.,]+\s?[KkMm]?)\s+(?:posts|publicações)/i),
  };
}

export function parseCompactNumber(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(/\s/g, "");
  const match = /^([\d.,]+)([km])?$/.exec(text);
  if (!match) return null;
  let digits = match[1]!;
  const suffix = match[2];
  if (suffix) digits = digits.replace(",", ".");
  else digits = digits.replace(/[.,]/g, "");
  const value = Number(digits);
  if (Number.isNaN(value)) return null;
  if (suffix === "k") return Math.round(value * 1000);
  if (suffix === "m") return Math.round(value * 1_000_000);
  return value;
}

export function parseOgName(title: string): string | null {
  const match = /^(.*?)\s*\(@/.exec(title);
  const name = match?.[1]?.trim();
  return name ? name : null;
}

/** The header text has name, handle, counts and buttons; the bio is what is left. */
export function extractBio(lines: string[], handle: string, fullName: string | null): string | null {
  const noise = /^(seguir|follow|mensagem|message|enviar mensagem|seguindo|following|\d[\d.,]*\s?[kKmM]?\s*(publicações|posts|seguidores|followers|seguindo|following)|publicações|posts|seguidores|followers|ver tradução|see translation)$/i;
  const kept = lines.filter((l) => l.toLowerCase() !== handle && l !== fullName && !noise.test(l) && !/^@/.test(l) && l.length <= 200);
  const bio = kept.join("\n").trim();
  return bio.length > 0 ? bio : null;
}

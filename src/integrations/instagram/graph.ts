import { logger } from "@/lib/logger";

const log = logger("instagram-api");

export type GraphConfig = {
  accessToken: string;
  graphVersion: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export type GraphUserProfile = { id: string; username: string | null; name: string | null; followerCount: number | null };

export class GraphApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: number | null, readonly subcode: number | null) {
    super(message);
    this.name = "GraphApiError";
  }
  /** Meta reports the 24-hour window and policy blocks with these codes. */
  get isWindowOrPolicyError(): boolean {
    return this.code === 10 || this.code === 551 || (this.code === 100 && this.subcode === 2534022);
  }
}

/** Thin client over the Instagram Messaging endpoints. `/me` resolves to the Page (or IG user) that owns the token. */
export class InstagramGraphClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: GraphConfig) {
    this.base = `${config.baseUrl ?? "https://graph.facebook.com"}/${config.graphVersion}`;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async sendText(recipientId: string, text: string): Promise<{ messageId: string }> {
    const body = { recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text } };
    const data = await this.request<{ message_id?: string; recipient_id?: string }>("POST", "/me/messages", body);
    return { messageId: data.message_id ?? "" };
  }

  async getUserProfile(igsid: string): Promise<GraphUserProfile> {
    const data = await this.request<{ id?: string; username?: string; name?: string; follower_count?: number }>(
      "GET",
      `/${igsid}?fields=id,username,name,follower_count`,
    );
    return { id: data.id ?? igsid, username: data.username ?? null, name: data.name ?? null, followerCount: data.follower_count ?? null };
  }

  /** Confirms the token is alive and tells which account owns it. */
  async whoAmI(): Promise<{ id: string; name: string | null }> {
    const data = await this.request<{ id?: string; name?: string; username?: string }>("GET", "/me?fields=id,name,username");
    return { id: data.id ?? "", name: data.name ?? data.username ?? null };
  }

  private async request<T>(method: "GET" | "POST", pathWithQuery: string, body?: unknown): Promise<T> {
    const separator = pathWithQuery.includes("?") ? "&" : "?";
    const url = `${this.base}${pathWithQuery}${separator}access_token=${encodeURIComponent(this.config.accessToken)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
      if (!res.ok || data.error) {
        const err = data.error ?? {};
        log.warn("graph api error", { status: res.status, code: err.code ?? null, subcode: err.error_subcode ?? null, path: pathWithQuery.split("?")[0] });
        throw new GraphApiError(err.message ?? `Graph API ${res.status}`, res.status, err.code ?? null, err.error_subcode ?? null);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const API_WINDOW_HOURS = 24;

export function apiWindowExpiry(lastInboundIso: string): string {
  return new Date(new Date(lastInboundIso).getTime() + API_WINDOW_HOURS * 3600 * 1000).toISOString();
}

export function apiWindowOpen(expiresAtIso: string | null, now: Date = new Date()): boolean {
  return Boolean(expiresAtIso && new Date(expiresAtIso).getTime() > now.getTime());
}

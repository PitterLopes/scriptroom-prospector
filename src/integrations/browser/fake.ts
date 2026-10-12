import type { InstagramBrowser, ProfileCandidate, PublicProfile, SendOptions, SendOutcome } from "./types";
import { InstagramRestrictionError, BrowserUnavailableError } from "./types";

export type FakeProfile = PublicProfile & { keywords?: string[] };

export type FakeBrowserOptions = {
  profiles?: FakeProfile[];
  loggedIn?: boolean;
  unavailable?: boolean;
  restrictedAfterSends?: number;
  failSendFor?: string[];
};

/** In-memory Instagram used by tests and by the simulation mode. Records every DM it "sends". */
export class FakeInstagramBrowser implements InstagramBrowser {
  readonly kind = "fake" as const;
  readonly sent: Array<{ username: string; text: string; dryRun: boolean; jobId: string }> = [];
  connected = false;
  private readonly profiles = new Map<string, FakeProfile>();

  constructor(private readonly options: FakeBrowserOptions = {}) {
    for (const p of options.profiles ?? []) this.profiles.set(p.username.toLowerCase(), p);
  }

  async connect(): Promise<void> {
    if (this.options.unavailable) throw new BrowserUnavailableError("fake CDP endpoint is down");
    this.connected = true;
  }

  async close(): Promise<void> {
    this.connected = false;
  }

  async isLoggedIn(): Promise<boolean> {
    return this.options.loggedIn ?? true;
  }

  async searchProfiles(query: string, limit: number, _jobId: string): Promise<ProfileCandidate[]> {
    const q = query.toLowerCase().replace(/^#/, "");
    const out: ProfileCandidate[] = [];
    for (const p of this.profiles.values()) {
      const text = `${p.username} ${p.fullName ?? ""} ${p.bio ?? ""} ${(p.keywords ?? []).join(" ")}`.toLowerCase();
      if (text.includes(q)) out.push({ username: p.username, fullName: p.fullName ?? null, sourceDetail: query });
      if (out.length >= limit) break;
    }
    return out;
  }

  async readProfile(username: string, _jobId: string): Promise<PublicProfile> {
    const p = this.profiles.get(username.toLowerCase());
    if (!p) return { username, exists: false, isPrivate: false };
    return p;
  }

  async sendDirectMessage(username: string, text: string, options: SendOptions): Promise<SendOutcome> {
    if (!this.connected) throw new BrowserUnavailableError("fake browser not connected");
    const realSends = this.sent.filter((s) => !s.dryRun).length;
    if (this.options.restrictedAfterSends !== undefined && !options.dryRun && realSends >= this.options.restrictedAfterSends) {
      throw new InstagramRestrictionError("Try again later", "fake restriction");
    }
    if (this.options.failSendFor?.includes(username)) {
      return { status: "failed", error: "message button not found", artifacts: { consoleErrors: [], failedRequests: [], jobId: options.jobId } };
    }
    this.sent.push({ username, text, dryRun: options.dryRun, jobId: options.jobId });
    if (options.dryRun) return { status: "dry_run", typedChars: text.length };
    return { status: "sent", sentAt: new Date().toISOString() };
  }
}

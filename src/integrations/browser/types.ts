import type { DiscoveredProfile } from "@/db/queries/leads";

export type ProfileCandidate = { username: string; fullName?: string | null; sourceDetail: string };

export type PublicProfile = Omit<DiscoveredProfile, "source" | "sourceDetail"> & { username: string; exists: boolean; isPrivate: boolean };

export type SendOutcome =
  | { status: "sent"; sentAt: string }
  | { status: "dry_run"; typedChars: number }
  | { status: "failed"; error: string; artifacts?: FailureArtifacts };

export type FailureArtifacts = {
  screenshotPath?: string;
  snapshotPath?: string;
  url?: string;
  consoleErrors: string[];
  failedRequests: string[];
  jobId: string;
};

export type SendOptions = { dryRun: boolean; jobId: string; random?: () => number };

/**
 * Everything the worker needs from Instagram's web interface. Two implementations:
 * the real one over the operator's Chrome (CDP) and a fake one for tests and simulations.
 */
export interface InstagramBrowser {
  readonly kind: "real" | "fake";
  connect(): Promise<void>;
  close(): Promise<void>;
  isLoggedIn(): Promise<boolean>;
  searchProfiles(query: string, limit: number, jobId: string): Promise<ProfileCandidate[]>;
  readProfile(username: string, jobId: string): Promise<PublicProfile>;
  sendDirectMessage(username: string, text: string, options: SendOptions): Promise<SendOutcome>;
}

/** Instagram showed a restriction, a challenge or logged the operator out. The worker pauses on it. */
export class InstagramRestrictionError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "InstagramRestrictionError";
  }
}

/** CDP endpoint unreachable. The worker never opens its own Chrome; it pauses the browser queue instead. */
export class BrowserUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserUnavailableError";
  }
}

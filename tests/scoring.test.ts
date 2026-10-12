import { describe, expect, it } from "vitest";
import { normalizeUsername } from "@/features/leads/dedupe";
import { guessRole, scoreProfile } from "@/features/leads/scoring";
import { TEST_CONFIG, SAMPLE_PROFILES } from "./helpers";

describe("normalizeUsername", () => {
  it("strips @, URL and case", () => {
    expect(normalizeUsername("@Dra.Ana_Sorriso")).toBe("dra.ana_sorriso");
    expect(normalizeUsername("https://www.instagram.com/lopespitter/?hl=pt")).toBe("lopespitter");
  });
  it("rejects garbage", () => {
    expect(() => normalizeUsername("not a handle!")).toThrow();
  });
});

describe("scoreProfile", () => {
  it("qualifies a dentist with council number and content", () => {
    const score = scoreProfile(SAMPLE_PROFILES![0]!, TEST_CONFIG);
    expect(score.qualified).toBe(true);
    expect(score.roleGuess).toBe("owner");
    expect(score.reasons.some((r) => r.includes("reel"))).toBe(true);
    expect(score.score).toBeGreaterThanOrEqual(50);
  });
  it("never qualifies a profile without a readable post, however good the bio", () => {
    const score = scoreProfile({ ...SAMPLE_PROFILES![0]!, recentPosts: [] }, TEST_CONFIG);
    expect(score.qualified).toBe(false);
    expect(score.reasons).toContain("no public post could be read");
  });
  it("rejects a student", () => {
    const score = scoreProfile(SAMPLE_PROFILES![1]!, TEST_CONFIG);
    expect(score.qualified).toBe(false);
    expect(score.roleGuess).toBe("employee");
  });
  it("penalises accounts out of the follower range and stale accounts", () => {
    const stale = scoreProfile({ username: "x", bio: "Dentista CRO 1", followers: 500_000, lastPublicPostAt: new Date(Date.now() - 120 * 86_400_000).toISOString() }, TEST_CONFIG);
    expect(stale.reasons).toContain("followers out of range (500000)");
    expect(stale.reasons).toContain("no public post in 60 days");
    expect(stale.qualified).toBe(false);
  });
  it("guesses roles from bio patterns", () => {
    expect(guessRole("Fundadora da clínica", "")).toBe("decision_maker");
    expect(guessRole("Clínica odontológica com 3 unidades", "")).toBe("store");
    expect(guessRole("Recepcionista na clínica X", "")).toBe("employee");
  });
});

import { describe, expect, it } from "vitest";
import { checkClaims } from "@/features/conversations/claims-guard";
import { looksLikeOptOut } from "@/features/conversations/engine";
import { TEST_CONFIG } from "./helpers";

describe("claims guard", () => {
  it("accepts a plain, honest message with a verified price and the store link", () => {
    const text = `O plano de 15 roteiros custa R$ 44,90 por mês e o primeiro roteiro é grátis: ${TEST_CONFIG.links.appStore}`;
    expect(checkClaims(text, TEST_CONFIG)).toEqual({ ok: true });
  });
  it("blocks superlatives, guarantees and reach promises", () => {
    const result = checkClaims("É o melhor app do mercado, garantido que você vai ter mais seguidores.", TEST_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContain("superlative");
      expect(result.violations).toContain("guarantee");
      expect(result.violations).toContain("reach_or_result_promise");
    }
  });
  it("blocks prices, percentages and social proof that are not verified", () => {
    const result = checkClaims("Por R$ 19,90 você tem 90% de economia, como 5000 dentistas já têm.", TEST_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.startsWith("price_not_verified"))).toBe(true);
      expect(result.violations.some((v) => v.startsWith("percentage_not_verified"))).toBe(true);
      expect(result.violations).toContain("unverified_social_proof");
    }
  });
  it("blocks forbidden topics, competitors, credentials and foreign links", () => {
    const result = checkClaims("Tem para Android também, melhor que o CapCut; me passa seu CPF e acessa https://evil.example", TEST_CONFIG);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toContain("forbidden_topic");
      expect(result.violations).toContain("mentions_competitor");
      expect(result.violations).toContain("asks_for_credentials_or_payment");
      expect(result.violations.some((v) => v.startsWith("link_not_allowed"))).toBe(true);
    }
  });
});

describe("opt-out detection in code", () => {
  it("catches the obvious phrasings", () => {
    expect(looksLikeOptOut("Para de me mandar mensagem")).toBe(true);
    expect(looksLikeOptOut("não quero receber isso")).toBe(true);
    expect(looksLikeOptOut("Que legal, me conta mais")).toBe(false);
  });
});

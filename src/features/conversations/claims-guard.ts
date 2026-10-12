import type { BusinessConfig } from "@/lib/config";

export type GuardResult = { ok: true } | { ok: false; violations: string[] };

const SUPERLATIVES = /\b(o melhor|a melhor|melhor (app|aplicativo|ferramenta|do mercado)|(o|a) primeir[oa] (app|aplicativo|ferramenta|do mercado|a (fazer|oferecer|criar))|(o|a) [úu]nic[oa] (app|aplicativo|ferramenta|solu[çc][ãa]o|op[çc][ãa]o)|l[íi]der de mercado|n[ºo°]\s?1|number one|revolucion[áa]ri[oa]|incr[íi]vel)\b/i;
const GUARANTEES = /\b(garant\w*|garantid[oa]|certeza de resultado|com certeza vai|vai (dobrar|triplicar|viralizar|bombar)|resultado garantido)\b/i;
const REACH_PROMISES = /\b(mais seguidores|aumentar? (o )?alcance|aumentar? (o )?engajamento|viraliz\w*|\d+\s?x (de|o|mais) alcance|explodir)\b/i;
const FORBIDDEN_WORDS = /\b(android|desconto|cupom|promo[çc][ãa]o|gr[áa]tis para sempre|aprovado pel[oa] (cfm|cfo|oab|crn|crp|conselho)|recomendado pel[oa] conselho)\b/i;
const CREDENTIAL_ASKS = /\b(senha|cart[ãa]o de cr[ée]dito|cpf|n[úu]mero do cart[ãa]o|pix para|transfer[êe]ncia)\b/i;
const FAKE_SOCIAL_PROOF = /\b(\d{2,}\s?(mil|k)?\s?(usu[áa]rios|clientes|profissionais|dentistas|advogados|v[íi]deos gerados)|milhares de (usu[áa]rios|clientes|profissionais))\b/i;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Prices the message may quote: the ones written in the verified claims. Any other price is a violation. */
function allowedPrices(config: BusinessConfig): Set<string> {
  const set = new Set<string>();
  for (const claim of config.claims.verified) {
    for (const match of claim.matchAll(/R\$\s?\d+(?:[.,]\d{2})?/g)) set.add(normalize(match[0]).replace(/\s/g, ""));
  }
  return set;
}

/**
 * Code-level check on every outbound text. It does not try to understand the message; it catches the
 * specific classes of lies the prompt forbids: superlatives, guarantees, reach promises, prices and
 * numbers that are not in the verified claims, forbidden topics, and asking for credentials.
 */
export function checkClaims(text: string, config: BusinessConfig): GuardResult {
  const violations: string[] = [];
  if (SUPERLATIVES.test(text)) violations.push("superlative");
  if (GUARANTEES.test(text)) violations.push("guarantee");
  if (REACH_PROMISES.test(text)) violations.push("reach_or_result_promise");
  if (FORBIDDEN_WORDS.test(text)) violations.push("forbidden_topic");
  if (CREDENTIAL_ASKS.test(text)) violations.push("asks_for_credentials_or_payment");
  if (FAKE_SOCIAL_PROOF.test(text)) violations.push("unverified_social_proof");

  const prices = allowedPrices(config);
  for (const match of text.matchAll(/R\$\s?\d+(?:[.,]\d{2})?/g)) {
    if (!prices.has(normalize(match[0]).replace(/\s/g, ""))) violations.push(`price_not_verified:${match[0]}`);
  }
  for (const match of text.matchAll(/\b\d{1,3}\s?%/g)) {
    const inVerified = config.claims.verified.some((c) => normalize(c).includes(normalize(match[0]).replace(/\s/g, "")));
    if (!inVerified) violations.push(`percentage_not_verified:${match[0]}`);
  }
  for (const topic of config.claims.forbiddenTopics) {
    const key = normalize(topic).replace(/\.$/, "");
    if (key.startsWith("nomes de concorrentes") && /\b(capcut|canva|chatgpt|notion|jasper|copy\.?ai|inshot|vidnoz|heygen)\b/i.test(text)) {
      violations.push("mentions_competitor");
    }
  }
  if (text.length > 900) violations.push("too_long");
  if (/https?:\/\//i.test(text)) {
    const allowedLinks = [config.company.website, config.links.appStore, config.links.whatsapp, config.links.affiliateGroup].filter((l): l is string => Boolean(l));
    for (const match of text.matchAll(/https?:\/\/\S+/gi)) {
      const url = match[0].replace(/[).,]+$/, "");
      if (!allowedLinks.some((l) => url.startsWith(l))) violations.push(`link_not_allowed:${url}`);
    }
  }
  return violations.length === 0 ? { ok: true } : { ok: false, violations: [...new Set(violations)] };
}

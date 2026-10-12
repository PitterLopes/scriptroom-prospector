import type { BusinessConfig } from "@/lib/config";

export type ProfileSignals = {
  username: string;
  fullName?: string | null;
  bio?: string | null;
  category?: string | null;
  followers?: number | null;
  posts?: number | null;
  isBusiness?: boolean | null;
  externalUrl?: string | null;
  location?: string | null;
  recentPostsSummary?: string | null;
  lastPublicPostAt?: string | null;
};

export type RoleGuess = "owner" | "employee" | "store" | "decision_maker" | "unknown";

export type IcpScore = {
  score: number;
  reasons: string[];
  segment: string | null;
  roleGuess: RoleGuess;
  priority: number;
  qualified: boolean;
};

const COUNCIL_PATTERNS: Array<{ pattern: RegExp; segmentHint: string }> = [
  { pattern: /\bcro[\s-]?\d|\bcro\b/i, segmentHint: "dentista" },
  { pattern: /\boab\b/i, segmentHint: "advogad" },
  { pattern: /\bcrn[\s-]?\d|\bcrn\b/i, segmentHint: "nutricionista" },
  { pattern: /\bcrp[\s-]?\d|\bcrp\b/i, segmentHint: "psic" },
  { pattern: /\bcref\b/i, segmentHint: "personal" },
  { pattern: /\bcreci\b/i, segmentHint: "corretor" },
  { pattern: /\bcrc\b/i, segmentHint: "contador" },
  { pattern: /\bcrm[\s-]?\d|\bcrm\b/i, segmentHint: "médic" },
  { pattern: /\bcrbm\b/i, segmentHint: "estética" },
];

const STORE_PATTERNS = /\b(cl[ií]nica|escrit[óo]rio|consult[óo]rio|est[úu]dio|studio|academia|franquia|unidades?|equipe|time de|loja)\b/i;
const EMPLOYEE_PATTERNS = /\b(estagi[áa]ri[oa]|estudante|acad[êe]mic[oa]|residente|recepcionista|assistente|secret[áa]ri[oa]|aluno|aluna)\b/i;
const TITLE_PATTERNS = /\b(dr\.?|dra\.?|doutor|doutora|especialista|fundador|fundadora|ceo|s[óo]cio|s[óo]cia|propriet[áa]ri[oa])\b/i;
const CONTENT_PATTERNS = /\b(reels?|v[íi]deos?|conte[úu]do|dicas?|youtube|tiktok|podcast)\b/i;
const CTA_PATTERNS = /\b(agende|agendamento|whatsapp|wa\.me|link na bio|atendimento|consulta|or[çc]amento)\b/i;
const BRAZIL_PATTERNS = /\b(brasil|brazil|sp|rj|mg|rs|pr|sc|ba|pe|ce|go|df|es|s[ãa]o paulo|rio de janeiro|belo horizonte|curitiba|porto alegre|salvador|recife|fortaleza|bras[íi]lia|florian[óo]polis|goi[âa]nia|campinas|manaus|bel[ée]m)\b/i;

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Deterministic ICP score from public signals. The AI only writes messages; qualification is code. */
export function scoreProfile(profile: ProfileSignals, config: BusinessConfig): IcpScore {
  const reasons: string[] = [];
  let score = 0;
  const haystack = normalize([profile.fullName, profile.bio, profile.category, profile.recentPostsSummary, profile.username].filter(Boolean).join(" \n "));

  const matchedKeywords = config.icp.keywords.filter((k) => haystack.includes(normalize(k)));
  if (matchedKeywords.length > 0) {
    score += Math.min(10 + matchedKeywords.length * 10, 35);
    reasons.push(`keywords: ${matchedKeywords.slice(0, 4).join(", ")}`);
  }

  const segment = guessSegment(haystack, config);
  if (segment) {
    score += 15;
    reasons.push(`segment: ${segment}`);
  }

  const councils = COUNCIL_PATTERNS.filter((c) => c.pattern.test(profile.bio ?? ""));
  if (councils.length > 0) {
    score += 15;
    reasons.push("professional council number in bio");
  }

  if (profile.isBusiness) {
    score += 5;
    reasons.push("business or creator account");
  }
  if (profile.category) {
    score += 5;
    reasons.push(`category: ${profile.category}`);
  }

  const followers = profile.followers ?? null;
  if (followers !== null) {
    const { min, max } = config.icp.followerRange;
    if (followers >= min && followers <= max) {
      score += 10;
      reasons.push(`followers in range (${followers})`);
    } else {
      score -= 20;
      reasons.push(`followers out of range (${followers})`);
    }
  }

  if (CONTENT_PATTERNS.test(haystack)) {
    score += 10;
    reasons.push("talks about video content");
  }
  if (CTA_PATTERNS.test(haystack)) {
    score += 5;
    reasons.push("has a call to action for clients");
  }
  if ((profile.posts ?? 0) >= 12) {
    score += 5;
    reasons.push("publishes regularly");
  }
  if (profile.lastPublicPostAt) {
    const days = (Date.now() - new Date(profile.lastPublicPostAt).getTime()) / 86_400_000;
    if (days > 60) {
      score -= 25;
      reasons.push("no public post in 60 days");
    } else if (days <= 14) {
      score += 5;
      reasons.push("posted in the last 2 weeks");
    }
  }
  if (profile.location && BRAZIL_PATTERNS.test(profile.location)) {
    score += 5;
    reasons.push("location in Brazil");
  } else if (BRAZIL_PATTERNS.test(profile.bio ?? "")) {
    score += 3;
    reasons.push("Brazilian city in bio");
  }

  const roleGuess = guessRole(profile.bio ?? "", profile.fullName ?? "");
  if (roleGuess === "owner" || roleGuess === "decision_maker") {
    score += 10;
    reasons.push(`role: ${roleGuess}`);
  } else if (roleGuess === "employee") {
    score -= 30;
    reasons.push("looks like an employee or student");
  } else if (roleGuess === "store") {
    score -= 5;
    reasons.push("looks like a business page, not a person");
  }

  const bounded = Math.max(0, Math.min(100, score));
  const priority = Math.round(bounded + (roleGuess === "owner" ? 5 : 0) + (profile.lastPublicPostAt ? 2 : 0));
  return {
    score: bounded,
    reasons,
    segment,
    roleGuess,
    priority,
    qualified: bounded >= 50 && roleGuess !== "employee",
  };
}

export function guessSegment(haystackNormalized: string, config: BusinessConfig): string | null {
  let best: { segment: string; hits: number } | null = null;
  for (const segment of config.icp.segments) {
    const words = normalize(segment)
      .split(/[\s,]+/)
      .filter((w) => w.length >= 5 && !["profissionais", "pequenos", "pequeno", "proprio", "clinicas", "negocios", "gravam", "video", "atrair", "clientes", "escritorio", "autonomos", "consultorio"].includes(w));
    const hits = words.filter((w) => haystackNormalized.includes(w.replace(/s$/, ""))).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { segment, hits };
  }
  return best?.segment ?? null;
}

export function guessRole(bio: string, fullName: string): RoleGuess {
  const text = `${fullName} ${bio}`;
  if (EMPLOYEE_PATTERNS.test(text)) return "employee";
  const hasCouncil = COUNCIL_PATTERNS.some((c) => c.pattern.test(bio));
  const hasTitle = TITLE_PATTERNS.test(text);
  if (/\b(fundador|fundadora|ceo|s[óo]cio|s[óo]cia|propriet[áa]ri[oa]|diretor|diretora)\b/i.test(text)) return "decision_maker";
  if (hasCouncil || hasTitle) return "owner";
  if (STORE_PATTERNS.test(text)) return "store";
  return "unknown";
}

/** Best hour band to send, from the hour of the lead's last public post (when known). */
export function bestSendWindow(lastPublicPostAt: string | null | undefined, timeZone: string): string | null {
  if (!lastPublicPostAt) return null;
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(lastPublicPostAt)).find((p) => p.type === "hour")?.value ?? "12",
  );
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

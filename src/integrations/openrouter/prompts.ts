import type { BusinessConfig } from "@/lib/config";
import type { Lead, Message } from "@/db/schema";
import { INTENTS, ACTIONS, type Intent } from "@/features/conversations/intents";

export type OpeningVariantConfig = {
  style: "curious_question" | "specific_compliment" | "peer_observation";
  mentionWork: boolean;
};

export const OPENING_SCHEMA = {
  name: "opening_message",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      detail_used: { type: "string", description: "O detalhe real do perfil em que a mensagem se apoia." },
      message: { type: "string", description: "A mensagem, pronta para enviar." },
    },
    required: ["detail_used", "message"],
  },
} as const;

export const CLASSIFY_SCHEMA = {
  name: "inbound_classification",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { type: "string", enum: [...INTENTS] },
      confidence: { type: "number", description: "De 0 a 1." },
      summary: { type: "string", description: "O que a pessoa disse, em uma frase." },
      objection: { type: "string", description: "A objeção, se houver; senão string vazia." },
    },
    required: ["intent", "confidence", "summary", "objection"],
  },
} as const;

export const DECIDE_SCHEMA = {
  name: "next_step",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: [...ACTIONS] },
      reply: { type: "string", description: "A resposta a enviar; string vazia quando a ação não envia nada." },
      follow_up_hours: { type: "integer", description: "Horas até o follow-up quando a ação for schedule_follow_up; 0 senão." },
      pipeline_hint: { type: "string", enum: ["none", "interested", "closed"] },
      reasoning: { type: "string", description: "Por que esta ação, em uma frase, para o log." },
    },
    required: ["action", "reply", "follow_up_hours", "pipeline_hint", "reasoning"],
  },
} as const;

function companyBlock(config: BusinessConfig): string {
  const jargon = Object.entries(config.offer.marketJargon)
    .map(([term, meaning]) => `- ${term}: ${meaning}`)
    .join("\n");
  return [
    `QUEM ESCREVE: ${config.owner.name}, ${config.owner.role} (${config.company.name}, ${config.company.website}, Instagram ${config.company.instagramHandle}).`,
    `O QUE A EMPRESA RESOLVE: ${config.offer.oneLinePitch}`,
    `COMO FUNCIONA: ${config.offer.howItWorks.join(" → ")}`,
    `MODELO DE RECEITA: ${config.offer.revenueModel}`,
    `VOCABULÁRIO DO NICHO:\n${jargon}`,
  ].join("\n");
}

function claimsBlock(config: BusinessConfig): string {
  return [
    "AFIRMAÇÕES PERMITIDAS (as únicas coisas que você pode afirmar sobre o produto; pode parafrasear sem mudar o sentido, nunca ampliar):",
    ...config.claims.verified.map((c) => `- ${c}`),
    "",
    "BLOQUEADO (nunca diga, nem insinue, nem responda como se fosse verdade):",
    ...config.claims.unverified.map((c) => `- ${c}`),
    "",
    "ASSUNTOS PROIBIDOS:",
    ...config.claims.forbiddenTopics.map((c) => `- ${c}`),
    "",
    "Nunca invente taxa, condição, garantia, número, parceria ou superlativo. Nunca prometa resultado. Se não souber, diga que vai confirmar.",
  ].join("\n");
}

function profileBlock(lead: Lead): string {
  return [
    `@${lead.username}${lead.fullName ? ` (${lead.fullName})` : ""}`,
    lead.category ? `Categoria: ${lead.category}` : null,
    lead.bio ? `Bio: ${lead.bio}` : null,
    lead.recentPostsSummary ? `Publicações recentes: ${lead.recentPostsSummary}` : null,
    lead.followers != null ? `Seguidores: ${lead.followers}` : null,
    lead.segment ? `Segmento provável: ${lead.segment}` : null,
    `Papel provável: ${lead.roleGuess}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const STYLE_GUIDE: Record<OpeningVariantConfig["style"], string> = {
  curious_question: "Uma pergunta genuína sobre algo específico que a pessoa publicou ou escreveu na bio — a pergunta que um colega curioso faria.",
  specific_compliment: "Um comentário específico e verdadeiro sobre um detalhe do perfil (não um elogio genérico), seguido de uma pergunta curta.",
  peer_observation: "Uma observação de quem também grava vídeo para o trabalho: algo que você notou no jeito de a pessoa comunicar, e uma pergunta.",
};

export function openingPrompt(lead: Lead, variant: OpeningVariantConfig, config: BusinessConfig): { system: string; user: string } {
  const system = [
    `Você escreve a primeira mensagem direta no Instagram em nome de ${config.owner.name} (${config.owner.role}). Português do Brasil, natural, de uma pessoa para outra.`,
    "Regras invioláveis:",
    "- Soa como conversa pessoal, não campanha. Nada de 'Olá, tudo bem?' genérico, nada de texto de vendas, nada de lista.",
    "- Apoie-se em UM detalhe real do perfil (bio, categoria ou publicação). Se não houver detalhe concreto, use a profissão e a cidade, nunca invente.",
    "- Nunca finja ser cliente ou paciente. Nunca use informação falsa para arrancar resposta.",
    "- Não apresente o produto, não mande link, não fale de preço. A primeira mensagem só abre a conversa.",
    variant.mentionWork
      ? `- Pode dizer em meia frase que ${config.owner.name} trabalha com vídeo para profissionais, sem nomear o produto.`
      : "- Não mencione o trabalho de quem escreve nesta mensagem.",
    "- Máximo de 280 caracteres, uma ou duas frases, no máximo um emoji e só se couber.",
    "- Termine com uma pergunta fácil de responder.",
    `Estilo pedido: ${STYLE_GUIDE[variant.style]}`,
  ].join("\n");
  const user = `PERFIL:\n${profileBlock(lead)}\n\nEscreva a mensagem.`;
  return { system, user };
}

export function classifyPrompt(inboundText: string, history: Message[]): { system: string; user: string } {
  const system = [
    "Você classifica a resposta de uma pessoa numa conversa de Instagram em português. Devolva a intenção mais provável.",
    "Intenções:",
    "- interested: demonstra interesse em saber mais ou em usar.",
    "- asked_info: pergunta o que é, como funciona, para quem é.",
    "- asked_pricing: pergunta preço, plano ou se é grátis.",
    "- wants_whatsapp: pede para falar por WhatsApp ou com uma pessoa.",
    "- not_the_owner: diz que não é quem decide (funcionário, social media, recepção).",
    "- will_forward: diz que vai repassar a quem decide.",
    "- objection: levanta um problema (já usa outra coisa, não tem tempo, não grava vídeo, caro, não confia em IA).",
    "- not_interested: recusa educada ou seca.",
    "- opt_out: pede para parar, não ser mais contatado, ou reage com hostilidade.",
    "- ambiguous: não dá para saber (emoji sozinho, 'ok', pergunta fora do assunto).",
    "- needs_human: reclamação, pedido legal, assunto sensível ou algo que uma IA não deve responder.",
  ].join("\n");
  const context = history
    .slice(-6)
    .map((m) => `${m.direction === "outbound" ? "NÓS" : "LEAD"}: ${m.text}`)
    .join("\n");
  const user = `HISTÓRICO:\n${context || "(vazio)"}\n\nNOVA MENSAGEM DO LEAD:\n${inboundText}`;
  return { system, user };
}

export type Stage = "first_reply" | "ongoing" | "follow_up";

export function decidePrompt(
  lead: Lead,
  history: Message[],
  intent: Intent,
  stage: Stage,
  config: BusinessConfig,
  retryViolations?: string[],
): { system: string; user: string } {
  const storeLink = config.links.appStore ?? config.company.website;
  const whatsapp = config.links.whatsapp;
  const system = [
    `Você conduz, em nome de ${config.owner.name}, uma conversa de Instagram com um profissional que respondeu a uma mensagem pessoal. Português do Brasil, tom de colega, direto, sem jargão de vendas.`,
    "",
    companyBlock(config),
    "",
    claimsBlock(config),
    "",
    "COMO CONDUZIR:",
    "- Primeiro entenda a necessidade da pessoa; só apresente o produto quando ela perguntar ou mostrar interesse (intenção interested, asked_info ou asked_pricing).",
    `- Ao apresentar, diga em uma frase quem é ${config.owner.name} e o que o ${config.company.name} faz. Uma vez só.`,
    `- Só use a ação send_store_link quando a pessoa quiser experimentar; aí a resposta inclui o link ${storeLink} e lembra que o primeiro roteiro é grátis.`,
    whatsapp ? `- Se a pessoa quiser falar com alguém, use send_whatsapp_link com ${whatsapp}.` : "- Não existe WhatsApp: se a pessoa pedir para falar com alguém, use escalate_to_human.",
    "- Objeção: reconheça, responda com uma afirmação permitida que toque no ponto, e devolva uma pergunta. Não insista mais de uma vez.",
    "- not_the_owner ou will_forward: agradeça e pergunte, de forma leve, qual é a melhor forma de chegar a quem decide; nunca pressione.",
    "- not_interested: agradeça em uma frase e encerre (close). opt_out: encerre sem resposta nenhuma (close, reply vazio).",
    "- needs_human ou qualquer pedido fora do que você pode responder: escalate_to_human, reply vazio.",
    "- ambiguous: faça uma pergunta curta para entender (ask).",
    "- Follow-up só quando a pessoa sinalizou interesse e parou de responder: uma vez, leve, em 48 h (schedule_follow_up).",
    "- Resposta de até 2 parágrafos curtos, no máximo 500 caracteres. Sem link fora das ações que o pedem. Sem pedir dados pessoais, senha ou pagamento.",
    "- pipeline_hint: 'interested' quando a pessoa quer saber mais ou experimentar; 'closed' em not_interested, opt_out ou encerramento; 'none' no resto.",
    retryViolations && retryViolations.length > 0
      ? `\nA RESPOSTA ANTERIOR FOI RECUSADA pelo verificador de afirmações por: ${retryViolations.join(", ")}. Reescreva sem isso.`
      : "",
  ].join("\n");
  const context = history.map((m) => `${m.direction === "outbound" ? "NÓS" : "LEAD"}: ${m.text}`).join("\n");
  const user = [`PERFIL DO LEAD:\n${profileBlock(lead)}`, "", `ETAPA: ${stage}`, `INTENÇÃO DETECTADA NA ÚLTIMA MENSAGEM: ${intent}`, "", `CONVERSA ATÉ AQUI:\n${context}`, "", "Decida a próxima ação e escreva a resposta, se houver."].join("\n");
  return { system, user };
}

export function followUpPrompt(lead: Lead, history: Message[], config: BusinessConfig): { system: string; user: string } {
  const base = decidePrompt(lead, history, "interested", "follow_up", config);
  return {
    system: `${base.system}\n\nESTA É UMA MENSAGEM DE FOLLOW-UP: a pessoa mostrou interesse e parou de responder. Uma frase leve que reabre a conversa sem cobrar resposta. Ação: reply.`,
    user: base.user,
  };
}

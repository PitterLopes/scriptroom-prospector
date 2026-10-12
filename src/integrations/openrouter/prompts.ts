import type { BusinessConfig } from "@/lib/config";
import type { Lead, Message } from "@/db/schema";
import { INTENTS, ACTIONS, type Intent } from "@/features/conversations/intents";

/**
 * All three openings are honest about who is writing and why. They differ only in how the ask is made.
 * The hypothesis being tested: honesty plus a low-cost way to say "no" earns more replies than a hook.
 */
export type OpeningVariantConfig = {
  style: "honest_ask" | "honest_short" | "honest_peer";
};

export const OPENING_SCHEMA = {
  name: "opening_message",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      post_index: { type: "integer", description: "O número (1, 2, 3…) do post real elogiado na mensagem. 0 só se não houver post na lista." },
      detail_used: { type: "string", description: "O que, naquele post, a mensagem elogia, em poucas palavras." },
      message: { type: "string", description: "A mensagem, pronta para enviar." },
    },
    required: ["post_index", "detail_used", "message"],
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
    config.offer.positioning.length > 0 ? `POSICIONAMENTO:\n${config.offer.positioning.map((p) => `- ${p}`).join("\n")}` : "",
    `VOCABULÁRIO DO NICHO:\n${jargon}`,
  ]
    .filter(Boolean)
    .join("\n");
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

export function recentPostsOf(lead: Lead): Array<{ url: string; caption: string; postedAt: string | null; kind: "post" | "reel" }> {
  try {
    const parsed = JSON.parse(lead.recentPosts) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<{ url: string; caption: string; postedAt: string | null; kind: "post" | "reel" }>) : [];
  } catch {
    return [];
  }
}

function postsBlock(lead: Lead): string {
  const posts = recentPostsOf(lead);
  if (posts.length === 0) return "POSTS RECENTES: nenhum lido.";
  return ["POSTS RECENTES (reais, do perfil):", ...posts.map((p, i) => `${i + 1}. [${p.kind === "reel" ? "Reels" : "post"}${p.postedAt ? `, ${p.postedAt.slice(0, 10)}` : ""}] ${p.caption}`)].join("\n");
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
    postsBlock(lead),
  ]
    .filter(Boolean)
    .join("\n");
}

const STYLE_GUIDE: Record<OpeningVariantConfig["style"], string> = {
  honest_ask:
    "Três partes, nesta ordem: (1) um elogio específico e verdadeiro a um detalhe do perfil; (2) quem escreve e por quê, com as palavras da história do fundador: está desenvolvendo o app sozinho, sem investimento de fora, para quem grava vídeo; (3) o pedido: testar o app e dizer o que achou ajudaria a continuar — e deixar claro que responder só 'não faz sentido para mim' já ajuda. Termina perguntando se pode mandar o app para a pessoa testar.",
  honest_short:
    "Mais curta: um elogio específico a um detalhe do perfil, uma frase dizendo que quem escreve está desenvolvendo um app para quem grava vídeo e procura gente para testar e dar feedback, e a pergunta se pode mandar para a pessoa experimentar. Uma frase final dizendo que um 'não' também ajuda.",
  honest_peer:
    "De colega para colega: quem escreve também grava vídeo para o próprio negócio e fez o app primeiro para si; um elogio específico ao perfil; e o pedido de ajuda: testar e contar o que não funcionou. Dizer que um 'não faz sentido' também ajuda, porque evita insistir com quem não precisa.",
};

export function openingPrompt(lead: Lead, variant: OpeningVariantConfig, config: BusinessConfig): { system: string; user: string } {
  const system = [
    `Você escreve a primeira mensagem direta no Instagram em nome de ${config.owner.name} (${config.owner.role}). Português do Brasil, natural, de uma pessoa para outra, na primeira pessoa.`,
    `QUEM ESCREVE E POR QUÊ (use como verdade, com as suas palavras, sem ampliar): ${config.offer.founderStory}`,
    `O QUE O APP FAZ, em uma frase, se precisar: ${config.offer.oneLinePitch}`,
    "Regras invioláveis:",
    "- Honesta do começo ao fim: diz quem é, o que está construindo e o que quer da pessoa. Nada de gancho, nada de mistério, nada de texto de vendas.",
    "- Soa como uma pessoa pedindo ajuda a outra, não como campanha. Nada de 'Olá, tudo bem?' genérico, nada de lista, nada de emoji em série.",
    "- A mensagem COMEÇA elogiando UM post real da lista POSTS RECENTES: diga o que aquele post específico tem de bom (a explicação, o exemplo, o jeito de falar), de forma que a pessoa reconheça que você viu o post. Elogio genérico ('adorei seu perfil', 'conteúdo top') está errado. Nunca invente um post nem atribua ao post algo que a legenda não mostra.",
    "- Nunca finja ser cliente ou paciente. Nunca use informação falsa para arrancar resposta.",
    "- Pode dizer o nome do app. Não manda link, não fala de preço, não promete resultado, não diz que é 'grátis' (só o primeiro roteiro é grátis, e isso fica para depois).",
    "- Deixe explícito que um 'não' ou um 'não faz sentido para mim' também ajuda: é o que torna a resposta fácil.",
    "- Entre 2 e 5 frases curtas, no máximo 480 caracteres. Termina com uma pergunta de sim ou não.",
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
    "- Objeção 'já tenho agência / freelancer / alguém que faz': não dispute. Use o POSICIONAMENTO: o app é alavanca para quem produz, e a pessoa pode repassar a quem cuida dos vídeos dela; se ela mesma aparece no vídeo, o roteiro e o teleprompter continuam sendo para ela.",
    "- not_the_owner ou will_forward: agradeça e pergunte, de forma leve, qual é a melhor forma de chegar a quem decide; nunca pressione.",
    "- not_interested: agradeça em uma frase e encerre (close). opt_out: encerre sem resposta nenhuma (close, reply vazio). close é SÓ para esses dois casos.",
    "- Quando a pessoa diz que vai testar, agradece ou fecha a conversa sem pergunta pendente: schedule_follow_up (follow_up_hours 20), SEMPRE com uma resposta de uma linha agradecendo e deixando a porta aberta para o feedback (nunca reply vazio: mensagem sem resposta parece descaso). Nunca close: quem vai testar continua em aberto.",
    "- needs_human ou qualquer pedido fora do que você pode responder: escalate_to_human, reply vazio.",
    "- ambiguous: faça uma pergunta curta para entender (ask).",
    "- Follow-up só quando a pessoa sinalizou interesse e parou de responder: uma vez só, leve (schedule_follow_up). O sistema marca a hora dentro da janela de 24 h da Meta; follow_up_hours é só um teto (use 20).",
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
    system: `${base.system}\n\nESTA É A ÚNICA MENSAGEM DE FOLLOW-UP QUE VAI EXISTIR: a pessoa mostrou interesse e parou de responder. Uma ou duas frases leves: pergunte se chegou a testar e deixe claro, sem cobrar, que "não fez sentido pra mim" também é uma resposta que ajuda. O teste é rápido; não insista nem venda. Ação: reply.`,
    user: base.user,
  };
}

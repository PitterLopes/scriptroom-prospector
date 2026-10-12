/** Every string the operator reads lives here, in Brazilian Portuguese. Code and data stay in English. */

export const PIPELINE_LABELS: Record<string, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado",
};

export const CHANNEL_LABELS: Record<string, string> = {
  browser_contact_pending: "Primeira mensagem pendente",
  browser_contact_sent: "Primeira mensagem enviada",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "Pronto para a API",
  api_active: "Conversando pela API",
  api_window_closed: "Janela da API fechada",
  human_review_required: "Precisa de você",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído",
};

export const INTENT_LABELS: Record<string, string> = {
  interested: "Interessado",
  asked_info: "Pediu informação",
  asked_pricing: "Perguntou preço",
  wants_whatsapp: "Quer falar com alguém",
  not_the_owner: "Não é quem decide",
  will_forward: "Vai repassar",
  objection: "Objeção",
  not_interested: "Sem interesse",
  opt_out: "Pediu para parar",
  ambiguous: "Ambíguo",
  needs_human: "Precisa de humano",
};

export const JOB_TYPE_LABELS: Record<string, string> = {
  discover_profiles: "Descobrir perfis",
  enrich_and_score: "Ler e pontuar perfil",
  send_first_dm: "Enviar primeira mensagem",
  process_inbound: "Processar resposta",
  send_api_reply: "Responder pela API",
  follow_up: "Follow-up",
  daily_backup: "Backup diário",
  review_experiments: "Revisar experimentos",
};

export const JOB_STATUS_LABELS: Record<string, string> = {
  pending: "Na fila",
  running: "Rodando",
  done: "Concluído",
  failed: "Falhou",
  dead: "Desistiu",
};

export const EXCEPTION_LABELS: Record<string, string> = {
  job_dead: "Job desistiu depois de várias tentativas",
  browser_unavailable: "Chrome indisponível",
  instagram_restriction: "Restrição do Instagram",
  circuit_breaker: "Pausa automática",
  duplicate_send_blocked: "Envio duplicado bloqueado",
  send_failed: "Falha ao enviar pelo navegador",
  claims_guard: "Mensagem barrada pelo verificador de afirmações",
  human_review: "Precisa de resposta humana",
  api_window_closed: "Janela da API fechada",
  api_not_configured: "API da Meta não configurada",
  api_unauthorized: "Token da Meta recusado",
  channel_ownership: "Canal errado para enviar",
  budget_exceeded: "Orçamento de IA atingido",
  relay_unreachable: "Caixa de entrada na Cloudflare indisponível",
};

export const MESSAGE_STATUS_LABELS: Record<string, string> = {
  planned: "Planejada",
  dry_run: "Simulada (não enviada)",
  sent: "Enviada",
  failed: "Falhou",
  received: "Recebida",
};

export const EVENT_LABELS: Record<string, string> = {
  discovered: "Perfil descoberto",
  scored: "Perfil pontuado",
  pipeline_changed: "Mudou de etapa",
  channel_changed: "Mudou de canal",
  opening_written: "IA escreveu a abertura",
  opening_refused: "Abertura recusada pelo verificador",
  first_dm_sent: "Primeira mensagem enviada",
  followed: "Passou a seguir a pessoa",
  first_dm_dry_run: "Primeira mensagem simulada",
  channel_handoff: "Conversa passou para a API",
  ig_user_id_linked: "Conta da Meta vinculada",
  intent_classified: "Intenção classificada",
  ai_decision: "Decisão da IA",
  reply_refused: "Resposta recusada pelo verificador",
  api_reply_sent: "Resposta enviada pela API",
  follow_up_scheduled: "Follow-up agendado",
  manual_note: "Anotação",
};

export const FUNNEL_LABELS: Record<string, string> = { customers: "Clientes", affiliates: "Afiliados" };

export function label(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return "—";
  return map[key] ?? key;
}

export function formatDateTime(iso: string | null | undefined, timeZone = "America/Sao_Paulo"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (abs < 60) return rtf.format(-Math.round(diff), "second");
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  return rtf.format(-Math.round(diff / 86400), "day");
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

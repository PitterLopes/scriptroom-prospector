import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { getLead, getOrCreateConversation, listMessages } from "@/db/queries/leads";
import { listLeadEvents } from "@/db/queries/events";
import { leadSpendUsd } from "@/db/queries/ai";
import { CHANNEL_LABELS, EVENT_LABELS, INTENT_LABELS, MESSAGE_STATUS_LABELS, PIPELINE_LABELS, formatDateTime, formatInt, formatUsd, label } from "@/lib/labels";
import { leadActionDispatcher } from "../../actions";
import { Badge, Button, Card, EmptyState, PageHeader, channelTone, pipelineTone } from "../../_components/ui";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const lead = getLead(db, id);
  if (!lead) notFound();
  const conversation = getOrCreateConversation(db, lead.id);
  const messages = listMessages(db, lead.id);
  const events = listLeadEvents(db, lead.id);
  const spend = leadSpendUsd(db, lead.id);
  const reasons = JSON.parse(lead.icpReasons) as string[];
  const tags = JSON.parse(lead.tags) as string[];

  return (
    <>
      <PageHeader title={`@${lead.username}`} subtitle={lead.fullName ?? undefined}>
        <a href={`https://www.instagram.com/${lead.username}/`} target="_blank" rel="noreferrer" className="text-sm text-[var(--accent)] hover:underline">
          Abrir no Instagram ↗
        </a>
        <a href={`https://www.instagram.com/direct/inbox/`} target="_blank" rel="noreferrer" className="text-sm text-[var(--accent)] hover:underline">
          Caixa de mensagens ↗
        </a>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card title="Cadastro">
            <dl className="space-y-2 text-sm">
              <Row k="Etapa" v={<Badge tone={pipelineTone(lead.pipelineState)}>{label(PIPELINE_LABELS, lead.pipelineState)}</Badge>} />
              <Row k="Canal" v={<Badge tone={channelTone(lead.channelState)}>{label(CHANNEL_LABELS, lead.channelState)}</Badge>} />
              <Row k="Dono do canal" v={conversation.channelOwner === "api" ? "API oficial" : conversation.channelOwner === "browser" ? "Navegador" : "Ninguém"} />
              <Row k="Origem" v={`${lead.source}${lead.sourceDetail ? ` · ${lead.sourceDetail}` : ""}`} />
              <Row k="Segmento" v={lead.segment ?? "—"} />
              <Row k="Papel provável" v={lead.roleGuess} />
              <Row k="Pontuação ICP" v={`${formatInt(lead.icpScore)} pts · prioridade ${formatInt(lead.priority)}`} />
              <Row k="Seguidores" v={lead.followers === null ? "—" : formatInt(lead.followers)} />
              <Row k="Categoria" v={lead.category ?? "—"} />
              <Row k="Bio" v={<span className="whitespace-pre-wrap">{lead.bio ?? "—"}</span>} />
              <Row k="Melhor janela" v={lead.bestSendWindow ?? "—"} />
              <Row k="Próxima ação" v={lead.nextAction ? `${lead.nextAction}${lead.nextActionAt ? ` · ${formatDateTime(lead.nextActionAt)}` : ""}` : "—"} />
              <Row k="Última intenção" v={label(INTENT_LABELS, conversation.lastIntent)} />
              <Row k="Janela da API até" v={formatDateTime(conversation.apiWindowExpiresAt)} />
              <Row k="Custo de IA neste lead" v={formatUsd(spend)} />
              <Row k="Tags" v={tags.length ? tags.join(", ") : "—"} />
              <Row k="Descoberto em" v={formatDateTime(lead.discoveredAt)} />
            </dl>
            {reasons.length > 0 ? (
              <details className="mt-3 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer">Por que esta pontuação</summary>
                <ul className="mt-1 list-disc pl-4">
                  {reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          <Card title="Ações">
            <div className="flex flex-wrap gap-2">
              <LeadAction leadId={lead.id} action="release_review" label="Liberar da revisão" disabled={lead.channelState !== "human_review_required"} />
              <LeadAction leadId={lead.id} action="send_now" label="Enviar primeira mensagem agora" disabled={!(lead.pipelineState === "qualified" && lead.channelState === "browser_contact_pending")} />
              <LeadAction leadId={lead.id} action="mark_registered" label="Marcar como cadastrado" disabled={!["interested", "whatsapp_handoff"].includes(lead.pipelineState)} />
              <LeadAction leadId={lead.id} action="mark_active_customer" label="Marcar como cliente ativo" disabled={lead.pipelineState !== "registered"} />
              <LeadAction leadId={lead.id} action="close" label="Encerrar" disabled={lead.pipelineState === "closed"} />
              <LeadAction leadId={lead.id} action="do_not_contact" label="Não contatar nunca mais" tone="bad" disabled={lead.channelState === "do_not_contact"} />
            </div>
            <form action={leadActionDispatcher} className="mt-3 flex gap-2">
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="action" value="note" />
              <input name="note" placeholder="Anotação" aria-label="Anotação" className="flex-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" />
              <Button>Anotar</Button>
            </form>
            {lead.notes ? <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-xs">{lead.notes}</pre> : null}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Conversa">
            {messages.length === 0 ? (
              <EmptyState>Nenhuma mensagem ainda.</EmptyState>
            ) : (
              <ul className="space-y-2">
                {messages.map((m) => (
                  <li key={m.id} className={`max-w-[85%] rounded-xl p-3 text-sm ${m.direction === "outbound" ? "ml-auto bg-blue-50" : "bg-slate-100"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                      <span>{m.direction === "outbound" ? "Nós" : "Lead"}</span>
                      <span>· {m.channel === "api" ? "API oficial" : "Navegador"}</span>
                      <Badge tone={m.status === "sent" || m.status === "received" ? "ok" : m.status === "failed" ? "bad" : "accent"}>{label(MESSAGE_STATUS_LABELS, m.status)}</Badge>
                      <span>· {formatDateTime(m.sentAt ?? m.createdAt)}</span>
                    </div>
                    <div className="whitespace-pre-wrap">{m.text}</div>
                    {m.error ? <div className="mt-1 text-xs text-red-700">{m.error}</div> : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Linha do tempo">
            <ol className="space-y-2 text-sm">
              {events.map((ev) => (
                <li key={ev.id} className="rounded-lg border border-[var(--line)] p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label(EVENT_LABELS, ev.type)}</span>
                    <span className="text-xs text-[var(--muted)]">por {ev.actor} · {formatDateTime(ev.createdAt)}</span>
                  </div>
                  <details className="mt-1 text-xs text-[var(--muted)]">
                    <summary className="cursor-pointer">detalhes</summary>
                    <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(JSON.parse(ev.payload), null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <p className="mt-6 text-sm">
        <Link href="/leads" className="text-[var(--accent)] hover:underline">
          ← Voltar aos leads
        </Link>
      </p>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2">
      <dt className="text-[var(--muted)]">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function LeadAction({ leadId, action, label: text, tone, disabled }: { leadId: string; action: string; label: string; tone?: "bad"; disabled?: boolean }) {
  if (disabled) return <span className="rounded-lg border border-dashed border-[var(--line)] px-3 py-1.5 text-sm text-[var(--muted)]">{text}</span>;
  return (
    <form action={leadActionDispatcher}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="action" value={action} />
      <Button tone={tone}>{text}</Button>
    </form>
  );
}

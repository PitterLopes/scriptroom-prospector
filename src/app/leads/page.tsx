import Link from "next/link";
import { getDb } from "@/db/client";
import { listLeads } from "@/db/queries/leads";
import { CUSTOMER_PIPELINE, type PipelineState } from "@/features/leads/states";
import { CHANNEL_LABELS, PIPELINE_LABELS, formatInt, formatRelative, label } from "@/lib/labels";
import { addLeadAction, runDiscoveryNowAction } from "../actions";
import { Badge, Button, Card, EmptyState, PageHeader, channelTone } from "../_components/ui";

export const dynamic = "force-dynamic";

type Search = Promise<{ estado?: string; busca?: string; canal?: string }>;

export default async function LeadsPage({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const db = getDb();
  const stateFilter = params.estado && (CUSTOMER_PIPELINE as readonly string[]).includes(params.estado) ? (params.estado as PipelineState) : undefined;
  const leads = listLeads(db, { funnel: "customers", pipelineState: stateFilter, search: params.busca?.trim() || undefined }, 1000);
  const columns = stateFilter ? [stateFilter] : CUSTOMER_PIPELINE.filter((s) => s !== "closed");
  const closed = leads.filter((l) => l.pipelineState === "closed");

  return (
    <>
      <PageHeader title="Leads · clientes" subtitle="Kanban do funil. Pipeline e canal são campos separados: a etapa diz onde a pessoa está, o canal diz quem pode falar com ela.">
        <form action={addLeadAction} className="flex items-center gap-2">
          <input name="username" placeholder="@perfil para adicionar" aria-label="Perfil do Instagram" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" />
          <Button>Adicionar lead</Button>
        </form>
        <form action={runDiscoveryNowAction} className="flex items-center gap-2">
          <input name="query" placeholder="#hashtag ou palavra para descobrir" aria-label="Busca de descoberta" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" />
          <Button>Descobrir agora</Button>
        </form>
      </PageHeader>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <input name="busca" defaultValue={params.busca ?? ""} placeholder="Buscar por @, nome ou bio" aria-label="Buscar leads" className="rounded-lg border border-[var(--line)] px-3 py-1.5" />
        <select name="estado" defaultValue={params.estado ?? ""} aria-label="Filtrar por etapa" className="rounded-lg border border-[var(--line)] bg-white px-3 py-1.5">
          <option value="">Todas as etapas</option>
          {CUSTOMER_PIPELINE.map((s) => (
            <option key={s} value={s}>
              {label(PIPELINE_LABELS, s)}
            </option>
          ))}
        </select>
        <Button>Filtrar</Button>
        <Link href="/leads" className="text-[var(--muted)] hover:underline">
          Limpar
        </Link>
      </form>

      {leads.length === 0 ? (
        <EmptyState>Nenhum lead ainda. Adicione um perfil à mão acima, ou peça uma descoberta; o worker lê e pontua cada perfil antes de qualquer mensagem.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {columns.map((state) => {
            const items = leads.filter((l) => l.pipelineState === state);
            return (
              <Card key={state} title={`${label(PIPELINE_LABELS, state)} · ${formatInt(items.length)}`}>
                {items.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">Vazio</p>
                ) : (
                  <ul className="space-y-2">
                    {items.slice(0, 50).map((lead) => (
                      <li key={lead.id} className="rounded-lg border border-[var(--line)] p-2 text-sm">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/leads/${lead.id}`} className="font-medium hover:underline">
                            @{lead.username}
                          </Link>
                          <span className="text-xs tabular-nums text-[var(--muted)]">{lead.icpScore} pts</span>
                        </div>
                        {lead.fullName ? <div className="text-xs text-[var(--muted)]">{lead.fullName}</div> : null}
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge tone={channelTone(lead.channelState)}>{label(CHANNEL_LABELS, lead.channelState)}</Badge>
                          {lead.segment ? <Badge>{lead.segment}</Badge> : null}
                          {(JSON.parse(lead.tags) as string[]).includes("dry_run") ? <Badge tone="accent">Simulado</Badge> : null}
                        </div>
                        {lead.nextAction ? <div className="mt-1 text-xs text-[var(--muted)]">Próxima ação: {lead.nextAction}</div> : null}
                        <div className="mt-1 text-xs text-[var(--muted)]">Atualizado {formatRelative(lead.updatedAt)}</div>
                      </li>
                    ))}
                    {items.length > 50 ? <li className="text-xs text-[var(--muted)]">… e mais {formatInt(items.length - 50)}</li> : null}
                  </ul>
                )}
              </Card>
            );
          })}
          {!stateFilter && closed.length > 0 ? (
            <Card title={`Encerrados · ${formatInt(closed.length)}`}>
              <ul className="space-y-1 text-sm">
                {closed.slice(0, 30).map((lead) => (
                  <li key={lead.id}>
                    <Link href={`/leads/${lead.id}`} className="hover:underline">
                      @{lead.username}
                    </Link>{" "}
                    <span className="text-xs text-[var(--muted)]">{label(CHANNEL_LABELS, lead.channelState)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}

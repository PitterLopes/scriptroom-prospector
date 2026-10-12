import { getDb } from "@/db/client";
import { getLimitsOverride, getPause, getSetting, getWarmupStart } from "@/db/queries/settings";
import { env, aiConfigured, instagramApiConfigured } from "@/lib/env";
import { business } from "@/lib/config";
import { formatDateTime } from "@/lib/labels";
import { saveLimitsAction, toggleDiscoveryAction } from "../actions";
import { Badge, Button, Card, PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const db = getDb();
  const e = env();
  const config = business();
  const override = getLimitsOverride(db);
  const pause = getPause(db);
  const discovery = getSetting<boolean>(db, "discovery.enabled", true);
  const warmup = getWarmupStart(db);
  return (
    <>
      <PageHeader title="Configurações" subtitle="Os limites do .env são o teto. Aqui você só aperta; para afrouxar, mude o .env e reinicie." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Limites de operação">
          <form action={saveLimitsAction} className="space-y-3 text-sm">
            <Field label={`Mensagens por dia (teto ${e.MAX_DMS_PER_DAY})`} name="maxDmsPerDay" defaultValue={override.maxDmsPerDay ?? e.MAX_DMS_PER_DAY} type="number" />
            <Field label={`Intervalo mínimo em segundos (piso ${e.MIN_SECONDS_BETWEEN_DMS})`} name="minSecondsBetweenDms" defaultValue={override.minSecondsBetweenDms ?? e.MIN_SECONDS_BETWEEN_DMS} type="number" />
            <Field label="Intervalo máximo em segundos" name="maxSecondsBetweenDms" defaultValue={override.maxSecondsBetweenDms ?? e.MAX_SECONDS_BETWEEN_DMS} type="number" />
            <Field label="Horário de operação" name="operatingHours" defaultValue={override.operatingHours ?? e.OPERATING_HOURS} type="text" />
            <p className="text-xs text-[var(--muted)]">
              Fuso: {e.OPERATING_TIMEZONE}. Aquecimento: {e.WARMUP_START_PER_DAY} por dia na primeira semana, +{e.WARMUP_STEP_PER_WEEK} por semana
              {warmup ? `, contado desde ${formatDateTime(warmup)}` : " (começa na primeira mensagem real)"}.
            </p>
            <Button tone="accent">Salvar limites</Button>
          </form>
        </Card>

        <Card title="Estado das integrações">
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between">
              <span>IA (OpenRouter)</span>
              <Badge tone={aiConfigured(e) ? "ok" : "bad"}>{aiConfigured(e) ? `${e.OPENROUTER_MODEL} · ${e.OPENROUTER_MODEL_FAST}` : "sem chave"}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>Chrome (primeiro contato)</span>
              <Badge tone="neutral">{e.CHROME_CDP_URL}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>Envio real pelo Chrome</span>
              <Badge tone={e.BROWSER_SEND_ENABLED ? "warn" : "accent"}>{e.BROWSER_SEND_ENABLED ? "liberado no .env (ligue na faixa de status)" : "bloqueado no .env: tudo é simulação"}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>API oficial da Meta</span>
              <Badge tone={instagramApiConfigured(e) ? "ok" : "warn"}>{instagramApiConfigured(e) ? `configurada · ${e.META_GRAPH_VERSION}` : "não configurada: respostas vão para revisão humana"}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <span>Descoberta automática de perfis</span>
              <form action={toggleDiscoveryAction} className="flex items-center gap-2">
                <Badge tone={discovery ? "ok" : "neutral"}>{discovery ? "ligada" : "desligada"}</Badge>
                <Button>{discovery ? "Desligar" : "Ligar"}</Button>
              </form>
            </li>
            <li className="flex items-center justify-between">
              <span>Pausa geral</span>
              <Badge tone={pause.paused ? "bad" : "ok"}>{pause.paused ? `pausado: ${pause.reason ?? ""}` : "rodando"}</Badge>
            </li>
          </ul>
        </Card>

        <Card title="Negócio (config/business.json)" className="lg:col-span-2">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--muted)]">Empresa</dt>
              <dd>
                {config.company.name} · {config.company.website} · {config.company.instagramHandle}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Quem escreve</dt>
              <dd>
                {config.owner.name}, {config.owner.role}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Link de destino</dt>
              <dd>{config.links.appStore ?? config.company.website}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Segmentos</dt>
              <dd>{config.icp.segments.join(" · ")}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Afirmações permitidas ({config.claims.verified.length})</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {config.claims.verified.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[var(--muted)]">Bloqueadas ({config.claims.unverified.length})</dt>
              <dd>
                <ul className="list-disc pl-5 text-[var(--muted)]">
                  {config.claims.unverified.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[var(--muted)]">Para mudar, edite o arquivo e reinicie o worker. O painel não escreve nele de propósito: é a única fonte dos dados reais.</p>
        </Card>
      </div>
    </>
  );
}

function Field({ label, name, defaultValue, type }: { label: string; name: string; defaultValue: string | number; type: "number" | "text" }) {
  return (
    <label className="block">
      <span className="text-[var(--muted)]">{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} className="mt-1 w-full rounded-lg border border-[var(--line)] px-3 py-1.5" />
    </label>
  );
}

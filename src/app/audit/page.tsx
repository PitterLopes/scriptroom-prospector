import { getDb } from "@/db/client";
import { listAudit } from "@/db/queries/events";
import { listDoNotContact } from "@/db/queries/leads";
import { formatDateTime } from "@/lib/labels";
import { addDoNotContactAction } from "../actions";
import { Button, Card, EmptyState, PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

export default function AuditPage() {
  const db = getDb();
  const audit = listAudit(db, 300);
  const dnc = listDoNotContact(db);
  return (
    <>
      <PageHeader title="Registro" subtitle="Tudo o que o sistema e você fizeram, em ordem. E a lista de quem nunca mais deve ser contatado." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Não contatar" className="lg:col-span-1">
          <form action={addDoNotContactAction} className="mb-3 flex gap-2">
            <input name="username" placeholder="@perfil" aria-label="Perfil" className="flex-1 rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm" />
            <Button>Adicionar</Button>
          </form>
          {dnc.length === 0 ? (
            <EmptyState>Lista vazia.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {dnc.map((d) => (
                <li key={d.username} className="py-1.5">
                  @{d.username} <span className="text-xs text-[var(--muted)]">· {d.reason} · {formatDateTime(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Log de decisões e ações" className="lg:col-span-2">
          {audit.length === 0 ? (
            <EmptyState>Nada registrado ainda.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {audit.map((a) => (
                <li key={a.id} className="py-1.5">
                  <span className="font-medium">{a.action}</span> <span className="text-xs text-[var(--muted)]">por {a.actor}{a.target ? ` · ${a.target}` : ""} · {formatDateTime(a.createdAt)}</span>
                  {a.details !== "{}" ? <pre className="mt-0.5 whitespace-pre-wrap text-xs text-[var(--muted)]">{a.details}</pre> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

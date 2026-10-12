import Link from "next/link";
import { getDb } from "@/db/client";
import { listOpenExceptions } from "@/db/queries/events";
import { EXCEPTION_LABELS, formatDateTime, label } from "@/lib/labels";
import { resolveExceptionAction } from "../actions";
import { Badge, Button, Card, EmptyState, PageHeader } from "../_components/ui";

export const dynamic = "force-dynamic";

export default function ExceptionsPage() {
  const items = listOpenExceptions(getDb());
  return (
    <>
      <PageHeader title="Fila de exceções" subtitle="O que o sistema não resolveu sozinho e parou para você olhar. Resolver aqui não reenvia nada: é só o registro de que você viu." />
      {items.length === 0 ? (
        <EmptyState>Nenhuma exceção aberta.</EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((ex) => {
            const payload = JSON.parse(ex.payload) as Record<string, unknown>;
            return (
              <Card key={ex.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={["instagram_restriction", "circuit_breaker", "duplicate_send_blocked", "budget_exceeded"].includes(ex.kind) ? "bad" : "warn"}>{label(EXCEPTION_LABELS, ex.kind)}</Badge>
                      <span className="text-xs text-[var(--muted)]">{formatDateTime(ex.createdAt)}</span>
                      {ex.leadId ? (
                        <Link href={`/leads/${ex.leadId}`} className="text-xs text-[var(--accent)] hover:underline">
                          abrir lead
                        </Link>
                      ) : null}
                    </div>
                    <p className="text-sm">{ex.message}</p>
                    {Object.keys(payload).length > 0 ? (
                      <details className="text-xs text-[var(--muted)]">
                        <summary className="cursor-pointer">detalhes técnicos</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(payload, null, 2)}</pre>
                      </details>
                    ) : null}
                  </div>
                  <form action={resolveExceptionAction}>
                    <input type="hidden" name="id" value={ex.id} />
                    <Button>Marcar como vista</Button>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

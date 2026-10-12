import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { StatusStrip } from "./_components/status-strip";

export const metadata: Metadata = {
  title: "Scriptroom Prospector",
  description: "Prospecção autônoma no Instagram, com CRM e painel de controle.",
};

const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "Visão geral" },
  { href: "/leads", label: "Leads" },
  { href: "/jobs", label: "Fila" },
  { href: "/exceptions", label: "Exceções" },
  { href: "/experiments", label: "Experimentos" },
  { href: "/ai", label: "Custo de IA" },
  { href: "/audit", label: "Registro" },
  { href: "/settings", label: "Configurações" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <header className="border-b border-[var(--line)] bg-[var(--surface)]">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
            <Link href="/" className="text-base font-semibold tracking-tight">
              Scriptroom <span className="text-[var(--muted)]">Prospector</span>
            </Link>
            <nav aria-label="Principal" className="flex flex-wrap gap-1 text-sm">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="rounded-md px-2.5 py-1 hover:bg-slate-100">
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <StatusStrip />
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

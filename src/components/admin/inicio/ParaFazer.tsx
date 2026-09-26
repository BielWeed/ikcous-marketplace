import { formatarInteiro } from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  CheckCircle2,
  ChevronRight,
  type LucideIcon,
  Package,
  PackageMinus,
  Receipt,
  RotateCcw,
  Wallet,
} from "lucide-react";

interface ItemParaFazer {
  readonly chave: string;
  readonly icone: LucideIcon;
  readonly rotulo: string;
  /** Texto do crachá; `null` = "não sei" (mostra "—"). */
  readonly contagem: number | null;
  /** O item pede ação agora (crachá aceso). */
  readonly pendente: boolean;
  readonly destino: View;
  readonly textoDoCracha?: string;
}

function montarItens(painel: PainelInicio | null): ItemParaFazer[] {
  const pend = painel?.pendencias;
  const preparar = pend?.pedidosParaPreparar ?? null;
  const devolucoes = pend?.devolucoesAbertas ?? null;
  const vencidas = painel?.contasVencidas ?? null;
  const estoque = pend?.estoqueBaixo ?? null;
  const caixaAberto = pend?.caixaAberto ?? false;
  return [
    {
      chave: "preparar",
      icone: Package,
      rotulo: "Pedidos para preparar",
      contagem: preparar,
      pendente: (preparar ?? 0) > 0,
      destino: "admin-orders",
    },
    {
      chave: "devolucoes",
      icone: RotateCcw,
      rotulo: "Devoluções abertas",
      contagem: devolucoes,
      pendente: (devolucoes ?? 0) > 0,
      destino: "admin-devolucoes",
    },
    {
      chave: "vencidas",
      icone: Receipt,
      rotulo: "Contas vencidas",
      contagem: vencidas,
      pendente: (vencidas ?? 0) > 0,
      destino: "admin-financeiro",
    },
    {
      chave: "caixa",
      icone: Wallet,
      rotulo: caixaAberto ? "Caixa aberto — feche no fim do dia" : "Caixa",
      contagem: null,
      pendente: caixaAberto,
      destino: "admin-financeiro",
      textoDoCracha: painel ? (caixaAberto ? "Aberto" : "Fechado") : undefined,
    },
    {
      chave: "estoque",
      icone: PackageMinus,
      rotulo: "Produtos com estoque baixo",
      contagem: estoque,
      pendente: (estoque ?? 0) > 0,
      destino: "admin-products",
    },
  ];
}

/** "Para fazer": cada pendência com o seu número e o atalho para resolvê-la. */
export function ParaFazer({
  painel,
  carregando,
  onNavigate,
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
}>) {
  const itens = montarItens(painel);
  const pendentes = itens.filter((item) => item.pendente).length;
  const esqueleto = carregando && !painel;

  return (
    <section
      aria-labelledby="inicio-para-fazer-titulo"
      aria-busy={esqueleto}
      className="admin-glass h-full rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2
          id="inicio-para-fazer-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Para fazer
        </h2>
        {painel ? (
          pendentes > 0 ? (
            <span className="text-[11px] font-bold text-amber-300">
              {pendentes} {pendentes === 1 ? "pendência" : "pendências"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Tudo em dia
            </span>
          )
        ) : null}
      </div>

      <ul className="space-y-1.5">
        {itens.map((item) => (
          <li key={item.chave}>
            <button
              type="button"
              onClick={() => onNavigate(item.destino)}
              className={cn(
                "group flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                item.pendente
                  ? "border-amber-500/15 bg-amber-500/[0.04] hover:border-amber-500/30"
                  : "border-white/5 bg-zinc-950/40 hover:border-white/10 hover:bg-zinc-900/40",
              )}
            >
              <item.icone
                className={cn(
                  "size-4 shrink-0",
                  item.pendente ? "text-amber-300" : "text-zinc-500",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-xs font-semibold",
                  item.pendente ? "text-white" : "text-zinc-400",
                )}
              >
                {item.rotulo}
              </span>
              {esqueleto ? (
                <span
                  className="premium-shimmer h-5 w-8 rounded-full"
                  aria-hidden="true"
                />
              ) : (
                <span
                  className={cn(
                    "min-w-8 rounded-full border px-2 py-0.5 text-center text-[11px] font-black tabular-nums",
                    item.pendente
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                      : "border-white/10 bg-white/5 text-zinc-400",
                  )}
                >
                  {item.textoDoCracha ?? formatarInteiro(item.contagem)}
                </span>
              )}
              <ChevronRight
                className="size-4 shrink-0 text-zinc-600 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

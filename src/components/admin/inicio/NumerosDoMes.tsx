import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import { TileDeKpi } from "@/components/admin/crm/TileDeKpi";
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  AlertTriangle,
  ArrowDownToLine,
  ChevronRight,
  Landmark,
  PiggyBank,
  TrendingUp,
} from "lucide-react";

/**
 * Os quatro números do mês no Início (grade 2×2 no celular, 4 lado a lado
 * no computador) + a linha de apoio "a pagar em 7 dias · contas vencidas",
 * que leva ao Financeiro.
 */
export function NumerosDoMes({
  painel,
  carregando,
  onNavigate,
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  onNavigate: (view: View) => void;
}>) {
  const esqueleto = carregando && !painel;
  const mes = painel?.mes;
  const vencidas = painel?.contasVencidas ?? null;
  const margem =
    mes?.lucroEstimado != null && mes.receita != null && mes.receita > 0
      ? (mes.lucroEstimado / mes.receita) * 100
      : null;

  return (
    <section
      aria-labelledby="inicio-mes-titulo"
      aria-busy={esqueleto}
      className="admin-glass h-full space-y-3 rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2
          id="inicio-mes-titulo"
          className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Este mês
        </h2>
        {mes && mes.pedidos != null ? (
          <p className="text-[11px] text-zinc-500">
            <strong className="font-bold tabular-nums text-zinc-300">
              {formatarInteiro(mes.pedidos)}
            </strong>{" "}
            {mes.pedidos === 1 ? "pedido" : "pedidos"} · ticket médio{" "}
            <strong className="font-bold tabular-nums text-zinc-300">
              {formatarMoeda(mes.ticketMedio)}
            </strong>
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <TileDeKpi
          rotulo="Receita do mês"
          icone={TrendingUp}
          corDoIcone="text-emerald-400"
          carregando={esqueleto}
          valor={formatarMoeda(mes?.receita)}
          valorCompacto={formatarMoedaCompacta(mes?.receita)}
          rodape={
            <ChipDeVariacao
              pct={variacaoPercentual(mes?.receita, mes?.receitaMesAnterior)}
              comparacao="vs. mês anterior"
            />
          }
        />
        <TileDeKpi
          rotulo="Lucro estimado"
          icone={PiggyBank}
          corDoIcone="text-admin-gold"
          carregando={esqueleto}
          valor={formatarMoeda(mes?.lucroEstimado)}
          valorCompacto={formatarMoedaCompacta(mes?.lucroEstimado)}
          rodape={
            margem == null
              ? "Receita menos o custo dos produtos"
              : `Margem estimada de ${formatarPercentual(margem, 0)}`
          }
        />
        <TileDeKpi
          rotulo="Saldo em contas"
          icone={Landmark}
          corDoIcone="text-sky-400"
          carregando={esqueleto}
          valor={formatarMoeda(painel?.saldoTotal)}
          valorCompacto={formatarMoedaCompacta(painel?.saldoTotal)}
          rodape="Caixa, banco e Mercado Pago"
        />
        <TileDeKpi
          rotulo="A receber em 7 dias"
          icone={ArrowDownToLine}
          corDoIcone="text-violet-400"
          carregando={esqueleto}
          valor={formatarMoeda(painel?.aReceber7d)}
          valorCompacto={formatarMoedaCompacta(painel?.aReceber7d)}
          rodape="Previsto no Financeiro"
        />
      </div>

      <button
        type="button"
        onClick={() => onNavigate("admin-financeiro")}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-white/5 bg-zinc-950/40 px-3 py-2 text-left text-xs transition-colors hover:border-admin-gold/30 hover:bg-zinc-900/40"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-zinc-400">
            A pagar em 7 dias{" "}
            <strong className="font-bold tabular-nums text-white">
              {esqueleto ? "…" : formatarMoeda(painel?.aPagar7d)}
            </strong>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1",
              vencidas && vencidas > 0 ? "text-rose-300" : "text-zinc-400",
            )}
          >
            {vencidas && vencidas > 0 ? (
              <AlertTriangle className="size-3.5" aria-hidden="true" />
            ) : null}
            Contas vencidas{" "}
            <strong className="font-bold tabular-nums">
              {esqueleto ? "…" : formatarInteiro(vencidas)}
            </strong>
          </span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-zinc-500"
          aria-hidden="true"
        />
      </button>
    </section>
  );
}

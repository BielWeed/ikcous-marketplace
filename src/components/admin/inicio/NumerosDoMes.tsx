import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import { TileDeKpi } from "@/components/admin/crm/TileDeKpi";
import {
  formatarInteiro,
  formatarMoeda,
  formatarMoedaCompacta,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  Landmark,
  PiggyBank,
  TrendingUp,
} from "lucide-react";

/**
 * Os quatro números do mês no Início (grade 2×2 no celular, 4 lado a lado
 * no computador) + a linha de apoio "a pagar em 7 dias", que leva ao
 * Financeiro. "Contas vencidas" mora só no "Para fazer" (um número, um lugar).
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
          className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-400"
        >
          Este mês
        </h2>
        {mes && mes.pedidos != null ? (
          <p className="text-[11px] text-zinc-400">
            <strong className="font-bold tabular-nums text-zinc-300">
              {formatarInteiro(mes.pedidos)}
            </strong>{" "}
            {mes.pedidos === 1 ? "venda" : "vendas"} · valor médio por venda{" "}
            <strong className="font-bold tabular-nums text-zinc-300">
              {formatarMoeda(mes.ticketMedio)}
            </strong>
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <TileDeKpi
          superficie="admin-glass"
          rotulo="Vendas pagas no mês"
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
          superficie="admin-glass"
          rotulo="Lucro estimado"
          icone={PiggyBank}
          corDoIcone="text-admin-gold"
          carregando={esqueleto}
          valor={formatarMoeda(mes?.lucroEstimado)}
          valorCompacto={formatarMoedaCompacta(mes?.lucroEstimado)}
          rodape={
            margem == null
              ? "Do Financeiro: vendas menos devoluções, custo dos produtos e despesas do mês"
              : `Margem estimada de ${formatarPercentual(margem, 0)}`
          }
        />
        <TileDeKpi
          superficie="admin-glass"
          rotulo="Saldo em contas"
          icone={Landmark}
          corDoIcone="text-sky-400"
          carregando={esqueleto}
          valor={formatarMoeda(painel?.saldoTotal)}
          valorCompacto={formatarMoedaCompacta(painel?.saldoTotal)}
          rodape="Caixa, banco e Mercado Pago"
        />
        <TileDeKpi
          superficie="admin-glass"
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
        className="group flex min-h-11 w-full items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/70 bg-gradient-to-r from-white/[0.05] to-transparent px-3.5 py-3 text-left shadow-lg transition-all hover:border-admin-gold/40 hover:from-admin-gold/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold active:scale-[0.99]"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-admin-gold/25 bg-admin-gold/10"
        >
          <ArrowUpFromLine className="size-5 text-admin-gold" />
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm font-bold text-zinc-300">
          A pagar em 7 dias{" "}
          <strong className="font-black tabular-nums text-white">
            {esqueleto ? "…" : formatarMoeda(painel?.aPagar7d)}
          </strong>
        </span>
        <ChevronRight
          className="size-5 shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-admin-gold"
          aria-hidden="true"
        />
      </button>
    </section>
  );
}

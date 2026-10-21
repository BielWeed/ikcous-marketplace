import { instanteDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import {
  formatarInteiro,
  formatarMoeda,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import type { View } from "@/types";
import type { PainelInicio } from "@/types/painel";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  CalendarDays,
  ChevronRight,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  CARTAO_INICIO,
  LINHA_INICIO,
  SeloDoInicio,
  TituloDoInicio,
  VALOR_INICIO,
  VariacaoDoInicio,
} from "./visualDoInicio";

const NOME_DO_MES = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** Mesmos números e comparações; resumo mensal e posição financeira separados. */
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
  const dia = useDiaDeSaoPaulo();
  const margem =
    mes?.lucroEstimado != null && mes.receita != null && mes.receita > 0
      ? (mes.lucroEstimado / mes.receita) * 100
      : null;

  const contas = [
    {
      titulo: "Saldo em contas",
      detalhe: "Disponível nas contas",
      valor: painel?.saldoTotal,
      icone: Wallet,
      tom: "teal",
    },
    {
      titulo: "A receber",
      detalhe: "Vencidas + próximos 7 dias",
      valor: painel?.aReceber7d,
      icone: ArrowDownToLine,
      tom: "ceu",
    },
    {
      titulo: "A pagar",
      detalhe: "Vencidas + próximos 7 dias",
      valor: painel?.aPagar7d,
      icone: ArrowUpFromLine,
      tom: "laranja",
    },
  ] as const;

  return (
    <section
      aria-labelledby="inicio-mes-titulo"
      aria-busy={esqueleto}
      className="min-w-0"
    >
      <div className="flex items-start justify-between gap-3">
        <TituloDoInicio id="inicio-mes-titulo" icone={CalendarDays} tom="roxo">
          Este mês
        </TituloDoInicio>
        <span className="pt-2 text-xs uppercase text-zinc-400">
          {NOME_DO_MES.format(instanteDoDia(dia))}
        </span>
      </div>
      <div className={`${CARTAO_INICIO} space-y-4`}>
        <dl className="grid grid-cols-2 gap-3">
          <div className="min-w-0">
            <dt className="text-sm text-zinc-400">Vendas</dt>
            <dd className={`mt-1 text-2xl ${VALOR_INICIO}`}>
              {formatarInteiro(mes?.pedidos)}
              <span className="sr-only"> vendas</span>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-sm text-zinc-400">Valor médio por venda</dt>
            <dd className={`mt-1 text-2xl ${VALOR_INICIO}`}>
              {formatarMoeda(mes?.ticketMedio)}
            </dd>
          </div>
        </dl>
        <div className="space-y-3 border-t border-admin-border pt-4">
          <p className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <SeloDoInicio icone={BarChart3} tom="verde" />
            Vendas pagas no mês
          </p>
          <p className={`text-[clamp(1.5rem,7vw,1.875rem)] ${VALOR_INICIO}`}>
            {formatarMoeda(mes?.receita)}
          </p>
          <VariacaoDoInicio
            pct={variacaoPercentual(mes?.receita, mes?.receitaMesAnterior)}
            comparacao="vs. os mesmos dias do mês anterior"
          />
        </div>
        <div className="space-y-3 border-t border-admin-border pt-4">
          <p className="flex items-center gap-2.5 text-sm font-semibold text-white">
            <SeloDoInicio icone={TrendingUp} tom="teal" />
            Lucro estimado
          </p>
          <p className={`text-[26px] ${VALOR_INICIO}`}>
            {formatarMoeda(mes?.lucroEstimado)}
          </p>
          {margem != null ? (
            <p className="text-sm font-medium text-teal-300">
              Margem estimada: {formatarPercentual(margem, 0)}
            </p>
          ) : null}
          <p className="text-sm leading-relaxed text-zinc-400">
            Desconta estornos, devoluções, custos e despesas, mesmo não pagas.
            Sem custo cadastrado, usa R$ 0 de custo.
          </p>
        </div>
        {esqueleto ? (
          <div className="premium-shimmer h-4 rounded-lg" aria-hidden="true" />
        ) : null}
      </div>
      <div
        className={`${CARTAO_INICIO} mt-3 divide-y divide-admin-border py-1`}
      >
        {contas.map((conta) => (
          <button
            key={conta.titulo}
            type="button"
            onClick={() => onNavigate("admin-financeiro")}
            className={LINHA_INICIO}
            aria-label={`${conta.titulo} — ${formatarMoeda(conta.valor)}. ${conta.detalhe}. Abrir Financeiro`}
          >
            <SeloDoInicio icone={conta.icone} tom={conta.tom} />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block text-base font-semibold text-white">
                {conta.titulo}
              </span>
              <strong className={`block text-[22px] ${VALOR_INICIO}`}>
                {formatarMoeda(conta.valor)}
              </strong>
              <span className="block text-sm text-zinc-400">
                {conta.detalhe}
              </span>
            </span>
            <ChevronRight
              className="size-5 shrink-0 text-zinc-400"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

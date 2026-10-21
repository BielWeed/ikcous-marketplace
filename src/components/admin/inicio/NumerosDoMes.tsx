import { instanteDoDia, useDiaDeSaoPaulo } from "@/hooks/useDiaDeSaoPaulo";
import {
  formatarInteiro,
  formatarMoeda,
  formatarPercentual,
  variacaoPercentual,
} from "@/lib/crm";
import { tomDoValor } from "@/lib/tons-de-estado";
import type { PainelInicio } from "@/types/painel";
import { HelpCircle } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
  CARTAO_INICIO,
  ROTULO_INICIO,
  TituloDoInicio,
  VALOR_INICIO,
  VariacaoDoInicio,
  valorNaCor,
} from "./visualDoInicio";

const NOME_DO_MES = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  timeZone: "America/Sao_Paulo",
});

/** Acima disto, dois números grandes lado a lado não cabem num celular. */
const LARGURA_MAXIMA_LADO_A_LADO = 10;

/**
 * "Este mês": vendas pagas (com variação) e lucro estimado na cor do sinal,
 * quantidade de vendas e valor médio. O gráfico dos 14 dias entra como
 * `children`, dentro do mesmo cartão; a posição financeira (saldo, a receber,
 * a pagar) mora em `DinheiroNasContas`.
 */
export function NumerosDoMes({
  painel,
  carregando,
  children,
}: Readonly<{
  painel: PainelInicio | null;
  carregando: boolean;
  children?: ReactNode;
}>) {
  const esqueleto = carregando && !painel;
  const mes = painel?.mes;
  const dia = useDiaDeSaoPaulo();
  const [explicando, setExplicando] = useState(false);
  const idDaExplicacao = useId();
  const margem =
    mes?.lucroEstimado != null && mes.receita != null && mes.receita > 0
      ? (mes.lucroEstimado / mes.receita) * 100
      : null;
  const receita = formatarMoeda(mes?.receita);
  const lucro = formatarMoeda(mes?.lucroEstimado);
  const empilhar =
    Math.max(receita.length, lucro.length) > LARGURA_MAXIMA_LADO_A_LADO;

  return (
    <section
      aria-labelledby="inicio-mes-titulo"
      aria-busy={esqueleto}
      className="min-w-0"
    >
      <TituloDoInicio
        id="inicio-mes-titulo"
        lateral={
          <span className="text-xs font-semibold uppercase text-zinc-400">
            {NOME_DO_MES.format(instanteDoDia(dia))}
          </span>
        }
      >
        Este mês
      </TituloDoInicio>
      <div className={`${CARTAO_INICIO} space-y-4`}>
        <div
          className={
            empilhar
              ? "grid grid-cols-1 gap-4"
              : "grid grid-cols-2 gap-4 min-[360px]:gap-5"
          }
        >
          <div className="min-w-0">
            <p className={ROTULO_INICIO}>
              Vendas pagas<span className="sr-only"> no mês</span>
            </p>
            <p
              className={`mt-1 text-[clamp(1.125rem,5.6vw,1.5rem)] ${VALOR_INICIO}`}
            >
              {receita}
            </p>
            <VariacaoDoInicio
              pct={variacaoPercentual(mes?.receita, mes?.receitaMesAnterior)}
              referencia="que nos mesmos dias do mês anterior"
            />
          </div>
          <div
            className={
              empilhar
                ? "min-w-0 border-t border-admin-border pt-4"
                : "min-w-0 border-l border-admin-border pl-4 min-[360px]:pl-5"
            }
          >
            <p className={ROTULO_INICIO}>Lucro estimado</p>
            <p
              className={`mt-1 text-[clamp(1.125rem,5.6vw,1.5rem)] ${valorNaCor(tomDoValor(mes?.lucroEstimado))}`}
            >
              {lucro}
            </p>
            {margem != null ? (
              <p className="mt-1 text-sm text-zinc-400">
                Margem estimada {formatarPercentual(margem, 1)}
              </p>
            ) : null}
          </div>
        </div>
        <p className="border-t border-admin-border pt-3 text-sm text-zinc-400">
          <strong className="font-bold tabular-nums text-white">
            {formatarInteiro(mes?.pedidos)}
          </strong>{" "}
          {mes?.pedidos === 1 ? "venda" : "vendas"} · valor médio por venda{" "}
          <strong className="font-bold tabular-nums text-white">
            {formatarMoeda(mes?.ticketMedio)}
          </strong>
        </p>
        {children}
        <div>
          <button
            type="button"
            aria-expanded={explicando}
            aria-controls={idDaExplicacao}
            onClick={() => setExplicando((aberto) => !aberto)}
            className="flex min-h-11 items-center gap-2 rounded-xl text-sm font-medium text-zinc-300 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
          >
            Como é calculado o lucro
            <span aria-hidden="true" className="flex">
              <HelpCircle className="size-4" />
            </span>
          </button>
          {explicando ? (
            <p
              id={idDaExplicacao}
              className="mt-1 text-sm leading-relaxed text-zinc-400"
            >
              Desconta estornos, devoluções, custos e despesas, mesmo não pagas.
              Sem custo cadastrado, usa R$ 0 de custo.
            </p>
          ) : null}
        </div>
        {esqueleto ? (
          <div className="premium-shimmer h-4 rounded-lg" aria-hidden="true" />
        ) : null}
      </div>
    </section>
  );
}

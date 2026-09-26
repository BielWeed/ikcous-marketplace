import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  Lock,
  LockOpen,
  Receipt,
  Scale,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";

import { useResumoFinanceiro } from "@/hooks/useFinanceiro";
import {
  formatarDataHora,
  formatarHora,
  formatarPercentual,
  rotuloDaForma,
  rotuloDoTipoDeConta,
  serieDoFluxoDeCaixa,
  ultimos30Dias,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type {
  DataIso,
  IntervaloDeDatas,
  ResumoFinanceiro,
  TotaisPrevistos,
} from "@/types/financeiro";
import { FluxoDeCaixaGrafico } from "./FluxoDeCaixaGrafico";
import { IconeDoTipoDeConta } from "./icones";
import type { AbaDoFinanceiro, LadoDosPrevistos } from "./navegacao";
import {
  BlocoKpi,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_TITULO_SECAO,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeKpis,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  corDoValor,
} from "./partes";

const COR_APP = "#38bdf8";
const COR_LOJA = "#f9c406";

function CartaoDePrevistos({
  titulo,
  totais,
  lado,
  aoVer,
}: {
  readonly titulo: string;
  readonly totais: TotaisPrevistos;
  readonly lado: LadoDosPrevistos;
  readonly aoVer: (lado: LadoDosPrevistos) => void;
}) {
  const temVencido = Math.round(totais.vencido * 100) > 0;
  return (
    <CartaoSecao
      titulo={titulo}
      acao={
        <button
          type="button"
          onClick={() => aoVer(lado)}
          className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-bold text-zinc-400 hover:text-white"
        >
          Ver contas
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      }
    >
      <Dinheiro
        valor={totais.total}
        className={cn(
          "text-3xl font-black tracking-tight",
          lado === "entrada" ? "text-emerald-300" : "text-red-300",
        )}
      />
      <dl className="mt-4 grid grid-cols-2 gap-2">
        <div
          className={cn(
            "rounded-xl border p-3",
            temVencido
              ? "border-red-500/30 bg-red-500/10"
              : "border-white/5 bg-white/[0.02]",
          )}
        >
          <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Vencido
          </dt>
          <dd
            className={cn(
              "mt-1 text-sm font-black",
              temVencido ? "text-red-300" : "text-zinc-300",
            )}
          >
            <Dinheiro valor={totais.vencido} />
          </dd>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <dt className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Próximos 7 dias
          </dt>
          <dd className="mt-1 text-sm font-black text-zinc-100">
            <Dinheiro valor={totais.proximos7Dias} />
          </dd>
        </div>
      </dl>
    </CartaoSecao>
  );
}

function RecebimentosPorForma({
  resumo,
}: { readonly resumo: ResumoFinanceiro }) {
  const formas = useMemo(
    () => [...resumo.porForma].sort((a, b) => b.valor - a.valor),
    [resumo.porForma],
  );
  const total = formas.reduce((soma, f) => soma + f.valor, 0);
  return (
    <CartaoSecao
      titulo="Recebimentos por forma"
      subtitulo="Como o dinheiro entrou no período"
    >
      {formas.length === 0 || total <= 0 ? (
        <p className="text-xs text-zinc-500">Nenhum recebimento no período.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {formas.map((forma) => {
            const pct = (forma.valor / total) * 100;
            return (
              <li
                key={forma.forma ?? "sem-forma"}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-bold text-zinc-200">
                    {rotuloDaForma(forma.forma)}
                  </span>
                  <span className="shrink-0 tabular-nums text-zinc-400">
                    <Dinheiro
                      valor={forma.valor}
                      className="font-bold text-white"
                    />{" "}
                    · {formatarPercentual(pct)}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-admin-gold/80"
                    style={{ width: `${Math.max(pct, 1.5)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </CartaoSecao>
  );
}

function AppVersusLoja({ resumo }: { readonly resumo: ResumoFinanceiro }) {
  const { online, presencial } = resumo.porCanal;
  const total = online + presencial;
  const pctApp = total > 0 ? (online / total) * 100 : 0;
  const pctLoja = total > 0 ? 100 - pctApp : 0;
  return (
    <CartaoSecao
      titulo="App × loja física"
      subtitulo="Vendas recebidas no período"
    >
      {total <= 0 ? (
        <p className="text-xs text-zinc-500">
          Nenhuma venda recebida no período.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
            aria-hidden="true"
          >
            {online > 0 ? (
              <div
                className="h-full rounded-l-full"
                style={{ width: `${pctApp}%`, background: COR_APP }}
              />
            ) : null}
            {presencial > 0 ? (
              <div
                className="h-full rounded-r-full"
                style={{ width: `${pctLoja}%`, background: COR_LOJA }}
              />
            ) : null}
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: COR_APP }}
                />
                App
              </dt>
              <dd className="mt-1 text-base font-black text-white">
                <Dinheiro valor={online} />
              </dd>
              <dd className="text-xs text-zinc-500">
                {formatarPercentual(pctApp)}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: COR_LOJA }}
                />
                Loja física
              </dt>
              <dd className="mt-1 text-base font-black text-white">
                <Dinheiro valor={presencial} />
              </dd>
              <dd className="text-xs text-zinc-500">
                {formatarPercentual(pctLoja)}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </CartaoSecao>
  );
}

/**
 * Aba "Visão": o extrato de banco em uma tela — saldo total e por conta,
 * o que entrou e saiu no período, o que vence, o fluxo de 30 dias, por onde
 * o dinheiro entra e o estado da gaveta.
 */
export function AbaVisao({
  ativo,
  intervalo,
  hoje,
  versao,
  irParaAba,
  verPrevistos,
}: {
  readonly ativo: boolean;
  readonly intervalo: IntervaloDeDatas | null;
  readonly hoje: DataIso;
  readonly versao: number;
  readonly irParaAba: (aba: AbaDoFinanceiro) => void;
  readonly verPrevistos: (lado: LadoDosPrevistos) => void;
}) {
  const resumo = useResumoFinanceiro(intervalo, ativo, versao);
  const janela = useMemo(() => ultimos30Dias(hoje), [hoje]);
  const mesmaJanela =
    intervalo?.inicio === janela.inicio && intervalo?.fim === janela.fim;
  const resumo30 = useResumoFinanceiro(janela, ativo && !mesmaJanela, versao);
  const fonteDoGrafico = mesmaJanela ? resumo : resumo30;

  const pontos = useMemo(
    () =>
      fonteDoGrafico.dados
        ? serieDoFluxoDeCaixa(
            fonteDoGrafico.dados.serie,
            janela,
            fonteDoGrafico.dados.saldoTotal,
          )
        : [],
    [fonteDoGrafico.dados, janela],
  );

  if (resumo.erro && !resumo.dados) {
    return (
      <EstadoDeErro mensagem={resumo.erro} aoTentarDeNovo={resumo.recarregar} />
    );
  }
  const dados = resumo.dados;
  if (!dados) {
    return (
      <div className="flex flex-col gap-4">
        <EsqueletoDeKpis quantos={1} />
        <EsqueletoDeKpis />
        <EsqueletoDeLista linhas={3} />
      </div>
    );
  }

  const caixa = dados.caixaAberto;

  return (
    <div className="flex flex-col gap-4 lg:gap-6">
      {resumo.erro ? (
        <EstadoDeErro
          mensagem={resumo.erro}
          aoTentarDeNovo={resumo.recarregar}
        />
      ) : null}

      <CartaoSecao
        titulo="Saldo total"
        subtitulo="Soma de todas as contas da loja, hoje"
        className="bg-gradient-to-br from-admin-gold/[0.06] to-transparent"
      >
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <Dinheiro
            valor={dados.saldoTotal}
            className={cn(
              "text-4xl font-black tracking-tighter sm:text-5xl",
              dados.saldoTotal < 0 ? "text-red-300" : "text-white",
            )}
          />
          {dados.contas.length > 0 ? (
            <ul
              aria-label="Saldo por conta"
              className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:justify-end"
            >
              {dados.contas.map((conta) => {
                return (
                  <li
                    key={conta.id}
                    className="flex min-w-0 flex-col gap-1 rounded-xl border border-white/5 bg-black/20 p-3 lg:min-w-[150px]"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-bold text-zinc-400">
                      <IconeDoTipoDeConta
                        tipo={conta.tipo}
                        className="size-4 shrink-0"
                      />
                      <span className="truncate">{conta.nome}</span>
                    </span>
                    <Dinheiro
                      valor={conta.saldo}
                      className={cn(
                        "text-base font-black",
                        conta.saldo < 0 ? "text-red-300" : "text-white",
                      )}
                    />
                    <span className="sr-only">
                      {rotuloDoTipoDeConta(conta.tipo)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </CartaoSecao>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BlocoKpi
          rotulo="Entradas"
          icone={ArrowDownLeft}
          destaque="text-emerald-400"
        >
          <Dinheiro
            valor={dados.entradas}
            sentido={1}
            className="text-emerald-300"
          />
        </BlocoKpi>
        <BlocoKpi rotulo="Saídas" icone={ArrowUpRight} destaque="text-red-400">
          <Dinheiro
            valor={dados.saidas}
            sentido={-1}
            className="text-red-300"
          />
        </BlocoKpi>
        <BlocoKpi
          rotulo="Resultado"
          icone={Scale}
          destaque="text-admin-gold"
          detalhe="Entradas − saídas do período"
        >
          <Dinheiro
            valor={dados.resultado}
            comSinal
            className={corDoValor(dados.resultado)}
          />
        </BlocoKpi>
        <BlocoKpi
          rotulo="Caixa da loja"
          icone={caixa ? LockOpen : Lock}
          destaque={caixa ? "text-emerald-400" : "text-zinc-500"}
          detalhe={
            <button
              type="button"
              onClick={() => irParaAba("caixa")}
              className="-mx-1 inline-flex min-h-8 items-center gap-1 rounded-lg px-1 font-bold text-admin-gold hover:underline"
            >
              {caixa ? "Ver o caixa" : "Abrir o caixa"}
              <ChevronRight aria-hidden="true" className="size-3.5" />
            </button>
          }
        >
          <span className={caixa ? "text-emerald-300" : "text-zinc-400"}>
            {caixa ? "Aberto" : "Fechado"}
          </span>
          {caixa ? (
            <span className="block text-[11px] font-bold text-zinc-500">
              desde {formatarHora(caixa.abertoEm)}
            </span>
          ) : null}
        </BlocoKpi>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <CartaoDePrevistos
          titulo="A receber"
          totais={dados.aReceber}
          lado="entrada"
          aoVer={verPrevistos}
        />
        <CartaoDePrevistos
          titulo="A pagar"
          totais={dados.aPagar}
          lado="saida"
          aoVer={verPrevistos}
        />
      </div>

      <CartaoSecao
        titulo="Fluxo de caixa — últimos 30 dias"
        subtitulo="Saldo reconstruído a partir do saldo de hoje"
      >
        {fonteDoGrafico.erro && !fonteDoGrafico.dados ? (
          <EstadoDeErro
            mensagem={fonteDoGrafico.erro}
            aoTentarDeNovo={fonteDoGrafico.recarregar}
          />
        ) : (
          <FluxoDeCaixaGrafico
            pontos={pontos}
            carregando={fonteDoGrafico.carregando}
            ativo={ativo}
          />
        )}
      </CartaoSecao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <RecebimentosPorForma resumo={dados} />
        <AppVersusLoja resumo={dados} />
      </div>

      {caixa ? (
        <p className="text-[11px] text-zinc-600">
          Caixa aberto em {formatarDataHora(caixa.abertoEm)} com{" "}
          <Dinheiro valor={caixa.valorAbertura} /> de troco.
        </p>
      ) : null}

      {dados.contas.length === 0 ? (
        <EstadoVazio
          icone={Wallet}
          titulo="Nenhuma conta ainda"
          texto="Cadastre onde o dinheiro da loja mora para ver o saldo aqui."
          acao={
            <button
              type="button"
              onClick={() => irParaAba("contas")}
              className={CLASSE_BOTAO_SECUNDARIO}
            >
              <Receipt aria-hidden="true" className="size-4" />
              Contas e categorias
            </button>
          }
        />
      ) : null}

      <p
        className={cn(
          CLASSE_TITULO_SECAO,
          "flex items-center gap-1.5 normal-case tracking-normal",
        )}
      >
        <CalendarClock aria-hidden="true" className="size-4" />
        Vendas entram no dia em que o pagamento foi recebido (horário de
        Brasília).
      </p>
    </div>
  );
}

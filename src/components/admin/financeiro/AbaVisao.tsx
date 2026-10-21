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

import { IconePix } from "@/components/admin/primitivos/IconePix";
import { useResumoFinanceiro } from "@/hooks/useFinanceiro";
import {
  formatarDataHora,
  formatarHora,
  formatarPercentual,
  marcoDoSaldoInicial,
  rotuloDaForma,
  rotuloDoTipoDeConta,
  serieDoFluxoDeCaixa,
  ultimos30Dias,
} from "@/lib/financeiro";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type {
  ContaFinanceira,
  DataIso,
  IntervaloDeDatas,
  ResumoFinanceiro,
  TotaisPrevistos,
} from "@/types/financeiro";
import { FluxoDeCaixaGrafico } from "./FluxoDeCaixaGrafico";
import { IconeDoTipoDeConta, matizDoTipoDeConta } from "./icones";
import type { AbaDoFinanceiro, LadoDosPrevistos } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CASCA_DO_CARTAO,
  CLASSE_ROTULO_DO_CARTAO,
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
const COR_LOJA = "#FF8BB2";

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
    <section aria-label={titulo}>
      <button
        type="button"
        onClick={() => aoVer(lado)}
        className="flex min-h-20 w-full flex-col gap-2 rounded-2xl bg-admin-surface p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
      >
        <span className="flex w-full flex-wrap items-center gap-2 text-sm font-bold text-white">
          {lado === "entrada" ? (
            <ArrowDownLeft
              aria-hidden="true"
              className="size-6 shrink-0 text-teal-300"
            />
          ) : (
            <ArrowUpRight
              aria-hidden="true"
              className="size-6 shrink-0 text-red-400"
            />
          )}
          <span className="flex-1">{titulo}</span>
          <Dinheiro
            valor={totais.total}
            sentido={lado === "entrada" ? 1 : -1}
            className={cn(
              "text-sm font-bold",
              classeDoTexto(lado === "entrada" ? "positivo" : "negativo"),
            )}
          />
          <ChevronRight aria-hidden="true" className="size-4 text-zinc-400" />
        </span>
        <dl className="grid w-full grid-cols-1 gap-1 pl-8 text-xs sm:grid-cols-2">
          <div
            className={
              temVencido
                ? "flex flex-wrap items-baseline gap-1 text-red-400"
                : "flex flex-wrap items-baseline gap-1 text-zinc-400"
            }
          >
            <dt>Vencido</dt>
            <dd
              className={cn(
                "font-medium",
                temVencido ? "text-red-400" : "text-zinc-400",
              )}
            >
              <Dinheiro valor={totais.vencido} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline gap-1 text-zinc-400">
            <dt>Próximos 7 dias</dt>
            <dd>
              <Dinheiro valor={totais.proximos7Dias} />
            </dd>
          </div>
        </dl>
        <span className="sr-only">Ver contas</span>
      </button>
    </section>
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
        <p className="text-xs text-zinc-400">Nenhum recebimento no período.</p>
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
                  <span className="break-words font-bold text-zinc-200">
                    {forma.forma === "pix" && (
                      <IconePix className="mr-1 inline-block size-4 align-text-bottom text-teal-300" />
                    )}
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
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(pct, 1.5)}%`,
                      backgroundColor:
                        forma.forma === "pix"
                          ? "#2DD4BF"
                          : forma.forma === "credito"
                            ? "#BA9AFF"
                            : "#7AA2FF",
                    }}
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
        <p className="text-xs text-zinc-400">
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
          <dl className="grid grid-cols-1 gap-5">
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: COR_APP }}
                />
                App
              </dt>
              <dd className="mt-1 text-base font-black text-white">
                <Dinheiro valor={online} />
              </dd>
              <dd className="text-xs text-zinc-400">
                {formatarPercentual(pctApp)}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.2em] text-zinc-400">
                <span
                  className="size-2 rounded-sm"
                  style={{ background: COR_LOJA }}
                />
                Loja física
              </dt>
              <dd className="mt-1 text-base font-black text-white">
                <Dinheiro valor={presencial} />
              </dd>
              <dd className="text-xs text-zinc-400">
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
  contas,
  irParaAba,
  verPrevistos,
}: {
  readonly ativo: boolean;
  readonly intervalo: IntervaloDeDatas | null;
  readonly hoje: DataIso;
  readonly versao: number;
  readonly contas: readonly ContaFinanceira[];
  readonly irParaAba: (aba: AbaDoFinanceiro) => void;
  readonly verPrevistos: (lado: LadoDosPrevistos) => void;
}) {
  const resumo = useResumoFinanceiro(intervalo, ativo, versao);
  const janela = useMemo(() => ultimos30Dias(hoje), [hoje]);
  const mesmaJanela =
    intervalo?.inicio === janela.inicio && intervalo?.fim === janela.fim;
  const resumo30 = useResumoFinanceiro(janela, ativo && !mesmaJanela, versao);
  const fonteDoGrafico = mesmaJanela ? resumo : resumo30;

  // Sem contas carregadas ainda (erro na 1ª busca, ou lista vazia) o marco
  // fica `null` — `serieDoFluxoDeCaixa` não corta nada, o comportamento é o
  // de sempre. `contas` guarda o último resultado bom mesmo depois de um
  // erro de recarga (useConsultaFinanceira), então uma falha passageira não
  // apaga o marco que já se sabia.
  const marco = useMemo(() => marcoDoSaldoInicial(contas), [contas]);

  const pontos = useMemo(
    () =>
      fonteDoGrafico.dados
        ? serieDoFluxoDeCaixa(
            fonteDoGrafico.dados.serie,
            janela,
            fonteDoGrafico.dados.saldoTotal,
            marco,
          )
        : [],
    [fonteDoGrafico.dados, janela, marco],
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
    <div className="flex flex-col gap-7">
      {resumo.erro ? (
        <EstadoDeErro
          mensagem={resumo.erro}
          aoTentarDeNovo={resumo.recarregar}
        />
      ) : null}

      <section
        aria-label="Saldo total"
        className="rounded-3xl bg-admin-raised p-4"
      >
        <h2 className="mb-2 text-xs font-bold uppercase text-zinc-400">
          Saldo total · hoje
        </h2>
        <p className="sr-only">Soma de todas as contas da loja, hoje</p>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <Dinheiro
            valor={dados.saldoTotal}
            className={cn(
              "text-[clamp(1.5rem,8vw,2.25rem)] font-bold leading-tight tracking-tight",
              corDoValor(dados.saldoTotal),
            )}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-1 rounded-3xl bg-admin-surface p-1 lg:grid-cols-2">
        <CartaoDePrevistos
          titulo="A pagar"
          totais={dados.aPagar}
          lado="saida"
          aoVer={verPrevistos}
        />
        <CartaoDePrevistos
          titulo="A receber"
          totais={dados.aReceber}
          lado="entrada"
          aoVer={verPrevistos}
        />
      </div>

      <section
        aria-label="Movimentos do período"
        className="rounded-3xl bg-admin-surface p-4"
      >
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="mb-1 text-xs text-zinc-400">Entradas</dt>
            <dd className="text-xl font-bold">
              <Dinheiro
                valor={dados.entradas}
                sentido={1}
                className="text-emerald-300"
              />
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-xs text-zinc-400">Saídas</dt>
            <dd className="text-xl font-bold">
              <Dinheiro
                valor={dados.saidas}
                sentido={-1}
                className="text-red-300"
              />
            </dd>
          </div>
          <div className="col-span-2 text-xs text-zinc-400">
            <dt className="inline">Resultado </dt>
            <dd className="inline">
              <Dinheiro
                valor={dados.resultado}
                comSinal
                className={corDoValor(dados.resultado)}
              />
            </dd>
            <span> · Entradas − saídas do período</span>
          </div>
        </dl>
      </section>

      <div className="flex flex-col rounded-3xl bg-admin-surface p-2">
        <button
          type="button"
          onClick={() => irParaAba("caixa")}
          className="flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left text-sm text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          {caixa ? (
            <LockOpen aria-hidden="true" className="size-5 text-teal-300" />
          ) : (
            <Lock aria-hidden="true" className="size-5 text-teal-300" />
          )}
          <span className="min-w-0 flex-1 break-words">
            {caixa ? "Ver o caixa" : "Abrir o caixa"}
            <span className="ml-1 text-xs text-zinc-400">
              ·{" "}
              {caixa
                ? `aberto desde ${formatarHora(caixa.abertoEm)}`
                : "Fechado"}
            </span>
          </span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-zinc-400"
          />
        </button>
        <button
          type="button"
          onClick={() =>
            document
              .getElementById("fin-saldos-e-analises")
              ?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          className="flex min-h-14 items-center gap-3 rounded-2xl px-3 text-left text-sm text-white hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <Scale aria-hidden="true" className="size-5 shrink-0 text-blue-300" />
          <span className="flex-1">Ver saldos e análises da Visão</span>
          <ChevronRight
            aria-hidden="true"
            className="size-4 shrink-0 text-zinc-400"
          />
        </button>
      </div>

      <CartaoSecao
        id="fin-saldos-e-analises"
        titulo="Saldo por conta"
        subtitulo="Todas as contas da loja, hoje"
      >
        <ul aria-label="Saldo por conta" className="flex flex-col gap-4">
          {dados.contas.map((conta) => (
            <li
              key={conta.id}
              className={`flex min-w-0 flex-wrap items-center gap-3 p-3 ${CLASSE_CASCA_DO_CARTAO}`}
            >
              <span
                className={`flex min-w-0 flex-1 items-center gap-3 ${CLASSE_ROTULO_DO_CARTAO}`}
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    color: matizDoTipoDeConta(conta.tipo),
                    backgroundColor: `${matizDoTipoDeConta(conta.tipo)}1A`,
                    borderColor: `${matizDoTipoDeConta(conta.tipo)}40`,
                  }}
                >
                  <IconeDoTipoDeConta tipo={conta.tipo} className="size-5" />
                </span>
                <span className="break-words">{conta.nome}</span>
              </span>
              <Dinheiro
                valor={conta.saldo}
                className={`text-base font-bold ${corDoValor(conta.saldo)}`}
              />
              <span className="sr-only">{rotuloDoTipoDeConta(conta.tipo)}</span>
            </li>
          ))}
        </ul>
        {dados.contas.length === 0 ? (
          <p className="text-sm text-zinc-400">Nenhuma conta ainda.</p>
        ) : null}
      </CartaoSecao>

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
            marco={marco}
          />
        )}
      </CartaoSecao>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
        <RecebimentosPorForma resumo={dados} />
        <AppVersusLoja resumo={dados} />
      </div>

      {caixa ? (
        <p className="text-xs text-zinc-400">
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

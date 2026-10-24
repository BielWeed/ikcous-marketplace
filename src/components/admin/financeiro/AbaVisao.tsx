import {
  ChevronRight,
  Minus,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { type useCaixaAtual, useResumoFinanceiro } from "@/hooks/useFinanceiro";
import {
  formatarPercentual,
  marcoDoSaldoInicial,
  paraCentavos,
  rotuloDaForma,
  rotuloDoTipoDeConta,
  serieDoFluxoDeCaixa,
  ultimos30Dias,
} from "@/lib/financeiro";
import { classeDoTexto, tomDoValor } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type {
  ContaFinanceira,
  DataIso,
  IntervaloDeDatas,
  ResumoFinanceiro,
  TotaisPrevistos,
} from "@/types/financeiro";
import { CaixaDeHoje } from "./CaixaDeHoje";
import { FluxoDeCaixaGrafico } from "./FluxoDeCaixaGrafico";
import { IconeDaForma, corDaForma } from "./IconeDaForma";
import { IconeDoTipoDeConta } from "./icones";
import type {
  AbaDoFinanceiro,
  AbrirFolha,
  LadoDosPrevistos,
} from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CartaoSecao,
  Dinheiro,
  EstadoDeErro,
  EstadoVazio,
  corDoValor,
  useValoresEstaoOcultos,
} from "./partes";
import {
  classeDoValorGrande,
  comprimentoDoValor,
  tamanhoDeMeiaLargura,
} from "./tamanhoDoValor";

const COR_APP = "#38bdf8";
const COR_LOJA = "#FF8BB2";

/** Superfície dos cartões da Visão (mesma dos `CartaoSecao`). */
const CLASSE_CARTAO =
  "min-w-0 rounded-3xl border border-admin-border bg-admin-surface p-3";

/**
 * Valor em dinheiro NUNCA quebra de linha (`whitespace-nowrap`): quem se ajusta
 * é o tamanho da letra, pelo número de caracteres do texto que a tela mostra
 * ("+R$ 453,88" = 10; oculto, o da máscara). As faixas e o comprimento moram
 * em `tamanhoDoValor`.
 */
function classeDoValorNoCartao(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  return cn(
    "whitespace-nowrap font-bold",
    tamanhoDeMeiaLargura(comprimentoDoValor(valor, comSinal, ocultos)),
  );
}

/** Valor do cartão-herói: largura cheia, encolhe só quando o texto é muito longo. */
function classeDoValorDoHeroi(valor: number, ocultos: boolean): string {
  return classeDoValorGrande(comprimentoDoValor(valor, false, ocultos));
}

/** Saldo de conta: neutro quando positivo (não é novidade), vermelho se negativo. */
function corDoSaldoDaConta(saldo: number): string {
  return paraCentavos(saldo) > 0 ? "text-white" : corDoValor(saldo);
}

/** Rótulo pequeno em caixa alta dos cartões de número. */
const CLASSE_ROTULO_CAIXA_ALTA =
  "text-xs font-semibold uppercase tracking-wide text-zinc-400";

/**
 * Resultado do período (entradas − saídas) em etiqueta: verde com seta para
 * cima quando positivo, vermelho com seta para baixo quando negativo, cinza no
 * zero. O sinal vem escrito no valor — a cor nunca é a única pista.
 */
function EtiquetaDoResultado({ resultado }: { readonly resultado: number }) {
  const centavos = paraCentavos(resultado);
  const tom = tomDoValor(centavos);
  const Icone =
    tom === "positivo" ? TrendingUp : tom === "negativo" ? TrendingDown : Minus;
  return (
    <p
      data-resultado-do-periodo={tom}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
        tom === "positivo" && "bg-emerald-400/10",
        tom === "negativo" && "bg-red-400/10",
        tom === "neutro" && "bg-white/5",
        classeDoTexto(tom),
      )}
    >
      <Icone aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0">
        <Dinheiro valor={resultado} comSinal className="whitespace-nowrap" /> no
        período
      </span>
    </p>
  );
}

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
  const ocultos = useValoresEstaoOcultos();
  const temVencido = Math.round(totais.vencido * 100) > 0;
  return (
    <section aria-label={titulo} className="h-full">
      <button
        type="button"
        onClick={() => aoVer(lado)}
        className={cn(
          CLASSE_CARTAO,
          "flex h-full min-h-[7.5rem] w-full flex-col gap-1.5 text-left transition-colors hover:bg-admin-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
        )}
      >
        <span
          className={cn(CLASSE_ROTULO_CAIXA_ALTA, "flex items-center gap-0.5")}
        >
          {titulo}
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
        </span>
        <Dinheiro
          valor={totais.total}
          sentido={lado === "entrada" ? 1 : -1}
          className={cn(
            classeDoValorNoCartao(totais.total, true, ocultos),
            classeDoTexto(
              tomDoValor(totais.total, { invertido: lado === "saida" }),
            ),
          )}
        />
        <div className="flex min-w-0 flex-col gap-1 text-xs">
          {temVencido ? (
            <p
              data-vencido=""
              className={cn(
                "inline-flex w-fit max-w-full flex-wrap items-baseline gap-x-1 rounded-full bg-red-400/10 px-2 py-0.5 font-semibold",
                classeDoTexto("negativo"),
              )}
            >
              Vencido{" "}
              <Dinheiro valor={totais.vencido} className="whitespace-nowrap" />
            </p>
          ) : (
            <p className="text-zinc-400">Nada vencido</p>
          )}
          <p className="flex flex-wrap items-baseline gap-x-1 text-zinc-400">
            Próximos 7 dias{" "}
            <Dinheiro
              valor={totais.proximos7Dias}
              className="whitespace-nowrap"
            />
          </p>
        </div>
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
    <CartaoSecao titulo="Recebimentos por forma">
      {formas.length === 0 || total <= 0 ? (
        <p className="text-xs text-zinc-400">Nenhum recebimento no período.</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {formas.map((forma) => {
            const pct = (forma.valor / total) * 100;
            return (
              <li
                key={forma.forma ?? "sem-forma"}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="break-words font-semibold text-zinc-200">
                    <IconeDaForma forma={forma.forma} className="mr-1.5" />
                    {rotuloDaForma(forma.forma)}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400">
                    <Dinheiro
                      valor={forma.valor}
                      className="whitespace-nowrap text-sm font-bold text-white"
                    />{" "}
                    · {formatarPercentual(pct)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full"
                    data-barra-da-forma={forma.forma ?? ""}
                    style={{
                      width: `${Math.max(pct, 1.5)}%`,
                      backgroundColor: corDaForma(forma.forma),
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

/** Item da legenda da barra: ponto da cor do trecho, nome, valor e %. */
function ItemDaLegendaDoCanal({
  nome,
  cor,
  valor,
  percentual,
}: {
  readonly nome: string;
  readonly cor: string;
  readonly valor: number;
  readonly percentual: number;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
        <span
          data-ponto-do-canal
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ background: cor }}
        />
        <span className="min-w-0 break-words">{nome}</span>
      </dt>
      <dd className="mt-1 text-sm font-bold tabular-nums text-white">
        <Dinheiro valor={valor} className="whitespace-nowrap" />
        <span className="whitespace-nowrap font-normal text-zinc-400">
          {" "}
          · {formatarPercentual(percentual)}
        </span>
      </dd>
    </div>
  );
}

function AppVersusLoja({ resumo }: { readonly resumo: ResumoFinanceiro }) {
  const { online, presencial } = resumo.porCanal;
  const total = online + presencial;
  const pctApp = total > 0 ? (online / total) * 100 : 0;
  const pctLoja = total > 0 ? 100 - pctApp : 0;
  return (
    <CartaoSecao titulo="App × loja física">
      {total <= 0 ? (
        <p className="text-xs text-zinc-400">
          Nenhuma venda recebida no período.
        </p>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
            aria-hidden="true"
          >
            {online > 0 ? (
              <div
                data-trecho-do-canal
                className="h-full rounded-l-full"
                style={{ width: `${pctApp}%`, background: COR_APP }}
              />
            ) : null}
            {presencial > 0 ? (
              <div
                data-trecho-do-canal
                className="h-full rounded-r-full"
                style={{ width: `${pctLoja}%`, background: COR_LOJA }}
              />
            ) : null}
          </div>
          <dl data-canais-lado-a-lado className="grid grid-cols-2 gap-3">
            <ItemDaLegendaDoCanal
              nome="App"
              cor={COR_APP}
              valor={online}
              percentual={pctApp}
            />
            <ItemDaLegendaDoCanal
              nome="Loja física"
              cor={COR_LOJA}
              valor={presencial}
              percentual={pctLoja}
            />
          </dl>
        </div>
      )}
    </CartaoSecao>
  );
}

/** Esqueleto com a mesma pegada dos blocos reais (sem salto de layout). */
function EsqueletoDaVisao() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <Skeleton className="h-[12.8rem] rounded-[20px] bg-white/5" />
      <Skeleton className="h-[11.5rem] rounded-3xl bg-white/5" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[5.5rem] rounded-3xl bg-white/5" />
        <Skeleton className="h-[5.5rem] rounded-3xl bg-white/5" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-[7.5rem] rounded-3xl bg-white/5" />
        <Skeleton className="h-[7.5rem] rounded-3xl bg-white/5" />
      </div>
      <Skeleton className="h-16 rounded-full bg-white/5" />
      <Skeleton className="h-52 rounded-3xl bg-white/5" />
    </div>
  );
}

/**
 * Aba "Visão": o extrato de banco em uma tela — saldo total no cartão-herói,
 * o que entrou e saiu no período, o que vence, o estado da gaveta, o saldo por
 * conta, o fluxo de 30 dias, por onde o dinheiro entra e quanto vem do app e
 * da loja física. Só desenho: saldo, sinais e janelas vêm das mesmas contas
 * de sempre (`fin_resumo` + `src/lib/financeiro.ts`).
 */
export function AbaVisao({
  ativo,
  intervalo,
  hoje,
  versao,
  contas,
  caixa,
  abrirFolha,
  irParaAba,
  verPrevistos,
}: {
  readonly ativo: boolean;
  readonly intervalo: IntervaloDeDatas | null;
  readonly hoje: DataIso;
  readonly versao: number;
  readonly contas: readonly ContaFinanceira[];
  /** A MESMA leitura do caixa que a aba Caixa e o ponto da aba usam (uma só por tela). */
  readonly caixa: ReturnType<typeof useCaixaAtual>;
  readonly abrirFolha: AbrirFolha;
  readonly irParaAba: (aba: AbaDoFinanceiro) => void;
  readonly verPrevistos: (lado: LadoDosPrevistos) => void;
}) {
  const ocultos = useValoresEstaoOcultos();
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
  if (!dados) return <EsqueletoDaVisao />;

  // Saldo é texto neutro (a cor fica para a etiqueta do período); só um saldo
  // NEGATIVO ganha vermelho, porque aí a cor significa algo.
  const saldoNegativo = paraCentavos(dados.saldoTotal) < 0;

  return (
    <div className="flex flex-col gap-4">
      {resumo.erro ? (
        <EstadoDeErro
          mensagem={resumo.erro}
          aoTentarDeNovo={resumo.recarregar}
        />
      ) : null}

      <CaixaDeHoje
        consulta={caixa}
        abrirFolha={abrirFolha}
        irParaAba={irParaAba}
      />

      <section
        aria-label="Saldo total"
        className="flex flex-col items-start gap-3 rounded-3xl border border-admin-border bg-admin-surface p-5"
      >
        <h2 className={CLASSE_ROTULO_CAIXA_ALTA}>Saldo total · hoje</h2>
        <Dinheiro
          valor={dados.saldoTotal}
          className={cn(
            classeDoValorDoHeroi(dados.saldoTotal, ocultos),
            saldoNegativo ? classeDoTexto("negativo") : "text-white",
          )}
        />
        <EtiquetaDoResultado resultado={dados.resultado} />
        <p className="text-xs text-zinc-400">
          Soma de todas as contas da loja, hoje
        </p>
      </section>

      <section aria-label="Movimentos do período">
        <dl className="grid grid-cols-2 gap-3">
          <div className={CLASSE_CARTAO}>
            <dt className={CLASSE_ROTULO_CAIXA_ALTA}>Entradas</dt>
            <dd className="mt-2">
              <Dinheiro
                valor={dados.entradas}
                sentido={paraCentavos(dados.entradas) > 0 ? 1 : 0}
                className={cn(
                  classeDoValorNoCartao(
                    dados.entradas,
                    paraCentavos(dados.entradas) > 0,
                    ocultos,
                  ),
                  corDoValor(dados.entradas),
                )}
              />
            </dd>
          </div>
          <div className={CLASSE_CARTAO}>
            <dt className={CLASSE_ROTULO_CAIXA_ALTA}>Saídas</dt>
            <dd className="mt-2">
              <Dinheiro
                valor={dados.saidas}
                sentido={paraCentavos(dados.saidas) > 0 ? -1 : 0}
                className={cn(
                  classeDoValorNoCartao(
                    dados.saidas,
                    paraCentavos(dados.saidas) > 0,
                    ocultos,
                  ),
                  corDoValor(-dados.saidas),
                )}
              />
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-2 gap-3">
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
      ) : (
        <CartaoSecao titulo="Saldo por conta">
          <ul aria-label="Saldo por conta" className="flex flex-col">
            {dados.contas.map((conta) => (
              <li
                key={conta.id}
                className="flex min-h-12 min-w-0 items-center justify-between gap-3 border-t border-admin-border py-2 first:border-t-0"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm text-zinc-200">
                  <IconeDoTipoDeConta
                    tipo={conta.tipo}
                    className="size-4 shrink-0 text-zinc-400"
                  />
                  <span className="break-words">{conta.nome}</span>
                </span>
                <Dinheiro
                  valor={conta.saldo}
                  className={cn(
                    "shrink-0 whitespace-nowrap text-sm font-bold",
                    corDoSaldoDaConta(conta.saldo),
                  )}
                />
                <span className="sr-only">
                  {rotuloDoTipoDeConta(conta.tipo)}
                </span>
              </li>
            ))}
          </ul>
        </CartaoSecao>
      )}

      <CartaoSecao titulo="Fluxo de caixa · últimos 30 dias">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecebimentosPorForma resumo={dados} />
        <AppVersusLoja resumo={dados} />
      </div>

      <p className="text-xs text-zinc-400">
        Vendas entram no dia em que o pagamento foi recebido (horário de
        Brasília).
      </p>
    </div>
  );
}

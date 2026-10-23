import { Plus, ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";

import { useExtratoFinanceiro } from "@/hooks/useFinanceiro";
import {
  type DiaDoExtrato,
  agruparExtratoPorDia,
  formatarDiaPorExtenso,
  paraCentavos,
  rotuloDaOrigem,
  sentidoDoLancamento,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type {
  ContaFinanceira,
  DataIso,
  IntervaloDeDatas,
  LinhaDoExtrato,
} from "@/types/financeiro";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
  Segmentado,
  corDoValor,
} from "./partes";
import {
  CLASSE_CARTAO_DA_LISTA,
  CLASSE_CARTAO_DO_TOPO,
  CLASSE_ROTULO_CAIXA_ALTA,
  ChipDaConta,
  EsqueletoDoTopo,
  ParDoTopo,
  classeDoValorDaLinha,
  classeDoValorDoTopo,
  tituloDoDia,
} from "./partesDoExtrato";

type FiltroDoTipo = "todos" | "entradas" | "saidas" | "previstos";

function passaNoFiltro(
  linha: LinhaDoExtrato,
  filtro: FiltroDoTipo,
  contaFiltrada: string | null,
): boolean {
  if (filtro === "todos") return true;
  if (filtro === "previstos") return linha.status === "previsto";
  const sentido = sentidoDoLancamento(linha, contaFiltrada);
  return filtro === "entradas" ? sentido > 0 : sentido < 0;
}

function LinhaDoExtratoItem({
  linha,
  contaFiltrada,
  aoAbrir,
}: {
  readonly linha: LinhaDoExtrato;
  readonly contaFiltrada: string | null;
  readonly aoAbrir: (linha: LinhaDoExtrato) => void;
}) {
  const sentido = sentidoDoLancamento(linha, contaFiltrada);
  const previsto = linha.status === "previsto";
  const cancelado = linha.status === "cancelado";
  const conta =
    linha.tipo === "transferencia"
      ? `${linha.contaNome ?? "—"} → ${linha.contaDestinoNome ?? "—"}`
      : (linha.contaNome ?? "—");
  const categoria =
    linha.tipo === "transferencia"
      ? "Transferência"
      : (linha.categoriaNome ?? rotuloDaOrigem(linha.origem));
  // Previsto e cancelado ficam de fora dos totais (só o realizado conta).
  const foraDoTotal = previsto || cancelado;

  return (
    <li className="border-t border-solid border-admin-border first:border-t-0">
      <button
        type="button"
        onClick={() => aoAbrir(linha)}
        className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block break-words text-base font-semibold leading-snug text-white",
              cancelado && "line-through",
            )}
          >
            {linha.descricao}
            {previsto ? (
              <span className="ml-2 align-middle">
                <Etiqueta tom="aviso">Previsto</Etiqueta>
              </span>
            ) : null}
            {cancelado ? (
              <span className="ml-2 align-middle">
                <Etiqueta tom="perigo">Cancelado</Etiqueta>
              </span>
            ) : null}
          </span>
          <span className="mt-1 block break-words text-sm leading-snug text-zinc-400">
            {categoria} · {conta}
            {foraDoTotal ? " · não entra no total" : ""}
          </span>
        </span>
        <Dinheiro
          valor={linha.valor}
          sentido={sentido}
          className={cn(
            classeDoValorDaLinha(linha.valor, sentido !== 0),
            foraDoTotal
              ? "text-zinc-400"
              : sentido === 0
                ? "text-zinc-300"
                : corDoValor(sentido),
            cancelado && "line-through",
          )}
        />
      </button>
    </li>
  );
}

function CabecalhoDoDia({
  grupo,
  hoje,
}: { readonly grupo: DiaDoExtrato; readonly hoje: DataIso }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-2 pt-4">
      <h3 className="min-w-0 text-base font-bold text-white">
        {tituloDoDia(grupo.dia, hoje, formatarDiaPorExtenso(grupo.dia))}
      </h3>
      <p className="flex flex-wrap items-baseline justify-end gap-x-3 text-sm text-zinc-400">
        <span className="whitespace-nowrap">
          Dia{" "}
          <Dinheiro
            valor={grupo.resultado}
            comSinal
            className={cn(
              "whitespace-nowrap font-semibold",
              corDoValor(grupo.resultado),
            )}
          />
        </span>
        {grupo.saldoAoFim !== null ? (
          <span className="whitespace-nowrap">
            Saldo{" "}
            <Dinheiro
              valor={grupo.saldoAoFim}
              className="whitespace-nowrap font-semibold text-zinc-200"
            />
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Aba "Extrato": tudo o que entrou e saiu (e o que está previsto), agrupado
 * por dia, com o total do dia. Com uma conta escolhida e o período chegando
 * até hoje, cada dia mostra também o saldo da conta ao fim dele.
 */
export function AbaExtrato({
  ativo,
  intervalo,
  hoje,
  versao,
  contas,
  rotuloDoPeriodo,
  abrirFolha,
  aoNovoLancamento,
}: {
  readonly ativo: boolean;
  readonly intervalo: IntervaloDeDatas | null;
  readonly hoje: DataIso;
  readonly versao: number;
  readonly contas: readonly ContaFinanceira[];
  readonly rotuloDoPeriodo: string;
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento: () => void;
}) {
  const [contaId, setContaId] = useState("");
  const [filtro, setFiltro] = useState<FiltroDoTipo>("todos");
  const contaFiltrada = contaId || null;
  const extrato = useExtratoFinanceiro(intervalo, contaFiltrada, ativo, versao);

  const conta = contas.find((c) => c.id === contaFiltrada) ?? null;
  const saldoAtual =
    conta && intervalo && intervalo.fim >= hoje ? conta.saldo : null;

  const grupos = useMemo(
    () =>
      extrato.dados
        ? agruparExtratoPorDia(extrato.dados, { contaFiltrada, saldoAtual })
        : [],
    [extrato.dados, contaFiltrada, saldoAtual],
  );

  const visiveis = useMemo(
    () =>
      grupos
        .map((grupo) => ({
          grupo,
          linhas: grupo.linhas.filter((l) =>
            passaNoFiltro(l, filtro, contaFiltrada),
          ),
        }))
        .filter((g) => g.linhas.length > 0),
    [grupos, filtro, contaFiltrada],
  );

  const totais = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    for (const g of grupos) {
      entradas += paraCentavos(g.entradas);
      saidas += paraCentavos(g.saidas);
    }
    return {
      entradas: entradas / 100,
      saidas: saidas / 100,
      resultado: (entradas - saidas) / 100,
    };
  }, [grupos]);

  const quantidade = visiveis.reduce((soma, g) => soma + g.linhas.length, 0);
  const houveEntrada = paraCentavos(totais.entradas) > 0;
  const houveSaida = paraCentavos(totais.saidas) > 0;

  return (
    <div className="flex flex-col gap-4">
      {extrato.erro && !extrato.dados ? null : !extrato.dados ? (
        <EsqueletoDoTopo />
      ) : (
        <section
          aria-label="Resultado do período"
          className={CLASSE_CARTAO_DO_TOPO}
        >
          <h2 className={CLASSE_ROTULO_CAIXA_ALTA}>
            {rotuloDoPeriodo} · só o realizado
          </h2>
          <Dinheiro
            valor={totais.resultado}
            comSinal
            className={cn(
              classeDoValorDoTopo(totais.resultado, true),
              corDoValor(totais.resultado),
            )}
          />
          <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <ParDoTopo rotulo="Entrou">
              <Dinheiro
                valor={totais.entradas}
                sentido={houveEntrada ? 1 : 0}
                className={cn(
                  "whitespace-nowrap text-sm font-bold",
                  corDoValor(totais.entradas),
                )}
              />
            </ParDoTopo>
            <ParDoTopo rotulo="Saiu">
              <Dinheiro
                valor={totais.saidas}
                sentido={houveSaida ? -1 : 0}
                className={cn(
                  "whitespace-nowrap text-sm font-bold",
                  corDoValor(-totais.saidas),
                )}
              />
            </ParDoTopo>
          </dl>
          {conta && saldoAtual === null ? (
            <p className="text-xs leading-relaxed text-zinc-400">
              O saldo por dia aparece quando o período chega até hoje.
            </p>
          ) : null}
        </section>
      )}

      <ChipDaConta
        id="fin-extrato-conta"
        valor={contaId}
        aoMudar={setContaId}
        contas={contas}
      />
      <Segmentado<FiltroDoTipo>
        rotulo="Mostrar"
        valor={filtro}
        aoMudar={setFiltro}
        className="lg:max-w-xl"
        opcoes={[
          { valor: "todos", rotulo: "Tudo" },
          { valor: "entradas", rotulo: "Entradas" },
          { valor: "saidas", rotulo: "Saídas" },
          { valor: "previstos", rotulo: "Previstos" },
        ]}
      />

      {extrato.erro && !extrato.dados ? (
        <EstadoDeErro
          mensagem={extrato.erro}
          aoTentarDeNovo={extrato.recarregar}
        />
      ) : !extrato.dados ? (
        <EsqueletoDeLista linhas={6} />
      ) : quantidade === 0 ? (
        <EstadoVazio
          icone={ReceiptText}
          titulo={
            extrato.dados.length === 0
              ? "Nenhum lançamento no período"
              : "Nada com esse filtro"
          }
          texto={
            extrato.dados.length === 0
              ? "Vendas pagas aparecem aqui sozinhas. Aluguel, fornecedor e outras contas você lança à mão."
              : "Mude Conta ou Mostrar acima. Vendas pagas aparecem aqui sozinhas; outras contas você lança à mão."
          }
          acao={
            <button
              type="button"
              onClick={aoNovoLancamento}
              className={CLASSE_BOTAO_SECUNDARIO}
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo lançamento
            </button>
          }
        />
      ) : (
        <>
          {extrato.erro ? (
            <EstadoDeErro
              mensagem={extrato.erro}
              aoTentarDeNovo={extrato.recarregar}
            />
          ) : null}
          <div
            role="group"
            aria-label={`${quantidade} ${quantidade === 1 ? "lançamento" : "lançamentos"}`}
            className="flex flex-col gap-3"
          >
            {visiveis.map(({ grupo, linhas }) => (
              <section
                key={grupo.dia}
                aria-label={formatarDiaPorExtenso(grupo.dia)}
                className={cn(CLASSE_CARTAO_DA_LISTA, "px-4 pb-1")}
              >
                <CabecalhoDoDia grupo={grupo} hoje={hoje} />
                <ul className="flex flex-col">
                  {linhas.map((linha) => (
                    <LinhaDoExtratoItem
                      key={linha.id}
                      linha={linha}
                      contaFiltrada={contaFiltrada}
                      aoAbrir={(l) => abrirFolha({ tipo: "detalhe", linha: l })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {filtro !== "todos" ? (
            <p className="text-xs leading-relaxed text-zinc-400">
              Os totais e o total do dia não mudam ao filtrar Mostrar.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

import { ChevronRight, Plus, ReceiptText } from "lucide-react";
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
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type {
  ContaFinanceira,
  DataIso,
  IntervaloDeDatas,
  LinhaDoExtrato,
} from "@/types/financeiro";
import { IconeDaOrigem } from "./icones";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  CLASSE_CASCA_DO_CARTAO,
  CLASSE_ROTULO_DO_CARTAO,
  Campo,
  CartaoSecao,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
  Segmentado,
  corDoValor,
} from "./partes";

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

  return (
    <li>
      <button
        type="button"
        onClick={() => aoAbrir(linha)}
        className={cn(
          "group relative flex min-h-14 w-full flex-col items-stretch gap-3 rounded-3xl border border-admin-border bg-admin-surface p-4 text-left transition-colors hover:bg-admin-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center lg:gap-4",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl border",
              sentido > 0 &&
                "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
              sentido < 0 && "border-red-500/20 bg-red-500/10 text-red-300",
              sentido === 0 &&
                "border-violet-400/25 bg-violet-400/10 text-violet-300",
            )}
          >
            <IconeDaOrigem
              origem={linha.origem}
              tipo={linha.tipo}
              className="size-4"
            />
          </span>
          <span className="min-w-0">
            <span
              className={cn(
                "block break-words pr-4 text-sm font-bold leading-relaxed text-white",
                cancelado && "line-through",
              )}
            >
              {linha.descricao}
            </span>
            <span className="mt-1 block break-words text-xs leading-relaxed text-zinc-400 lg:hidden">
              {categoria} · {conta}
            </span>
          </span>
        </span>
        <span className="hidden break-words text-xs text-zinc-400 lg:block">
          {categoria}
        </span>
        <span className="hidden break-words text-xs text-zinc-400 lg:block">
          {conta}
        </span>
        <span className="flex min-w-0 flex-col items-start gap-2 lg:items-end">
          <Dinheiro
            valor={linha.valor}
            sentido={sentido}
            className={cn(
              "text-2xl font-bold lg:text-base",
              cancelado
                ? "text-zinc-400 line-through"
                : sentido === 0
                  ? "text-violet-300"
                  : corDoValor(sentido),
              previsto && classeDoTexto("atencao"),
            )}
          />
          {previsto ? <Etiqueta tom="aviso">Previsto</Etiqueta> : null}
          {cancelado ? <Etiqueta tom="perigo">Cancelado</Etiqueta> : null}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="absolute right-4 top-4 size-4 text-zinc-400 lg:hidden"
        />
      </button>
    </li>
  );
}

function CabecalhoDoDia({ grupo }: { readonly grupo: DiaDoExtrato }) {
  return (
    <div className="mb-3 flex flex-col gap-2 px-1 lg:flex-row lg:flex-wrap lg:items-baseline lg:justify-between">
      <h3 className="text-xs font-black text-zinc-300">
        {formatarDiaPorExtenso(grupo.dia)}
      </h3>
      <p className="flex flex-wrap items-baseline gap-3 text-xs text-zinc-400">
        <span>
          Resultado{" "}
          <Dinheiro
            valor={grupo.resultado}
            comSinal
            className={cn("font-black", corDoValor(grupo.resultado))}
          />
        </span>
        {grupo.saldoAoFim !== null ? (
          <span>
            Saldo{" "}
            <Dinheiro
              valor={grupo.saldoAoFim}
              className="font-black text-zinc-200"
            />
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Aba "Extrato": tudo o que entrou e saiu (e o que está previsto), agrupado
 * por dia, com o resultado do dia. Com uma conta escolhida e o período
 * chegando até hoje, cada dia mostra também o saldo da conta ao fim dele.
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
    return { entradas: entradas / 100, saidas: saidas / 100 };
  }, [grupos]);

  const quantidade = visiveis.reduce((soma, g) => soma + g.linhas.length, 0);

  return (
    <div className="flex flex-col gap-7">
      <CartaoSecao className="border-0 bg-transparent p-0 sm:p-0">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <Campo id="fin-extrato-conta" rotulo="Conta" className="lg:w-64">
            <select
              id="fin-extrato-conta"
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              className={CLASSE_CAMPO}
            >
              <option value="">Todas as contas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.ativa ? "" : " (inativa)"}
                </option>
              ))}
            </select>
          </Campo>
          <Segmentado<FiltroDoTipo>
            rotulo="Mostrar"
            valor={filtro}
            aoMudar={setFiltro}
            className="lg:flex-1"
            opcoes={[
              { valor: "todos", rotulo: "Tudo" },
              { valor: "entradas", rotulo: "Entradas" },
              { valor: "saidas", rotulo: "Saídas" },
              { valor: "previstos", rotulo: "Previstos" },
            ]}
          />
        </div>
        <dl
          className={`mt-7 flex flex-col gap-4 p-4 ${CLASSE_CASCA_DO_CARTAO}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className={CLASSE_ROTULO_DO_CARTAO}>Entrou</dt>
            <dd className="text-sm font-bold text-emerald-300">
              <Dinheiro valor={totais.entradas} sentido={1} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className={CLASSE_ROTULO_DO_CARTAO}>Saiu</dt>
            <dd className="text-sm font-bold text-red-300">
              <Dinheiro valor={totais.saidas} sentido={-1} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className={CLASSE_ROTULO_DO_CARTAO}>Resultado</dt>
            <dd
              className={cn(
                "text-2xl font-bold",
                corDoValor(totais.entradas - totais.saidas),
              )}
            >
              <Dinheiro valor={totais.entradas - totais.saidas} comSinal />
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-relaxed text-zinc-400">
          {rotuloDoPeriodo} · só o realizado entra nos totais
          {conta && saldoAtual === null
            ? " · o saldo por dia aparece quando o período chega até hoje"
            : ""}
        </p>
      </CartaoSecao>

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
        <CartaoSecao
          titulo={`${quantidade} ${quantidade === 1 ? "lançamento" : "lançamentos"}`}
          className="border-0 bg-transparent p-0 sm:p-0"
        >
          {extrato.erro ? (
            <div className="mb-3">
              <EstadoDeErro
                mensagem={extrato.erro}
                aoTentarDeNovo={extrato.recarregar}
              />
            </div>
          ) : null}
          <div
            aria-hidden="true"
            className="hidden border-b border-admin-border px-3 pb-2 text-xs font-black uppercase tracking-[0.2em] text-zinc-400 lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-4"
          >
            <span>Descrição</span>
            <span>Categoria</span>
            <span>Conta</span>
            <span className="text-right">Valor</span>
          </div>
          <div className="flex flex-col gap-5 lg:mt-3">
            {visiveis.map(({ grupo, linhas }) => (
              <section
                key={grupo.dia}
                aria-label={formatarDiaPorExtenso(grupo.dia)}
              >
                <CabecalhoDoDia grupo={grupo} />
                <ul className="mt-3 flex flex-col gap-3">
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
          <p className="mt-5 rounded-2xl bg-sky-400/5 p-3 text-xs leading-relaxed text-zinc-400">
            Os totais e o resultado completo do dia não mudam ao filtrar
            Mostrar. O saldo diário aparece com uma conta escolhida e o período
            chegando até hoje.
          </p>
        </CartaoSecao>
      )}
    </div>
  );
}

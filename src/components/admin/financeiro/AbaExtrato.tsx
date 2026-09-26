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
import { IconeDaOrigem } from "./icones";
import type { AbrirFolha } from "./navegacao";
import {
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_CAMPO,
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
          "group flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-white/[0.04] lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-4 lg:px-3",
          (previsto || cancelado) && "opacity-70",
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl border",
              sentido > 0 &&
                "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
              sentido < 0 && "border-red-500/20 bg-red-500/10 text-red-300",
              sentido === 0 && "border-white/10 bg-white/5 text-zinc-300",
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
                "block truncate text-sm font-bold text-white",
                cancelado && "line-through",
              )}
            >
              {linha.descricao}
            </span>
            <span className="block truncate text-[11px] text-zinc-500 lg:hidden">
              {categoria} · {conta}
            </span>
          </span>
        </span>
        <span className="hidden truncate text-xs text-zinc-400 lg:block">
          {categoria}
        </span>
        <span className="hidden truncate text-xs text-zinc-400 lg:block">
          {conta}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <Dinheiro
            valor={linha.valor}
            sentido={sentido}
            className={cn(
              "text-sm font-black",
              cancelado
                ? "text-zinc-500 line-through"
                : sentido === 0
                  ? "text-zinc-300"
                  : corDoValor(sentido),
              previsto && "opacity-80",
            )}
          />
          {previsto ? <Etiqueta tom="aviso">Previsto</Etiqueta> : null}
          {cancelado ? <Etiqueta tom="perigo">Cancelado</Etiqueta> : null}
        </span>
      </button>
    </li>
  );
}

function CabecalhoDoDia({ grupo }: { readonly grupo: DiaDoExtrato }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-white/5 px-2 pb-2 lg:px-3">
      <h3 className="text-xs font-black text-zinc-300">
        {formatarDiaPorExtenso(grupo.dia)}
      </h3>
      <p className="flex items-baseline gap-3 text-[11px] text-zinc-500">
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
    <div className="flex flex-col gap-4">
      <CartaoSecao>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex flex-col gap-1.5 lg:w-64">
            <label
              htmlFor="fin-extrato-conta"
              className="text-xs font-bold text-zinc-300"
            >
              Conta
            </label>
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
          </div>
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
        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2">
            <dt className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Entrou
            </dt>
            <dd className="text-sm font-black text-emerald-300">
              <Dinheiro valor={totais.entradas} sentido={1} />
            </dd>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2">
            <dt className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Saiu
            </dt>
            <dd className="text-sm font-black text-red-300">
              <Dinheiro valor={totais.saidas} sentido={-1} />
            </dd>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-2">
            <dt className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
              Resultado
            </dt>
            <dd
              className={cn(
                "text-sm font-black",
                corDoValor(totais.entradas - totais.saidas),
              )}
            >
              <Dinheiro valor={totais.entradas - totais.saidas} comSinal />
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-zinc-500">
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
          texto="Vendas pagas aparecem aqui sozinhas. Aluguel, fornecedor e outras contas você lança à mão."
          acao={
            <button
              type="button"
              onClick={aoNovoLancamento}
              className={CLASSE_BOTAO_PRIMARIO}
            >
              <Plus aria-hidden="true" className="size-4" />
              Novo lançamento
            </button>
          }
        />
      ) : (
        <CartaoSecao
          titulo={`${quantidade} ${quantidade === 1 ? "lançamento" : "lançamentos"}`}
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
            className="hidden border-b border-white/5 px-3 pb-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 lg:grid lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:gap-4"
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
                <ul className="mt-1 flex flex-col">
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
        </CartaoSecao>
      )}
    </div>
  );
}

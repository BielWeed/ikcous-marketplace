import { CalendarClock, ExternalLink, Info, Plus } from "lucide-react";
import { useMemo } from "react";

import { usePrevistosFinanceiros } from "@/hooks/useFinanceiro";
import {
  type SituacaoDoVencimento,
  formatarData,
  ordenarPorVencimento,
  previstoEhEditavel,
  rotuloDaOrigem,
  situacaoDoVencimento,
  textoDoVencimento,
  totaisDosPrevistos,
} from "@/lib/financeiro";
import { cn } from "@/lib/utils";
import type { DataIso, LancamentoPrevisto } from "@/types/financeiro";
import type { AbrirFolha, LadoDosPrevistos } from "./navegacao";
import {
  BlocoKpi,
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_TITULO_SECAO,
  Dinheiro,
  EsqueletoDeKpis,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Etiqueta,
  Segmentado,
} from "./partes";

const SECOES: readonly { situacao: SituacaoDoVencimento; titulo: string }[] = [
  { situacao: "vencido", titulo: "Vencidos" },
  { situacao: "hoje", titulo: "Vencem hoje" },
  { situacao: "semana", titulo: "Próximos 7 dias" },
  { situacao: "depois", titulo: "Mais adiante" },
  { situacao: "sem_data", titulo: "Sem vencimento" },
];

function NotaDoNaoEditavel({ item }: { readonly item: LancamentoPrevisto }) {
  const texto =
    item.origem === "estorno" || item.origem === "estorno_externo"
      ? "Estorno em andamento: sai da conta sozinho quando o Mercado Pago concluir."
      : item.origem === "devolucao"
        ? "Devolução em andamento: o valor sai quando a devolução for concluída."
        : `${rotuloDaOrigem(item.origem)}: vem do pedido, o Financeiro só acompanha.`;
  return (
    <p className="mt-3 flex items-start gap-2 text-[11px] text-zinc-400">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {texto}
    </p>
  );
}

function CartaoDoPrevisto({
  item,
  lado,
  hoje,
  abrirFolha,
  aoAbrirPedido,
}: {
  readonly item: LancamentoPrevisto;
  readonly lado: LadoDosPrevistos;
  readonly hoje: DataIso;
  readonly abrirFolha: AbrirFolha;
  readonly aoAbrirPedido: (pedidoId: string) => void;
}) {
  const situacao = situacaoDoVencimento(item.vencimento, hoje);
  const vencido = situacao === "vencido";
  const editavel = previstoEhEditavel(item);
  const parcela =
    item.parcela !== null && item.parcelas !== null && item.parcelas > 1
      ? `${item.parcela}/${item.parcelas}`
      : null;

  return (
    <li
      className={cn(
        "flex flex-col rounded-2xl border p-4",
        vencido
          ? "border-red-500/30 bg-red-500/[0.06]"
          : situacao === "hoje"
            ? "border-amber-500/30 bg-amber-500/[0.05]"
            : "border-white/5 bg-white/[0.02]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <span className="truncate">{item.descricao}</span>
            {parcela ? <Etiqueta>{parcela}</Etiqueta> : null}
          </p>
          <p className="truncate text-[11px] text-zinc-500">
            {item.categoriaNome ?? rotuloDaOrigem(item.origem)} ·{" "}
            {item.contaNome ?? "—"}
          </p>
          <p
            className={cn(
              "mt-1 flex items-center gap-1.5 text-[11px] font-bold",
              vencido
                ? "text-red-300"
                : situacao === "hoje"
                  ? "text-amber-200"
                  : "text-zinc-400",
            )}
          >
            <CalendarClock aria-hidden="true" className="size-3.5" />
            {textoDoVencimento(item.vencimento, hoje)}
            {item.vencimento && situacao !== "depois" ? (
              <span className="font-normal text-zinc-500">
                · {formatarData(item.vencimento)}
              </span>
            ) : null}
          </p>
        </div>
        <Dinheiro
          valor={item.valor}
          sentido={lado === "entrada" ? 1 : -1}
          className={cn(
            "shrink-0 text-base font-black",
            lado === "entrada" ? "text-emerald-300" : "text-red-300",
          )}
        />
      </div>
      {editavel ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() =>
              abrirFolha({
                tipo: "baixar",
                alvo: {
                  id: item.id,
                  descricao: item.descricao,
                  valor: item.valor,
                  contaId: item.contaId,
                  lado,
                  vencimento: item.vencimento,
                },
              })
            }
            className={`${CLASSE_BOTAO_PRIMARIO} flex-1`}
          >
            Dar baixa
          </button>
          <button
            type="button"
            onClick={() =>
              abrirFolha({
                tipo: "cancelar",
                alvo: {
                  id: item.id,
                  descricao: item.descricao,
                  valor: item.valor,
                },
              })
            }
            className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <>
          <NotaDoNaoEditavel item={item} />
          {item.pedidoId ? (
            <button
              type="button"
              onClick={() => aoAbrirPedido(item.pedidoId ?? "")}
              className={`${CLASSE_BOTAO_SECUNDARIO} mt-3`}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Abrir pedido #{item.pedidoId.slice(-6)}
            </button>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * Aba "A pagar / A receber": o que ainda vai sair ou entrar, do vencimento
 * mais antigo para o mais novo. Vencido em vermelho, com o texto dizendo há
 * quantos dias — a cor nunca é a única pista.
 */
export function AbaPrevistos({
  ativo,
  hoje,
  versao,
  lado,
  aoMudarLado,
  abrirFolha,
  aoNovoLancamento,
  aoAbrirPedido,
}: {
  readonly ativo: boolean;
  readonly hoje: DataIso;
  readonly versao: number;
  readonly lado: LadoDosPrevistos;
  readonly aoMudarLado: (lado: LadoDosPrevistos) => void;
  readonly abrirFolha: AbrirFolha;
  readonly aoNovoLancamento: (lado: LadoDosPrevistos) => void;
  readonly aoAbrirPedido: (pedidoId: string) => void;
}) {
  const previstos = usePrevistosFinanceiros(lado, ativo, versao);
  const ordenados = useMemo(
    () => (previstos.dados ? ordenarPorVencimento(previstos.dados) : []),
    [previstos.dados],
  );
  const totais = useMemo(
    () => totaisDosPrevistos(ordenados, hoje),
    [ordenados, hoje],
  );
  const secoes = useMemo(
    () =>
      SECOES.map((secao) => ({
        ...secao,
        itens: ordenados.filter(
          (item) =>
            situacaoDoVencimento(item.vencimento, hoje) === secao.situacao,
        ),
      })).filter((secao) => secao.itens.length > 0),
    [ordenados, hoje],
  );
  const aReceber = lado === "entrada";

  return (
    <div className="flex flex-col gap-4">
      <Segmentado<LadoDosPrevistos>
        rotulo="A pagar ou a receber"
        valor={lado}
        aoMudar={aoMudarLado}
        className="lg:max-w-sm"
        opcoes={[
          { valor: "saida", rotulo: "A pagar" },
          { valor: "entrada", rotulo: "A receber" },
        ]}
      />

      {previstos.erro && !previstos.dados ? (
        <EstadoDeErro
          mensagem={previstos.erro}
          aoTentarDeNovo={previstos.recarregar}
        />
      ) : !previstos.dados ? (
        <>
          <EsqueletoDeKpis quantos={3} />
          <EsqueletoDeLista />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <BlocoKpi rotulo={aReceber ? "Total a receber" : "Total a pagar"}>
              <Dinheiro valor={totais.total} />
            </BlocoKpi>
            <BlocoKpi rotulo="Vencido">
              <Dinheiro
                valor={totais.vencido}
                className={totais.vencido > 0 ? "text-red-300" : undefined}
              />
            </BlocoKpi>
            <BlocoKpi
              rotulo="Próximos 7 dias"
              className="col-span-2 lg:col-span-1"
            >
              <Dinheiro valor={totais.proximos7Dias} />
            </BlocoKpi>
          </div>

          {previstos.erro ? (
            <EstadoDeErro
              mensagem={previstos.erro}
              aoTentarDeNovo={previstos.recarregar}
            />
          ) : null}

          {secoes.length === 0 ? (
            <EstadoVazio
              icone={CalendarClock}
              titulo={aReceber ? "Nada a receber" : "Nenhuma conta a pagar"}
              texto={
                aReceber
                  ? "Lance aqui o que alguém ainda vai te pagar (venda a prazo, aluguel de espaço)."
                  : "Lance aluguel, fornecedor e boletos com vencimento — o app avisa quando vencer."
              }
              acao={
                <button
                  type="button"
                  onClick={() => aoNovoLancamento(lado)}
                  className={CLASSE_BOTAO_PRIMARIO}
                >
                  <Plus aria-hidden="true" className="size-4" />
                  {aReceber ? "Lançar conta a receber" : "Lançar conta a pagar"}
                </button>
              }
            />
          ) : (
            secoes.map((secao) => (
              <section key={secao.situacao} aria-label={secao.titulo}>
                <h2
                  className={cn(
                    CLASSE_TITULO_SECAO,
                    "mb-2 px-1",
                    secao.situacao === "vencido" && "text-red-400",
                  )}
                >
                  {secao.titulo} · {secao.itens.length}
                </h2>
                <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {secao.itens.map((item) => (
                    <CartaoDoPrevisto
                      key={item.id}
                      item={item}
                      lado={lado}
                      hoje={hoje}
                      abrirFolha={abrirFolha}
                      aoAbrirPedido={aoAbrirPedido}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}

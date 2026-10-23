import { CalendarClock, ExternalLink, Plus } from "lucide-react";
import { useMemo } from "react";

import { usePrevistosFinanceiros } from "@/hooks/useFinanceiro";
import {
  type SituacaoDoVencimento,
  formatarData,
  ordenarPorVencimento,
  paraCentavos,
  previstoEhEditavel,
  rotuloDaOrigem,
  situacaoDoVencimento,
  textoDoVencimento,
  totaisDosPrevistos,
} from "@/lib/financeiro";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { DataIso, LancamentoPrevisto } from "@/types/financeiro";
import type { AbrirFolha, LadoDosPrevistos } from "./navegacao";
import {
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_TITULO_SECAO,
  Dinheiro,
  EsqueletoDeLista,
  EstadoDeErro,
  EstadoVazio,
  Segmentado,
} from "./partes";
import {
  CLASSE_CARTAO_DA_LISTA,
  CLASSE_CARTAO_DO_TOPO,
  CLASSE_PILULA_PRIMARIA,
  CLASSE_PILULA_SECUNDARIA,
  CLASSE_QUADRO_INTERNO,
  CLASSE_QUADRO_VENCIDO,
  CLASSE_ROTULO_CAIXA_ALTA,
  EsqueletoDoTopo,
  classeDoValorDaLinha,
  classeDoValorDoTopo,
  classeDoValorNoQuadro,
} from "./partesDoExtrato";

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
    <p className="mt-3 break-words text-sm leading-relaxed text-zinc-400">
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
  const editavel = previstoEhEditavel(item);
  const parcela =
    item.parcela !== null && item.parcelas !== null && item.parcelas > 1
      ? `${item.parcela}/${item.parcelas}`
      : null;

  return (
    <li className={cn(CLASSE_CARTAO_DA_LISTA, "flex flex-col p-4")}>
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 break-words text-base font-bold leading-snug text-white">
          {item.descricao}
          {parcela ? ` · ${parcela}` : ""}
        </p>
        <Dinheiro
          valor={item.valor}
          className={cn(classeDoValorDaLinha(item.valor, false), "text-white")}
        />
      </div>
      <p className="mt-1 break-words text-sm leading-snug text-zinc-400">
        {item.categoriaNome ?? rotuloDaOrigem(item.origem)} ·{" "}
        {item.contaNome ?? "—"}
      </p>
      {/* A cor só vem com significado (vencido = vermelho, hoje = âmbar) e o
          texto diz o mesmo: a cor nunca é a única pista. */}
      <p
        className={cn(
          "mt-1.5 text-sm font-medium",
          situacao === "vencido"
            ? classeDoTexto("negativo")
            : situacao === "hoje"
              ? classeDoTexto("atencao")
              : "text-zinc-300",
        )}
      >
        {textoDoVencimento(item.vencimento, hoje)}
        {item.vencimento && situacao !== "depois" ? (
          <span className="font-normal text-zinc-400">
            {" "}
            · {formatarData(item.vencimento)}
          </span>
        ) : null}
      </p>
      {editavel ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
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
            className={CLASSE_PILULA_PRIMARIA}
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
            className={CLASSE_PILULA_SECUNDARIA}
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
              className={cn(CLASSE_PILULA_SECUNDARIA, "mt-3 w-full gap-2")}
            >
              <ExternalLink aria-hidden="true" className="size-4 shrink-0" />
              Abrir pedido #{numeroDoPedido(item.pedidoId)}
            </button>
          ) : null}
        </>
      )}
    </li>
  );
}

/**
 * Aba "Pagar e receber": o que ainda vai sair ou entrar, do vencimento mais
 * antigo para o mais novo. Vencido em vermelho, com o texto dizendo há quantos
 * dias — a cor nunca é a única pista.
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
  const temVencido = paraCentavos(totais.vencido) > 0;

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
          <EsqueletoDoTopo altura="h-[13.5rem]" />
          <EsqueletoDeLista />
        </>
      ) : (
        <>
          <section
            aria-label={aReceber ? "Total a receber" : "Total a pagar"}
            className={CLASSE_CARTAO_DO_TOPO}
          >
            <h2 className={CLASSE_ROTULO_CAIXA_ALTA}>
              {aReceber ? "Total a receber" : "Total a pagar"}
            </h2>
            {/* Total sem cor de estado (ainda não saiu nem entrou); só o zero
                vira cinza, que é o "nada aqui". */}
            <Dinheiro
              valor={totais.total}
              className={cn(
                classeDoValorDoTopo(totais.total, false),
                paraCentavos(totais.total) > 0
                  ? "text-white"
                  : classeDoTexto("neutro"),
              )}
            />
            <dl className="grid w-full grid-cols-2 gap-3">
              <div
                className={
                  temVencido ? CLASSE_QUADRO_VENCIDO : CLASSE_QUADRO_INTERNO
                }
              >
                <dt className="text-xs text-zinc-300">Vencido</dt>
                <dd className="mt-1">
                  <Dinheiro
                    valor={totais.vencido}
                    className={cn(
                      classeDoValorNoQuadro(totais.vencido, false),
                      temVencido ? classeDoTexto("negativo") : "text-zinc-300",
                    )}
                  />
                </dd>
              </div>
              <div className={CLASSE_QUADRO_INTERNO}>
                <dt className="text-xs text-zinc-300">Próximos 7 dias</dt>
                <dd className="mt-1">
                  <Dinheiro
                    valor={totais.proximos7Dias}
                    className={cn(
                      classeDoValorNoQuadro(totais.proximos7Dias, false),
                      "text-white",
                    )}
                  />
                </dd>
              </div>
            </dl>
            <p className="text-xs text-zinc-400">
              De hoje até 7 dias à frente, inclusive.
            </p>
          </section>

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
                  : "Lance aluguel, fornecedor e boletos com vencimento."
              }
              acao={
                <button
                  type="button"
                  onClick={() => aoNovoLancamento(lado)}
                  className={CLASSE_BOTAO_SECUNDARIO}
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
                    "mb-3 px-1",
                    secao.situacao === "vencido" && classeDoTexto("negativo"),
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

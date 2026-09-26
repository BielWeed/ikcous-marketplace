import { ExternalLink, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { LocalBufferedTextarea } from "@/components/admin/LocalBufferedInput";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { baixarLancamento, cancelarLancamento } from "@/hooks/useFinanceiro";
import {
  ehDataIso,
  formatarData,
  mensagemDeErroFinanceiro,
  origemVemDoPedido,
  rotuloDaForma,
  rotuloDaOrigem,
  rotuloDoStatus,
  sentidoDoLancamento,
} from "@/lib/financeiro";
import type {
  ContaFinanceira,
  DataIso,
  LinhaDoExtrato,
} from "@/types/financeiro";
import { FolhaFinanceira } from "./FolhaFinanceira";
import { IconeDaOrigem } from "./icones";
import type { AlvoDaBaixa, AlvoDoCancelamento } from "./navegacao";
import {
  CLASSE_BOTAO_PERIGO,
  CLASSE_BOTAO_PRIMARIO,
  CLASSE_BOTAO_SECUNDARIO,
  CLASSE_CAMPO,
  Campo,
  Dinheiro,
  EstadoDeErro,
  Etiqueta,
  corDoValor,
} from "./partes";

/** Detalhe de uma linha do extrato, com as ações que ela permite. */
export function DetalheDoLancamentoFolha({
  linha,
  aoFechar,
  aoCancelar,
  aoBaixar,
  aoAbrirPedido,
}: {
  readonly linha: LinhaDoExtrato;
  readonly aoFechar: () => void;
  readonly aoCancelar: (alvo: AlvoDoCancelamento) => void;
  readonly aoBaixar: (alvo: AlvoDaBaixa) => void;
  readonly aoAbrirPedido: (pedidoId: string) => void;
}) {
  const sentido = sentidoDoLancamento(linha);
  const cancelado = linha.status === "cancelado";
  const podeMexer = linha.editavel && !cancelado;
  const doPedido = origemVemDoPedido(linha.origem);

  const itens: { rotulo: string; valor: string }[] = [
    { rotulo: "Data", valor: formatarData(linha.data) },
    ...(linha.vencimento
      ? [{ rotulo: "Vencimento", valor: formatarData(linha.vencimento) }]
      : []),
    {
      rotulo: linha.tipo === "transferencia" ? "De → para" : "Conta",
      valor:
        linha.tipo === "transferencia"
          ? `${linha.contaNome ?? "—"} → ${linha.contaDestinoNome ?? "—"}`
          : (linha.contaNome ?? "—"),
    },
    ...(linha.tipo === "transferencia"
      ? []
      : [
          {
            rotulo: "Categoria",
            valor: linha.categoriaNome ?? "Sem categoria",
          },
        ]),
    ...(linha.formaPagamento
      ? [{ rotulo: "Forma", valor: rotuloDaForma(linha.formaPagamento) }]
      : []),
    { rotulo: "Origem", valor: rotuloDaOrigem(linha.origem) },
    { rotulo: "Situação", valor: rotuloDoStatus(linha.status) },
  ];

  return (
    <FolhaFinanceira
      titulo={linha.descricao}
      descricao={rotuloDaOrigem(linha.origem)}
      aoFechar={aoFechar}
      rodape={
        podeMexer || linha.pedidoId ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            {linha.pedidoId ? (
              <button
                type="button"
                onClick={() => aoAbrirPedido(linha.pedidoId ?? "")}
                className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
              >
                <ExternalLink aria-hidden="true" className="size-4" />
                Abrir pedido #{linha.pedidoId.slice(-6)}
              </button>
            ) : null}
            {podeMexer && linha.status === "previsto" ? (
              <button
                type="button"
                onClick={() =>
                  aoBaixar({
                    id: linha.id,
                    descricao: linha.descricao,
                    valor: linha.valor,
                    contaId: linha.contaId,
                    lado: linha.tipo === "entrada" ? "entrada" : "saida",
                    vencimento: linha.vencimento,
                  })
                }
                className={`${CLASSE_BOTAO_PRIMARIO} flex-1`}
              >
                Dar baixa
              </button>
            ) : null}
            {podeMexer ? (
              <button
                type="button"
                onClick={() =>
                  aoCancelar({
                    id: linha.id,
                    descricao: linha.descricao,
                    valor: linha.valor,
                  })
                }
                className={`${CLASSE_BOTAO_PERIGO} flex-1`}
              >
                Cancelar lançamento
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <IconeDaOrigem
              origem={linha.origem}
              tipo={linha.tipo}
              className="size-5 text-zinc-300"
            />
          </div>
          <div className="min-w-0">
            <Dinheiro
              valor={linha.valor}
              sentido={sentido}
              className={`text-3xl font-black ${
                cancelado
                  ? "text-zinc-500 line-through"
                  : sentido === 0
                    ? "text-zinc-200"
                    : corDoValor(sentido)
              }`}
            />
            <div className="mt-1 flex flex-wrap gap-1.5">
              {linha.status === "previsto" ? (
                <Etiqueta tom="aviso">Previsto</Etiqueta>
              ) : null}
              {cancelado ? <Etiqueta tom="perigo">Cancelado</Etiqueta> : null}
            </div>
          </div>
        </div>

        <dl className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-white/[0.02]">
          {itens.map((item) => (
            <div
              key={item.rotulo}
              className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
            >
              <dt className="text-zinc-500">{item.rotulo}</dt>
              <dd className="text-right font-bold text-zinc-100">
                {item.valor}
              </dd>
            </div>
          ))}
        </dl>

        {doPedido ? (
          <p className="flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-400">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Este valor vem do pedido — o Financeiro só lê. Para mudar, mexa no
            pedido (pagamento, estorno ou devolução).
          </p>
        ) : null}
        {linha.status === "realizado" && linha.editavel ? (
          <p className="text-xs text-zinc-500">
            Lançamento realizado não se edita: cancele e lance de novo — assim
            fica a trilha do que aconteceu.
          </p>
        ) : null}
      </div>
    </FolhaFinanceira>
  );
}

/** "Dar baixa": o previsto vira realizado na data e na conta escolhidas. */
export function BaixarLancamentoFolha({
  alvo,
  hoje,
  contas,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly alvo: AlvoDaBaixa;
  readonly hoje: DataIso;
  readonly contas: readonly ContaFinanceira[];
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const [data, setData] = useState<string>(hoje);
  const [contaId, setContaId] = useState<string>(alvo.contaId ?? "");
  const [erroData, setErroData] = useState<string | null>(null);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const sujo = data !== hoje || contaId !== (alvo.contaId ?? "");
  useEffect(() => {
    aoMudarSujo(sujo);
  }, [sujo, aoMudarSujo]);

  async function confirmar() {
    if (enviandoRef.current) return;
    if (!ehDataIso(data)) {
      setErroData("Informe a data.");
      return;
    }
    if (data > hoje) {
      setErroData(
        "A baixa é do que já aconteceu: a data não pode ser no futuro.",
      );
      return;
    }
    setErroData(null);
    enviandoRef.current = true;
    setEnviando(true);
    setErroDoServidor(null);
    try {
      await baixarLancamento({ id: alvo.id, data, contaId: contaId || null });
      aoSalvar(
        alvo.lado === "entrada"
          ? "Recebimento registrado."
          : "Pagamento registrado.",
      );
    } catch (erro) {
      setErroDoServidor(mensagemDeErroFinanceiro(erro));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const ativas = contas.filter((c) => c.ativa || c.id === alvo.contaId);

  return (
    <FolhaFinanceira
      titulo={
        alvo.lado === "entrada"
          ? "Registrar recebimento"
          : "Registrar pagamento"
      }
      descricao={alvo.descricao}
      aoFechar={aoFechar}
      rodape={
        <div className="flex flex-col gap-3">
          {erroDoServidor ? <EstadoDeErro mensagem={erroDoServidor} /> : null}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={aoFechar}
              className={`${CLASSE_BOTAO_SECUNDARIO} flex-1`}
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={enviando}
              onClick={() => void confirmar()}
              className={`${CLASSE_BOTAO_PRIMARIO} flex-[2]`}
            >
              {enviando ? "Registrando…" : "Confirmar baixa"}
            </button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
            Valor
          </p>
          <Dinheiro
            valor={alvo.valor}
            sentido={alvo.lado === "entrada" ? 1 : -1}
            className={`text-2xl font-black ${alvo.lado === "entrada" ? "text-emerald-400" : "text-red-400"}`}
          />
          {alvo.vencimento ? (
            <p className="mt-1 text-xs text-zinc-500">
              Vencimento {formatarData(alvo.vencimento)}
            </p>
          ) : null}
        </div>
        <Campo
          id="fin-baixa-data"
          rotulo={alvo.lado === "entrada" ? "Recebido em" : "Pago em"}
          erro={erroData ?? undefined}
        >
          <input
            id="fin-baixa-data"
            type="date"
            value={data}
            max={hoje}
            onChange={(e) => setData(e.target.value)}
            className={CLASSE_CAMPO}
          />
        </Campo>
        <Campo
          id="fin-baixa-conta"
          rotulo={alvo.lado === "entrada" ? "Entrou em" : "Saiu de"}
        >
          <select
            id="fin-baixa-conta"
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            className={CLASSE_CAMPO}
          >
            <option value="">A conta do lançamento</option>
            {ativas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </Campo>
      </div>
    </FolhaFinanceira>
  );
}

/** Cancelar um lançamento manual — sempre com motivo (trilha de auditoria). */
export function CancelarLancamentoDialogo({
  alvo,
  aoFechar,
  aoSalvar,
  aoMudarSujo,
}: {
  readonly alvo: AlvoDoCancelamento;
  readonly aoFechar: () => void;
  readonly aoSalvar: (mensagem: string) => void;
  readonly aoMudarSujo: (sujo: boolean) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const [erroDoServidor, setErroDoServidor] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  const motivoLimpo = motivo.trim();
  const erroMotivo =
    tentou && motivoLimpo.length < 3
      ? "Conte em poucas palavras por que está cancelando."
      : undefined;

  useEffect(() => {
    aoMudarSujo(motivoLimpo !== "");
  }, [motivoLimpo, aoMudarSujo]);

  async function confirmar() {
    if (enviandoRef.current) return;
    setTentou(true);
    if (motivoLimpo.length < 3) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErroDoServidor(null);
    try {
      await cancelarLancamento({ id: alvo.id, motivo: motivoLimpo });
      aoSalvar("Lançamento cancelado.");
    } catch (erro) {
      setErroDoServidor(mensagemDeErroFinanceiro(erro));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">
            Cancelar lançamento?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-zinc-400">
            “{alvo.descricao}” (<Dinheiro valor={alvo.valor} />) deixa de contar
            no saldo e na DRE. O registro fica guardado, marcado como cancelado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Campo id="fin-cancelar-motivo" rotulo="Motivo" erro={erroMotivo}>
          <LocalBufferedTextarea
            id="fin-cancelar-motivo"
            value={motivo}
            maxLength={300}
            rows={3}
            delay={100}
            placeholder="Ex.: lançado em duplicidade"
            onFlush={setMotivo}
            className={`${CLASSE_CAMPO} py-2`}
          />
        </Campo>
        {erroDoServidor ? <EstadoDeErro mensagem={erroDoServidor} /> : null}
        <AlertDialogFooter className="gap-2">
          <button
            type="button"
            onClick={aoFechar}
            className={CLASSE_BOTAO_SECUNDARIO}
          >
            Manter
          </button>
          <button
            type="button"
            disabled={enviando}
            onClick={() => void confirmar()}
            className={CLASSE_BOTAO_PERIGO}
          >
            {enviando ? "Cancelando…" : "Cancelar lançamento"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

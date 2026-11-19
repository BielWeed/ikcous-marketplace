// "Desfazer" o recebimento de um pedido, na lista e na ficha (o MESMO botão nos
// dois lugares). Em TODO pedido o toque abre uma pergunta com "Voltar" em foco
// (15/10/2026) — antes só a venda do balcão perguntava e o pedido do site agia
// num toque. Desmarcar não é inocente em nenhum dos dois:
//
//  - Pedido do site (pago na entrega ou na retirada): o banco volta o
//    pagamento para "em branco" (`registrar_pagamento_recebido`, migration
//    20261197000000). Vendas e lucro do Início (`crm__vendas`, `fin_dre`) e o
//    Financeiro (`fin__movimentos`, 20261177000000) só contam pedido com
//    pagamento marcado, então o valor sai deles até marcar de novo; a cliente
//    não consegue pedir devolução ("Este pedido não tem pagamento a devolver",
//    20261175000000 e 20261199000000); e, ao marcar de novo, o banco grava a
//    hora de AGORA, então a venda passa a contar no dia da nova marcação (em
//    dinheiro, no Caixa da loja aberto naquela hora, `fin__caixa_calculo`).
//  - Venda do BALCÃO não tem volta: o banco passa a venda a "entregue sem
//    pagamento", ela sai do caixa e do Financeiro, o estoque continua baixado
//    e, mesmo marcando como recebido de novo, a anulação fica recusada para
//    sempre (o histórico guarda o "desfeito").
//
// A regra do banco não muda: a tela espelha a recusa por devolução e,
// quando pode desfazer, pergunta antes de chamar `aoDesfazer`.
// Cada frase da pergunta tem de ser provada por uma migration: nada de
// promessa que o banco não cumpre.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDevolucoesDoPedidoAdmin } from "@/hooks/useDevolucoesDoPedidoAdmin";
import { podeAnularVendaDoBalcao } from "@/lib/anulacao-do-balcao";
import type { Order } from "@/types";
import { type ReactElement, useState } from "react";
import { AvisoFalhaNaLeituraDasDevolucoes } from "./DevolucaoDoPedidoAdminCard";

interface PropsDoDesfazerRecebimento {
  readonly order: Order;
  readonly leituraDeDevolucoes?: ReturnType<typeof useDevolucoesDoPedidoAdmin>;
  readonly aoDesfazer: () => void;
  readonly disabled?: boolean;
  readonly className: string;
}

const MOTIVO_DEVOLUCAO =
  "Este pedido tem devolução; o recebimento não pode ser desfeito.";

export function DesfazerRecebimento({
  order,
  leituraDeDevolucoes,
  aoDesfazer,
  disabled,
  className,
}: PropsDoDesfazerRecebimento): ReactElement {
  const [aberto, setAberto] = useState(false);
  const naLista = leituraDeDevolucoes === undefined;
  // A ficha já lê; na lista, só consultar ao abrir a confirmação deste pedido.
  const leituraAoAbrir = useDevolucoesDoPedidoAdmin(
    order.id,
    naLista && aberto,
  );
  const { devolucoes, carregando, erro, recarregar } =
    leituraDeDevolucoes ?? leituraAoAbrir;

  // A RPC registrar_pagamento_recebido (20261243000000) só libera
  // devoluções encerradas sem devolução de dinheiro ou troca. Se a leitura
  // falhar, a ação continua disponível e a RPC ainda aplica a regra.
  const devolucaoImpeditiva =
    !carregando &&
    !erro &&
    devolucoes.some(
      ({ status }) =>
        status !== "recusada" &&
        status !== "cancelada" &&
        status !== "reprovada",
    );
  if (!naLista && devolucaoImpeditiva) {
    return <p className="text-xs text-zinc-400">{MOTIVO_DEVOLUCAO}</p>;
  }
  const aguardando = carregando || (naLista && !aberto);
  const podeConfirmar = !disabled && !aguardando && !devolucaoImpeditiva;

  const ehVendaDoBalcao = order.canal === "presencial";
  // "Use Anular" só quando ainda dá: depois do dia da venda o banco já recusa
  // a anulação, e mandar a lojista para um botão que não existe seria falso.
  const aindaSePodeAnular = ehVendaDoBalcao && podeAnularVendaDoBalcao(order);

  return (
    <AlertDialog onOpenChange={naLista ? setAberto : undefined}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          disabled={disabled || (!naLista && carregando)}
          className={className}
        >
          Desfazer
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent
        // A pergunta mora num portal, mas os eventos dela sobem pela árvore do
        // React até o cartão da lista (que abre a ficha em clique e em Enter):
        // sem esta trava, tocar em "Voltar" abriria o pedido por baixo.
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="max-w-md rounded-3xl border border-admin-border bg-zinc-950"
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-black tracking-tight text-white">
            Desfazer o recebimento{" "}
            {ehVendaDoBalcao ? "desta venda" : "deste pedido"}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm leading-relaxed text-zinc-400">
            {devolucaoImpeditiva
              ? MOTIVO_DEVOLUCAO
              : aguardando
                ? "Conferindo as devoluções deste pedido…"
                : ehVendaDoBalcao
                  ? `Depois de desfazer, esta venda não poderá mais ser anulada e o estoque não volta.${aindaSePodeAnular ? " Para cancelar de verdade, use Anular." : " A venda deixa de constar como recebida."}`
                  : "O valor sai das vendas, do lucro e do Financeiro, e a cliente não consegue pedir devolução."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {naLista && erro && (
          <AvisoFalhaNaLeituraDasDevolucoes
            carregando={carregando}
            recarregar={recarregar}
          />
        )}
        <AlertDialogFooter className="mt-2 gap-2">
          {/* O Radix põe o foco no "Cancel" ao abrir: a ação padrão é voltar. */}
          <AlertDialogCancel className="h-11 rounded-xl border border-admin-border bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10">
            Voltar
          </AlertDialogCancel>
          {podeConfirmar && (
            <AlertDialogAction
              onClick={() => aoDesfazer()}
              className="h-11 rounded-xl border border-red-900/60 bg-transparent px-4 text-sm font-semibold text-red-300 hover:bg-red-950/40"
            >
              {ehVendaDoBalcao
                ? "Desfazer mesmo assim"
                : "Desfazer recebimento"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

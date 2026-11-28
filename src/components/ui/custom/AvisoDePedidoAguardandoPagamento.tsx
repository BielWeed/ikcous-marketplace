import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { podeRetomarPagamento } from "@/lib/pode-retomar-pagamento";
import { lerPrazoDoPixEmMs, prazoDoPixPassou } from "@/lib/prazo-do-pix";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import type { PaymentStatus, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { useEffect, useMemo, useState } from "react";

/**
 * O pedido que ficou esperando pagamento (27/11/2026).
 *
 * A cliente que usa a loja instalada finaliza no Pix (o carrinho é esvaziado
 * na criação do pedido), vai ao app do banco e o iPhone fecha o app da loja.
 * Ao reabrir, o app abre no Início — e o App apaga de propósito o registro
 * do pedido guardado na aba, porque a página não carregou no checkout. Sem
 * este aviso ela via o carrinho vazio e nada mais: refazia o pedido, ou
 * comprava de novo o que já tinha pago.
 *
 * Lido DO BANCO, nunca da aba: os pedidos pendentes da própria conta (a RLS
 * já limita a `auth.uid() = user_id`). Quem decide se o pedido ainda espera
 * pagamento é a MESMA regra do botão "Retomar pagamento" do detalhe e do
 * Perfil (`podeRetomarPagamento`), mais o prazo do Pix (`prazoDoPixPassou`):
 * passou do horário e o banco ainda não virou para "expirado", o aviso já
 * não aparece — a reserva está acabando e não há mais o que pagar.
 *
 * Relê ao voltar para a aba (a cliente pagou no banco e voltou: o aviso some)
 * e quando o prazo passa com a tela aberta. Falha de leitura não fala nada:
 * sem aviso, e o resto da tela segue.
 */

// Só o que o aviso mostra e a regra lê. Pedido online pendente vive no máximo
// a reserva (30 min, 40 com o desafio do cartão): os 20 mais recentes da conta
// que ainda estão `pending` sempre o incluem.
const COLUNAS = "id, total, status, payment_status, expires_at, created_at";
const LIMITE_DE_PEDIDOS_PENDENTES = 20;

type PedidoAguardando = {
  id: string;
  total: number;
  expiraEmMs: number;
};

async function lerPedidosAguardandoPagamento(
  userId: string,
  signal: AbortSignal,
): Promise<PedidoAguardando[]> {
  const { data, error } = await supabase
    .from("marketplace_orders")
    .select(COLUNAS)
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIMITE_DE_PEDIDOS_PENDENTES)
    .abortSignal(signal);
  if (error || !Array.isArray(data)) throw error ?? new Error("sem dados");
  return data
    .filter((linha) =>
      podeRetomarPagamento({
        status: linha.status,
        paymentStatus: linha.payment_status as PaymentStatus | null,
        logado: true,
      }),
    )
    .map((linha) => ({
      id: linha.id,
      total: Number(linha.total ?? 0),
      expiraEmMs: lerPrazoDoPixEmMs(linha.expires_at),
    }));
}

function usePedidosAguardandoPagamento(userId: string, ativo: boolean) {
  const [pedidos, setPedidos] = useState<PedidoAguardando[]>([]);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!ativo) return;
    let controlador: AbortController | null = null;
    const ler = () => {
      controlador?.abort();
      const atual = new AbortController();
      controlador = atual;
      lerPedidosAguardandoPagamento(userId, atual.signal).then(
        (lidos) => {
          if (atual.signal.aborted) return;
          setAgora(Date.now());
          setPedidos(lidos);
        },
        () => {
          if (atual.signal.aborted) return;
          setPedidos([]);
        },
      );
    };
    // Mesmo gatilho do `useOrders`: a aba voltou a ficar visível.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") ler();
    };
    ler();
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      controlador?.abort();
    };
  }, [userId, ativo]);

  const noPrazo = useMemo(
    () => pedidos.filter((p) => !prazoDoPixPassou(p.expiraEmMs, agora)),
    [pedidos, agora],
  );

  // O prazo passa com a tela aberta: o aviso sai no horário, sem esperar a
  // próxima leitura.
  const proximoVencimento = noPrazo.reduce(
    (menor, p) =>
      Number.isFinite(p.expiraEmMs) ? Math.min(menor, p.expiraEmMs) : menor,
    Number.POSITIVE_INFINITY,
  );
  useEffect(() => {
    if (!Number.isFinite(proximoVencimento)) return;
    const relogio = setTimeout(
      () => setAgora(Date.now()),
      Math.max(0, proximoVencimento - Date.now()),
    );
    return () => clearTimeout(relogio);
  }, [proximoVencimento]);

  return ativo ? noPrazo : [];
}

export function AvisoDePedidoAguardandoPagamento({
  userId,
  onNavigate,
  ativo = true,
  className,
}: Readonly<{
  userId: string;
  onNavigate: (view: View, id?: string) => void;
  ativo?: boolean;
  /** Margens de quem monta: só existem quando o aviso aparece. */
  className?: string;
}>) {
  const pedidos = usePedidosAguardandoPagamento(userId, ativo);
  const maisRecente = pedidos[0];
  if (!maisRecente) return null;
  const numero = numeroDoPedido(maisRecente.id);

  return (
    <section
      role="status"
      aria-label="Pedido aguardando pagamento"
      className={cn(
        "rounded-2xl border border-solid border-border bg-background px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] font-medium text-foreground">
          <span
            aria-hidden="true"
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500"
          />
          <span className="min-w-0">
            <span className="block font-bold">
              Você tem um pedido aguardando pagamento
            </span>
            <span className="block">
              #{numero} · {formatCurrency(maisRecente.total)}
            </span>
            <span className="block text-muted-foreground">
              Se você já pagou, não pague de novo: a confirmação pode levar
              alguns minutos.
            </span>
          </span>
        </p>
        <button
          type="button"
          onClick={() => {
            haptic.light();
            onNavigate("order-details", maisRecente.id);
          }}
          aria-label={`Ver e pagar o pedido #${numero}`}
          className="min-h-11 rounded-xl bg-foreground px-4 text-sm font-bold text-background transition-all active:scale-95"
        >
          Ver e pagar
        </button>
      </div>
      {pedidos.length > 1 && (
        <button
          type="button"
          onClick={() => {
            haptic.light();
            onNavigate("orders");
          }}
          className="mt-1 min-h-11 text-sm font-semibold text-foreground underline underline-offset-4"
        >
          Ver todos os {pedidos.length} pedidos aguardando pagamento
        </button>
      )}
    </section>
  );
}

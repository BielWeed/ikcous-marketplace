import { paymentStatusKey } from "@/components/admin/orders/OrderStatusBadge";
import { CustomerPaymentBadge } from "@/components/ui/custom/CustomerPaymentBadge";
import { ReviewForm } from "@/components/ui/custom/ReviewForm";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useDevolucaoDoPedidoCliente } from "@/hooks/useDevolucaoDoPedidoCliente";
import { useOrders } from "@/hooks/useOrders";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { supabase } from "@/lib/supabase";
import {
  type LinhaDevolucaoDoCliente,
  desfechoDaDevolucao,
  textoConfirmarCancelamento,
  textoDevolucao,
} from "@/lib/texto-estorno-do-cliente";
import { cn } from "@/lib/utils";
import type {
  Order,
  OrderItem,
  OrderStatus,
  PaymentStatus,
  View,
} from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle,
  Clock,
  Copy,
  CreditCard,
  Loader2,
  Mail,
  MapPin,
  MessageCircle,
  Package,
  Star,
  Truck,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

interface OrderDetailsViewProps {
  orderId: string;
  onBack: () => void;
  onNavigate: (view: View) => void;
}

const statusConfig: Record<
  OrderStatus,
  {
    label: string;
    icon: LucideIcon;
    color: string;
    bg: string;
    description: string;
  }
> = {
  pending: {
    label: "Pedido Recebido",
    icon: Package,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    description:
      "Aguardando confirmação de pagamento para iniciar a separação.",
  },
  processing: {
    label: "Em Separação",
    icon: Clock,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    description: "Seu pedido está sendo preparado com todo cuidado e atenção.",
  },
  shipping: {
    label: "Em Trânsito",
    icon: Truck,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    description: "Seu pedido já saiu para entrega e chegará em breve.",
  },
  delivered: {
    label: "Entregue",
    icon: CheckCircle,
    color: "text-green-500",
    bg: "bg-green-500/10",
    description:
      "O pedido foi entregue com sucesso. Aproveite sua experiência!",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    color: "text-red-500",
    bg: "bg-red-500/10",
    description: "Este pedido foi cancelado e não seguirá para entrega.",
  },
};

/**
 * Só o estado `pending` (esteira do pedido) muda de texto conforme o
 * `payment_status` (se o dinheiro entrou) — processing/shipping/delivered/
 * cancelled continuam com a description fixa do `statusConfig`, porque a
 * esteira já avançou e a pergunta "o dinheiro entrou?" já foi respondida
 * pela lojista. É por isso que este é um `switch` pequeno em cima de
 * `paymentStatusKey` (a ÚNICA fonte que decide "null vira sem_cobranca"),
 * não um segundo emaranhado de `if` dentro de `statusConfig`.
 *
 * `aguardando` e `sem_cobranca` caem no `default`: devolvem o texto que já
 * estava certo, sem mudar uma vírgula.
 */
function pendingDescription(
  paymentStatus: PaymentStatus | null | undefined,
): string {
  const key = paymentStatusKey(paymentStatus);
  switch (key) {
    case "pago":
    case "pago_apos_expirar":
    case "recebido_na_entrega":
      // Task 3b de docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md:
      // a loja confirmou o recebimento na entrega — mesmo tratamento de
      // `pago`.
      return "Pagamento confirmado. A loja vai iniciar a separação.";
    case "recusado":
      return "O pagamento não foi aprovado. Tente novamente ou fale com a loja.";
    case "expirado":
      return "O prazo de pagamento venceu. Fale com a loja para gerar um novo.";
    case "estornado":
      return "O pagamento foi estornado. Fale com a loja.";
    default:
      return statusConfig.pending.description;
  }
}

/**
 * `cancelled` (esteira) quase sempre significa "não seguirá para entrega",
 * mas há um par real que a produção gera (rastreado no SQL,
 * `20260810000000_confirmar_pagamento_guarda_status.sql`, ~118-120 e
 * ~173-176): `pago` e `pago_apos_expirar` também aparecem com
 * `status='cancelled'` quando o cliente pagou o PIX depois que a reserva
 * venceu ou depois que a lojista cancelou. O estoque já voltou, o pedido está
 * morto, mas o dinheiro está com a loja — a description fixa de "cancelado,
 * não seguirá para entrega" escondia isso do comprador. Mesma forma de
 * `pendingDescription`: função pequena em cima de `paymentStatusKey`, os
 * demais casos de `cancelled` mantêm o texto de `statusConfig` sem mudar uma
 * vírgula.
 *
 * `aguardando` é o par oposto, e o mais perigoso dos dois: o cliente cancelou
 * um PIX que ainda NÃO pagou. `update_order_status_atomic` grava
 * `status='cancelled'` e devolve o estoque, mas não toca em `payment_status`
 * — rastreado em `20260812000000_reconciliar_pedido_cancelado.sql`
 * (linhas 6-17). Sem este ramo, a description fixa de "cancelado" não avisava
 * nada, e o selo ao lado (`CustomerPaymentBadge`) dizia "Aguardando
 * pagamento" — a tela inteira convidava o cliente a pagar um pedido morto com
 * o QR do PIX ainda aberto no banco dele. Não há estorno automático neste
 * app.
 *
 * Rodada 3 (laudo Opus PR#457, BLOQUEIA A/B): a decisão trocou
 * `cancelledAfterShipping` por "existe linha em `linhasDevolucao`?" — a
 * rodada 2 promovia "volta sozinho" INFERINDO a condição da RPC a partir de
 * `payment_status`+`cancelledAfterShipping`, e essa inferência mentia em
 * dois estados alcançáveis hoje: `pago_apos_expirar` (o valor só existe
 * DEPOIS do cancelamento — no instante em que a RPC decidiu, `payment_status`
 * ainda era `aguardando`/`expirado`, então nenhuma linha nasceu) e convidado
 * por rastreio (`get_orders_by_otp_v1` não inclui `cancelled_after_shipping`,
 * que vira `false` e passava por "não enviado"). A RPC
 * `update_order_status_atomic`
 * (`supabase/migrations/2026110000000_o_estorno_nasce_no_ledger.sql:388-401`)
 * só grava a linha automática quando SEIS coisas são verdade ao mesmo
 * tempo — `status` novo é `cancelled`, `status` antigo era
 * `pending`/`processing`, `payment_status` é `pago`/`pago_apos_expirar`,
 * `paid_at` não é nulo, o pedido NÃO foi enviado, e ainda NÃO existe linha
 * `solicitado`/`em_processamento`/`concluido` para o pedido (`NOT EXISTS`,
 * a guarda que impede duplicar no ciclo reativar→cancelar de novo — linha
 * `falhou`/`recusado` não bloqueia, o retry é legítimo) — avaliadas no
 * instante do cancelamento, nunca depois. Observar a linha em vez de
 * re-derivar essa condição no front fecha as três divergências de uma vez
 * (inclusive `paid_at` nulo em pedido legado): a tela só promete o que o
 * banco já fez.
 *
 * Rodada 4 (laudo Opus PR#457, decisão da hub): "existe linha?" sozinho
 * ainda deixava passar um QUARTO caso da mesma família — linha `falhou`/
 * `recusado` sozinha é dinheiro que o automático JÁ DESISTIU de mover, não
 * "em movimento". O card e `textoDevolucao` (logo abaixo) agora leem o
 * MESMO predicado `desfechoDaDevolucao` — os dois não podem mais divergir
 * sobre a mesma pergunta.
 */
function cancelledDescription(
  paymentStatus: PaymentStatus | null | undefined,
  linhasDevolucao: LinhaDevolucaoDoCliente[],
): string {
  const key = paymentStatusKey(paymentStatus);
  // `recebido_na_entrega` fica fora do Mercado Pago (brief T7): a devolução
  // depende sempre da loja, enviado ou não — por isso não entra no ramo de
  // baixo, que só existe para dinheiro que passou pelo MP e tem cron/edge
  // devolvendo sozinho.
  if (key === "recebido_na_entrega") {
    return "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.";
  }
  if (key === "pago" || key === "pago_apos_expirar") {
    // Rodada 4 (laudo Opus PR#457, decisão da hub): o card lê o MESMO
    // predicado que `textoDevolucao` — nunca mais "existe linha?" sozinho
    // (rodada 3), que confundia `falhou`/`recusado` (dinheiro que o
    // automático já desistiu de mover) com "em movimento". EM CURSO: o
    // processo já começou (a mesma linha que `textoDevolucao`, logo abaixo,
    // narra em detalhe) — "o dinheiro volta sozinho" é verdade. CONCLUÍDA: o
    // card não fala de dinheiro — quem afirma o valor, no passado, é o
    // parágrafo `textoDevolucao` ("Devolução concluída: R$ X") logo abaixo.
    // SEM DEVOLUÇÃO AUTOMÁTICA (sem linha, ou só `falhou`/`recusado`): "fale
    // com a loja" cobre de uma vez pago já enviado (a RPC nunca grava),
    // `pago_apos_expirar` (o valor só existe depois do cancelamento),
    // convidado por rastreio (a RPC de OTP não carrega
    // `cancelled_after_shipping`), pedido legado sem `paid_at`, cache velho
    // do `localStorage` sem a chave nova, e o automático que desistiu.
    const desfecho = desfechoDaDevolucao(linhasDevolucao);
    if (desfecho === "em_curso") {
      return "Este pedido foi cancelado, mas o seu pagamento foi recebido. O dinheiro volta sozinho para você: PIX cai na sua conta; cartão aparece como crédito na fatura (o prazo é do seu banco).";
    }
    if (desfecho === "concluida") {
      return "Este pedido foi cancelado, mas o seu pagamento foi recebido.";
    }
    return "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.";
  }
  if (key === "aguardando") {
    return "Este pedido foi cancelado. Se o pagamento ainda estiver aberto no seu banco, não pague — o pedido não será entregue.";
  }
  return statusConfig.cancelled.description;
}

export function OrderDetailsView({
  orderId,
  onBack,
  onNavigate: _onNavigate,
}: OrderDetailsViewProps) {
  const { orders, fetchUserOrders, updateOrderStatus, reenviarComprovante } =
    useOrders(true, false);
  const { config } = useStore();
  const { user } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCancelling, setIsCancelling] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [reviewedProductIds, setReviewedProductIds] = useState<Set<string>>(
    new Set(),
  );
  const [reviewingItem, setReviewingItem] = useState<{
    productId: string;
    productName: string;
  } | null>(null);
  // Laudo de acessibilidade 05/09 (onda 3, item B5): guarda o botão
  // "Avaliar" que abriu a folha (há um por item do pedido) para devolver o
  // foco a ele quando a folha fechar.
  const avaliarTriggerRef = useRef<HTMLButtonElement | null>(null);
  const fecharAvaliacao = useCallback(() => {
    setReviewingItem(null);
    avaliarTriggerRef.current?.focus();
  }, []);
  // Rodada 2 (Codex, 08/09, item 1): o foco continuava no botão "Avaliar"
  // de fora depois de abrir a folha — Esc não chegava a ela e o Tab
  // seguia percorrendo o fundo apesar do aria-modal. A folha agora se
  // autofoca ao montar e prende o Tab enquanto está aberta.
  const avaliacaoFolhaRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reviewingItem) return;
    avaliacaoFolhaRef.current?.focus();
  }, [reviewingItem]);

  const handleCancelOrder = async () => {
    if (!order) return;
    // Regra do Gabriel (24/08/2026): o botão "Cancelar Pedido" aparece para
    // pedido 'pending', 'processing' OU 'shipping' com usuário logado — o
    // divisor é se o produto JÁ SAIU, não se foi pago. 'delivered' fica de
    // fora: produto entregue é devolução, outro assunto. Este é o espelho na
    // tela da mesma trava do servidor (validateStatusUpdate, useOrders.ts, e
    // update_order_status_atomic no banco).
    //
    // O aviso, por sua vez, ainda depende do pagamento. Desde 07/09/2026
    // (Task 1 do plano-mãe `20260907-plano-estorno-pelo-app.md`) o
    // cancelamento de um pedido PAGO e NÃO ENVIADO grava a linha de
    // devolução em `order_refunds` na MESMA transação, e o cron/edge
    // (`estornar-pagamento`, `reconciliar-pagamentos`) tocam o Mercado Pago
    // sozinhos a partir dela — a frase antiga ("o dinheiro NÃO volta
    // automaticamente") deixou de ser verdade para esse caso. O que
    // continua dependendo de alguém é o caso oposto: pedido JÁ ENVIADO,
    // onde a loja só devolve o dinheiro depois que o PRODUTO físico voltar.
    // `textoConfirmarCancelamento` (texto-estorno-do-cliente.ts) é a fonte
    // única dos quatro textos possíveis (não pago / pago não enviado / pago
    // já enviado / pago na entrega).
    // `===` e nao `.includes()`: o array seria inferido como `string[]` e
    // aceitaria qualquer coisa, entao um rename futuro de `PaymentStatus`
    // quebraria os dois `switch` deste arquivo e passaria calado AQUI —
    // `pagamentoJaEntrou` viraria `false` para sempre e quem pagou voltaria
    // a ler o texto generico. Com `===` o TypeScript reprova (TS2678).
    const chavePagamento = paymentStatusKey(order.paymentStatus);
    const pagamentoJaEntrou =
      chavePagamento === "pago" ||
      chavePagamento === "pago_apos_expirar" ||
      chavePagamento === "recebido_na_entrega";
    const jaFoiEnviado = order.status === "shipping";
    const pagamentoNaEntrega = chavePagamento === "recebido_na_entrega";
    const textoConfirm = textoConfirmarCancelamento({
      pagamentoJaEntrou,
      jaFoiEnviado,
      pagamentoNaEntrega,
    });
    const confirmCancel = globalThis.confirm(textoConfirm);
    if (!confirmCancel) return;

    setIsCancelling(true);
    haptic.medium();
    try {
      await updateOrderStatus(order.id, "cancelled");
      setOrder((prev) => (prev ? { ...prev, status: "cancelled" } : null));
    } catch (error) {
      console.error("Failed to cancel order:", error);
    } finally {
      setIsCancelling(false);
    }
  };

  // `orders` fica num ref, e NÃO nas dependências do useCallback abaixo.
  //
  // O que acontecia antes (PEDIDO-040, #84): `loadOrder` dependia de `orders`,
  // o efeito dependia de `loadOrder`, e `fetchUserOrders` trocava a referência
  // de `orders` a cada volta — inclusive devolvendo `[]` para quem nunca
  // comprou. Cada volta recriava o callback, que redisparava o efeito, que
  // fazia outra requisição: loop infinito no Supabase com o spinner girando
  // para sempre. A outra metade da correção está no `setOrders` do
  // `useOrders.ts`, que agora devolve a mesma referência quando nada mudou.
  //
  // O ref é atualizado num efeito, e não durante o render: escrever em ref no
  // meio do render é o que o React desaconselha em modo concorrente. O valor
  // inicial já vem do cache do localStorage (`useOrders.ts:117-133`), que é o
  // que o passo 1 abaixo precisa.
  const ordersRef = useRef(orders);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const loadOrder = useCallback(async () => {
    // 1. Pinta com o que já está em memória (vem do cache do localStorage),
    //    para a tela não ficar branca enquanto a rede responde.
    const emMemoria = ordersRef.current.find((o) => o.id === orderId);
    if (emMemoria) {
      setOrder(emMemoria);
      setLoading(false);
    }

    // 2. Revalida no servidor SEMPRE, uma vez por abertura. Antes, ter cache
    //    fazia a tela pular esta busca e nunca mais conferir o status do
    //    pedido com o banco.
    const doServidor = await fetchUserOrders();
    let encontrado = doServidor.find((o) => o.id === orderId);

    // 3. Convidado que rastreou pedido por OTP não tem linha em
    //    marketplace_orders para o user_id dele; o pedido fica no
    //    sessionStorage.
    if (!encontrado) {
      try {
        const guestCached = sessionStorage.getItem("guest_tracked_orders");
        if (guestCached) {
          const parsed = JSON.parse(guestCached);
          if (Array.isArray(parsed)) {
            encontrado = parsed.find((o) => o.id === orderId);
          }
        }
      } catch (e) {
        console.error("Error loading guest orders from sessionStorage:", e);
      }
    }

    // Se a revalidação não achou nada mas havia algo em memória, mantém o que
    // está na tela: melhor um dado de um segundo atrás do que piscar para
    // "pedido não encontrado" por causa de uma resposta abortada.
    if (encontrado || !emMemoria) setOrder(encontrado || null);
    setLoading(false);
  }, [orderId, fetchUserOrders]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  useEffect(() => {
    if (!user || !order || order.status !== "delivered") return;

    const checkIfReviewed = async () => {
      try {
        const productIds = order.items.map((item) => item.productId);
        const { data, error } = await supabase
          .from("reviews" as any)
          .select("product_id")
          .eq("user_id", user.id)
          .in("product_id", productIds);

        if (!error && data) {
          const reviewedSet = new Set<string>(
            data.map((r: any) => r.product_id),
          );
          setReviewedProductIds(reviewedSet);
        }
      } catch (e) {
        console.error("Failed to check existing reviews:", e);
      }
    };

    checkIfReviewed();
  }, [user, order]);

  // Brief "o app não mente quando copia" (08/09/2026): copiava sem
  // await/catch e já comemorava mesmo quando a cópia falhava (permissão
  // negada, janela sem foco, API ausente) — mesma família do laudo 0109 (A-8)
  // que corrigiu OrderDetail.tsx (painel). `copiarParaClipboard` devolve
  // `false` quando a API recusa, e aí o aviso é de erro, não de sucesso.
  const handleCopyId = async () => {
    const ok = await copiarParaClipboard(orderId);
    if (!ok) {
      toast.error(
        "Não foi possível copiar. Selecione o texto e copie manualmente.",
      );
      return;
    }
    toast.success("ID do pedido copiado!");
    haptic.light();
  };

  /**
   * Código de rastreio, já descartado o que não serve para rastrear (#105).
   *
   * O campo do painel é texto livre: a lojista salva, apaga e volta a salvar, e
   * o que sobra no banco é `""` ou espaço. Bloco "Código de Rastreio" em branco
   * é pior que bloco nenhum — parece que o envio saiu e não saiu.
   */
  const codigoDeRastreio = order?.trackingCode?.trim() || null;

  const handleCopyTracking = async () => {
    if (!codigoDeRastreio) return;
    const ok = await copiarParaClipboard(codigoDeRastreio);
    if (!ok) {
      toast.error(
        "Não foi possível copiar. Selecione o texto e copie manualmente.",
      );
      return;
    }
    setCopiedTracking(true);
    toast.success("Código de rastreio copiado!");
    haptic.light();
    globalThis.setTimeout(() => setCopiedTracking(false), 2000);
  };

  const handleWhatsAppSupport = () => {
    const message = `Olá! Tenho uma dúvida sobre meu pedido #${orderId.slice(0, 8)}.`;
    let phone = (config.whatsappNumber || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, "_blank");
    haptic.light();
  };

  // Decisão de 30/08 (PRs #358-#365, "sem número, o botão some") chegou ao
  // ProductView mas não aqui — laudo 31/08 (C1): com a sentinela de fábrica
  // morta, `wa.me/` sem destinatário é link quebrado na tela de PÓS-VENDA.
  // Mesma régua do ProductView: menos de 10 dígitos, sem botão.
  const lojaTemWhatsappAgora = lojaTemWhatsapp(config.whatsappNumber);

  // Laudo 0109 (B2): o comprovante saía só pela chamada solta do navegador
  // na hora da compra — rede caída ou aba fechada no segundo errado e o
  // e-mail nunca chegava, sem retry e sem ninguém saber. A trava de "um
  // e-mail por pedido" é do banco (`reivindicar_email_de_confirmacao`), e
  // os desfechos dela viram frases honestas: enviado de novo, já tinha
  // saido, loja sem e-mail configurado, ou falha de agora.
  const [isResendingReceipt, setIsResendingReceipt] = useState(false);
  const handleResendReceipt = async () => {
    if (!order || isResendingReceipt) return;
    setIsResendingReceipt(true);
    try {
      const desfecho = await reenviarComprovante(order.id);
      if (desfecho.ok) {
        toast.success(
          "Comprovante reenviado! Confira a caixa de entrada do e-mail deste pedido.",
        );
      } else if (desfecho.motivo === "ja_enviado") {
        toast("O comprovante deste pedido já foi enviado por e-mail.");
      } else if (desfecho.motivo === "sem_remetente") {
        toast.error(
          "A loja ainda não configurou o envio de e-mails. Fale com o lojista.",
        );
      } else {
        toast.error(
          "Não conseguimos reenviar o comprovante agora. Tente de novo em instantes.",
        );
      }
    } finally {
      setIsResendingReceipt(false);
    }
  };

  // Só pedido `cancelled` com pagamento ONLINE confirmado (`pago` ou
  // `pago_apos_expirar` — via `paymentStatusKey`) tem devolução para
  // mostrar: `recebido_na_entrega` nunca passou pelo Mercado Pago, e para
  // qualquer outro estado a pergunta "cadê meu dinheiro?" nem se aplica. O
  // hook é chamado INCONDICIONAL (regra do React: hook não vai atrás de
  // `if`) — `order` pode ser `null` no primeiro render, antes de qualquer
  // pedido ter carregado, e é por isso que `mostrarDevolucao` usa `order?.`.
  const chaveDoPagamento = paymentStatusKey(order?.paymentStatus);
  const mostrarDevolucao =
    order?.status === "cancelled" &&
    (chaveDoPagamento === "pago" || chaveDoPagamento === "pago_apos_expirar");
  const { linhas: linhasDevolucao } = useDevolucaoDoPedidoCliente(
    orderId,
    mostrarDevolucao,
  );

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center space-y-4 bg-zinc-50/30">
        <div className="size-12 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent" />
        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">
          Sincronizando Dados
        </p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white p-8 text-center">
        <div className="mb-6 flex size-20 items-center justify-center rounded-[2.5rem] bg-zinc-100">
          <XCircle className="size-10 text-zinc-300" />
        </div>
        <h2 className="mb-2 text-2xl font-black uppercase italic tracking-tighter">
          Pedido não encontrado
        </h2>
        <p className="mb-8 text-[11px] font-bold uppercase leading-relaxed tracking-widest text-zinc-400">
          Não conseguimos localizar as informações deste pedido em nosso
          sistema.
        </p>
        <button
          onClick={onBack}
          className="h-14 rounded-2xl bg-zinc-900 px-8 text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all active:scale-95"
        >
          Voltar aos pedidos
        </button>
      </div>
    );
  }

  // O CHECK do banco (marketplace_orders_status_check, baseline
  // 20260806000000:3981) aceita SEIS status: pending, processing, shipping,
  // delivered, cancelled, new. Este `statusConfig` (linha 43) só conhece os
  // CINCO do type `OrderStatus` — falta 'new'. A migration
  // 20260327000003_sync_order_status_constraint.sql migrou todo pedido
  // 'new' para 'pending' (linhas 20-24) e manteve 'new' no CHECK só por
  // compatibilidade histórica: hoje há 0 pedidos nesse estado, mas o banco
  // continua aceitando o valor, e sem o `|| statusConfig.pending` esta tela
  // fica em branco se um chegar. Mesma guarda de OrderList.tsx:209.
  const currentStatus =
    statusConfig[order.status as OrderStatus] || statusConfig.pending;
  const StatusIcon = currentStatus.icon;
  const statusDescription =
    order.status === "pending"
      ? pendingDescription(order.paymentStatus)
      : order.status === "cancelled"
        ? cancelledDescription(order.paymentStatus, linhasDevolucao)
        : currentStatus.description;
  const textoDaDevolucao = mostrarDevolucao
    ? textoDevolucao({
        linhas: linhasDevolucao,
        cancelledAfterShipping: order.cancelledAfterShipping,
        returnedToSellerAt: order.returnedToSellerAt,
      })
    : null;

  return (
    <div className="pb-customer min-h-full bg-zinc-50/50">
      {/* Header Area (Not Sticky) */}
      <div className="px-6 pb-2 pt-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex flex-col items-start">
            <span className="mb-1 text-[9px] font-black uppercase leading-none tracking-[0.3em] text-zinc-400">
              Status em Tempo Real
            </span>
            <h1 className="text-xl font-black uppercase tracking-tighter text-zinc-900">
              Detalhes da <span className="text-zinc-400">Entrega</span>
            </h1>
          </div>
          {lojaTemWhatsappAgora && (
            <button
              onClick={handleWhatsAppSupport}
              // Laudo 05/09, M5: botão só-ícone era "botão" para o leitor
              // de tela — sem nome, pedir ajuda ficava sem significado.
              aria-label="Falar com a loja no WhatsApp"
              className="flex size-10 items-center justify-center rounded-xl border border-emerald-100/50 bg-emerald-50 text-emerald-600 transition-all active:scale-90"
            >
              <MessageCircle className="size-5" />
            </button>
          )}
        </div>

        {/* Quick Info Bar */}
        <div className="flex items-center justify-between gap-4 rounded-xl bg-zinc-950 p-3 text-white">
          <div className="flex flex-col">
            {/* Laudo 05/09, M6: `text-zinc-505` não existe no Tailwind — a
                cor nunca aplicava e o rótulo herdava o branco cru do fundo
                escuro; token real dá o cinza sutil que a barra pede. (Só o
                505 é morto aqui: 550/650 existem no tailwind.config.js —
                ver comentário do ícone Copy.) */}
            <span className="mb-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
              ID do Pedido
            </span>
            <div
              role="button"
              tabIndex={0}
              className="flex cursor-pointer items-center gap-1 rounded transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-white"
              onClick={handleCopyId}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCopyId();
                }
              }}
            >
              <span className="text-[10px] font-black uppercase tracking-widest">
                #{order.id.slice(0, 8)}
              </span>
              {/* Laudo Opus 07/09 (C2): `zinc-550` e `zinc-650` são tokens
                  VIVOS — o tailwind.config.js define os tons intermediários
                  550/650/750/850 de propósito. A troca por zinc-500/600 no
                  PR #437 mudava a cor que era aplicada; revertida. */}
              <Copy className="size-2.5 text-zinc-550" />
            </div>
          </div>
          <div className="h-6 w-px bg-zinc-800" />
          <div className="flex flex-col items-end">
            <span className="mb-0.5 text-[8px] font-black uppercase tracking-widest text-zinc-400">
              Data de Realização
            </span>
            <span className="text-[10px] font-black tracking-tight">
              {new Date(order.createdAt).toLocaleDateString("pt-BR")}
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-6 py-4">
        {/* Status Visual Block */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div
            className={cn(
              "absolute top-0 left-0 w-1.5 h-full",
              currentStatus.color.replace("text-", "bg-"),
            )}
          />

          <div className="mb-4 flex items-center gap-4">
            <div
              className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center shadow-md transition-transform hover:scale-105",
                currentStatus.bg,
              )}
            >
              <StatusIcon className={cn("w-5 h-5", currentStatus.color)} />
            </div>
            <div className="flex-1">
              <h3
                className={cn(
                  "text-base font-black uppercase tracking-tighter italic leading-none mb-1",
                  currentStatus.color,
                )}
              >
                {currentStatus.label}
              </h3>
              <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                {statusDescription}
              </p>
            </div>
          </div>

          {/* Progress Visual Mini-Timeline */}
          {order.status !== "cancelled" && (
            <div className="mt-4 flex items-center gap-1">
              {["pending", "processing", "shipping", "delivered"].map(
                (s, i) => {
                  const isPast =
                    ["pending", "processing", "shipping", "delivered"].indexOf(
                      order.status,
                    ) >= i;
                  return (
                    <div key={s} className="flex flex-1 flex-col gap-1.5">
                      <div
                        className={cn(
                          "h-1 rounded-full transition-all duration-1000",
                          isPast
                            ? currentStatus.color.replace("text-", "bg-")
                            : "bg-zinc-100",
                        )}
                      />
                    </div>
                  );
                },
              )}
            </div>
          )}

          {/* Rastreio (PEDIDO-060, #105).
              Só aparece quando existe código de verdade — ver `codigoDeRastreio`.
              Fica DENTRO do cartão de status porque é a resposta à única
              pergunta que traz o cliente a esta tela: "onde está meu pedido?". */}
          {codigoDeRastreio && (
            <div className="mt-4 border-t border-zinc-100 pt-4">
              <span className="mb-2 block text-[9px] font-black uppercase tracking-widest text-zinc-400">
                Código de Rastreio
              </span>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-xl bg-zinc-50 px-3 py-2.5 font-mono text-xs font-bold tracking-tight text-zinc-900">
                  {codigoDeRastreio}
                </code>
                <button
                  type="button"
                  onClick={handleCopyTracking}
                  title="Copiar código de rastreio"
                  className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-50 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 active:scale-95"
                >
                  {copiedTracking ? (
                    <Check className="size-4 text-emerald-500" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
                <a
                  href={`https://linkrastreio.com/?codigo=${encodeURIComponent(codigoDeRastreio)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Rastrear entrega"
                  className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl bg-zinc-900 px-4 text-[9px] font-black uppercase tracking-widest text-white transition-colors hover:bg-zinc-800 active:scale-95"
                >
                  <Truck className="size-3.5" />
                  Rastrear
                </a>
              </div>
            </div>
          )}

          {/* Laudo 0109 (B2): segunda chance do comprovante — ver o
              comentário do handleResendReceipt. Fora do bloco do cancelar
              de propósito: o reenvio faz sentido em QUALQUER estágio do
              pedido, inclusive entregue ou cancelado. */}
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <button
              onClick={handleResendReceipt}
              disabled={isResendingReceipt}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-50 text-[9px] font-black uppercase tracking-widest text-zinc-500 transition-all hover:bg-zinc-100 active:scale-[0.98] disabled:opacity-50"
            >
              {isResendingReceipt ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Mail className="size-3.5" />
              )}
              {isResendingReceipt
                ? "Reenviando"
                : "Reenviar comprovante por e-mail"}
            </button>
          </div>

          {/* Exige sessão: o convidado chega nesta tela pelo fallback de
              sessionStorage do loadOrder, e update_order_status_atomic passou a
              recusar chamador sem auth.uid() (PEDIDO-010, #115). Sem esta
              condição o botão continuaria visível e falharia sempre.
              'pending'/'processing'/'shipping': o divisor da regra do
              Gabriel (24/08/2026) é se o produto SAIU, não se foi pago —
              'delivered' fica fora, é devolução, outro assunto. */}
          {["pending", "processing", "shipping"].includes(order.status) &&
            user && (
              <div className="mt-4 border-t border-zinc-100 pt-4">
                <button
                  onClick={handleCancelOrder}
                  disabled={isCancelling}
                  // Laudo 05/09, M6: a classe de cor vermelha deste botão
                  // NÃO existia no Tailwind — a ação DESTRUTIVA de cancelar
                  // pedido perdeu o vermelho e herdou cor de botão comum.
                  // Token real de volta.
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-red-50 text-[9px] font-black uppercase tracking-widest text-red-600 transition-all hover:bg-red-100 active:scale-[0.98] disabled:bg-zinc-50 disabled:text-zinc-400"
                >
                  {isCancelling ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <XCircle className="size-3.5" />
                  )}
                  {isCancelling ? "Processando" : "Cancelar Pedido"}
                </button>
              </div>
            )}
        </motion.div>

        {/* Items List Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-zinc-900" />
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Composição do Pedido
            </h4>
          </div>

          <div className="space-y-4">
            {order.items.map((item: OrderItem, idx: number) => (
              <div key={idx} className="group flex items-center gap-4">
                <div className="relative size-14 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50 shadow-sm">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <h5 className="truncate text-[11px] font-black uppercase leading-none tracking-tight text-zinc-900 transition-colors group-hover:text-zinc-650">
                    {item.name}
                  </h5>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-md border border-zinc-100 bg-zinc-50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-400">
                      {item.quantity}x
                    </span>
                    <span className="text-xs font-black italic tracking-tight text-zinc-900">
                      R$ {item.price.toFixed(2).replace(".", ",")}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {/* ADMIN-090 (#101): com o interruptor "Avaliações dos
                      Clientes" desligado, a tela de pedido entregue não
                      oferece avaliar. */}
                  {user &&
                    config.enableReviews &&
                    order.status === "delivered" &&
                    (reviewedProductIds.has(item.productId) ? (
                      <span className="flex select-none items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[8px] font-bold uppercase tracking-wider text-emerald-700 duration-300 animate-in fade-in">
                        <Check className="size-2.5" />
                        Avaliado
                      </span>
                    ) : (
                      <button
                        onClick={(e) => {
                          avaliarTriggerRef.current = e.currentTarget;
                          setReviewingItem({
                            productId: item.productId,
                            productName: item.name,
                          });
                        }}
                        className="flex items-center gap-1 rounded-full border border-zinc-200/60 bg-zinc-50 px-2.5 py-1 text-[8px] font-black uppercase tracking-wider text-zinc-800 shadow-sm transition-all duration-300 hover:bg-zinc-100 hover:text-zinc-950 hover:shadow active:scale-95"
                      >
                        <Star className="size-2.5 fill-amber-400 text-amber-400" />
                        Avaliar
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Finance Detail Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="h-4 w-1 rounded-full bg-zinc-900" />
            <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Resumo da Transação
            </h4>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <span>Subtotal Bruto</span>
              <span className="text-zinc-900">
                R$ {order.subtotal.toFixed(2).replace(".", ",")}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              <span>Logística e Envio</span>
              <span
                className={cn(
                  order.shipping === 0
                    ? "text-emerald-700 font-extrabold"
                    : "text-zinc-900",
                )}
              >
                {order.shipping > 0
                  ? `R$ ${order.shipping.toFixed(2).replace(".", ",")}`
                  : "Grátis"}
              </span>
            </div>
            {order.discount > 0 && (
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <span>Benefício / Cupom</span>
                <span>- R$ {order.discount.toFixed(2).replace(".", ",")}</span>
              </div>
            )}
            <div className="my-3 h-px bg-zinc-100" />
            <div className="flex flex-col">
              <span className="mb-0.5 text-[8px] font-black uppercase tracking-wider text-zinc-400">
                Total Consolidado
              </span>
              <span className="text-xl font-black uppercase italic tracking-tight text-zinc-950">
                R$ {order.total.toFixed(2).replace(".", ",")}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Delivery & Payment Info Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Destino Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-zinc-400" />
                <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-900">
                  Endereço de Entrega
                </h4>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-black uppercase tracking-tight text-zinc-900">
                  {order.customer.name}
                </p>
                <p className="text-[10px] font-bold uppercase leading-relaxed tracking-wider text-zinc-400">
                  {order.customer.address}, {order.customer.number}
                  <br />
                  {/* Cidade do PEDIDO, nunca da loja — é o endereço de quem
                      comprou. Sem cidade no pedido, mostra só o bairro, sem
                      o "•" solto. */}
                  {order.customer.neighborhood}
                  {order.customer.city && ` • ${order.customer.city}`}
                </p>
              </div>
            </div>

            {/* Pagamento Section */}
            <div className="space-y-3 sm:border-l sm:border-zinc-100 sm:pl-6">
              <div className="flex items-center gap-2">
                <CreditCard className="size-4 text-zinc-400" />
                <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-900">
                  Forma de Pagamento
                </h4>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-black uppercase capitalize tracking-tight text-zinc-900">
                  {order.paymentMethod === "card"
                    ? "Cartão de Crédito"
                    : order.paymentMethod}
                </p>
                <CustomerPaymentBadge
                  paymentStatus={order.paymentStatus}
                  orderStatus={order.status}
                />
                {/* T7 do plano-mãe de estorno pelo app, corrigido na rodada 3
                    (laudo Opus PR#457, BLOQUEIA A/B): o selo acima é NEUTRO
                    para pago+cancelado (não afirma nem "fale com a loja" nem
                    "volta sozinho" — ele não tem a linha de devolução para
                    saber qual é verdade); quem afirma é esta linha e o card
                    de status acima, os dois lendo a MESMA `linhasDevolucao`.
                    Esta linha nunca mostra id do Mercado Pago nem texto
                    técnico de erro (ver `textoDevolucao`). */}
                {textoDaDevolucao && (
                  <p className="text-[9px] font-bold uppercase leading-relaxed tracking-widest text-zinc-500">
                    {textoDaDevolucao}
                  </p>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {reviewingItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in">
            <div
              className="fixed inset-0"
              onClick={fecharAvaliacao}
              role="button"
              aria-label="Fechar avaliacao"
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  fecharAvaliacao();
                }
              }}
            />
            {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- padrão APG de dialog: Esc no próprio container fecha (mesmo precedente em ImageAdjuster.tsx:1151) */}
            <div
              ref={avaliacaoFolhaRef}
              tabIndex={-1}
              className="relative z-10 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[2.5rem] bg-zinc-50 p-6 shadow-2xl duration-300 animate-in slide-in-from-bottom"
              role="dialog"
              aria-modal="true"
              aria-labelledby="titulo-avaliacao"
              // Laudo de acessibilidade 05/09 (onda 3, item B5): o Esc vivia
              // no backdrop acima (tabIndex={-1}, nunca alcançado por
              // teclado — o mesmo bug do menu de ordenar da home).
              // Rodada 2 (Codex, 08/09, item 1): trap simples de Tab — no
              // último focável, Tab volta ao primeiro; no primeiro,
              // Shift+Tab vai ao último. Sem isso o foco escapava para o
              // fundo da tela apesar do aria-modal.
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  fecharAvaliacao();
                  return;
                }
                if (e.key === "Tab") {
                  const focaveis =
                    e.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                    );
                  if (focaveis.length === 0) return;
                  const primeiro = focaveis[0];
                  const ultimo = focaveis[focaveis.length - 1];
                  if (e.shiftKey && document.activeElement === primeiro) {
                    e.preventDefault();
                    ultimo.focus();
                  } else if (!e.shiftKey && document.activeElement === ultimo) {
                    e.preventDefault();
                    primeiro.focus();
                  }
                }
              }}
            >
              {/* Header */}
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-400">
                    Avaliação do Produto
                  </span>
                  <h3
                    id="titulo-avaliacao"
                    className="mt-0.5 max-w-[280px] truncate text-base font-extrabold uppercase leading-tight text-zinc-900"
                  >
                    {reviewingItem.productName}
                  </h3>
                </div>
                <button
                  onClick={fecharAvaliacao}
                  // Laudo 05/09, M5: o nome acessível era "✕" — agora diz
                  // o que fecha.
                  aria-label="Fechar avaliação"
                  className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-650 transition-colors hover:bg-zinc-300 hover:text-zinc-900"
                >
                  ✕
                </button>
              </div>

              <ReviewForm
                productId={reviewingItem.productId}
                onSuccess={() => {
                  setReviewedProductIds((prev) => {
                    const next = new Set(prev);
                    next.add(reviewingItem.productId);
                    return next;
                  });
                  fecharAvaliacao();
                }}
              />
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

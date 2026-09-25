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
  ChevronRight,
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
    description: string;
  }
> = {
  pending: {
    label: "Pedido recebido",
    icon: Package,
    description:
      "Aguardando confirmação de pagamento para iniciar a separação.",
  },
  processing: {
    label: "Em separação",
    icon: Clock,
    description: "Seu pedido está sendo preparado com todo cuidado e atenção.",
  },
  shipping: {
    // Rodada 2 (revisor Opus, 25/09/2026): o rótulo dizia "Em Trânsito"
    // enquanto a linha do tempo do mesmo cartão (TIMELINE_STEPS, abaixo)
    // chamava a etapa atual de "A caminho" — dois nomes para o mesmo estado
    // dentro do MESMO cartão. Unificado para o vocabulário da linha do
    // tempo, que é quem o cliente lê primeiro.
    label: "A caminho",
    icon: Truck,
    description: "Seu pedido já saiu para entrega e chegará em breve.",
  },
  delivered: {
    label: "Entregue",
    icon: CheckCircle,
    description:
      "O pedido foi entregue com sucesso. Aproveite sua experiência!",
  },
  cancelled: {
    label: "Cancelado",
    icon: XCircle,
    description: "Este pedido foi cancelado e não seguirá para entrega.",
  },
};

/**
 * Redesenho visual (25/09/2026): o título grande do cabeçalho da ficha é uma
 * frase própria por status — diferente de `statusConfig[status].label`, que
 * continua existindo e aparece dentro do cartão de status (hero). As duas
 * coisas coexistem de propósito: este título fala com quem está lendo
 * ("Chegando até você"); o `label` do hero nomeia o estado do pedido em
 * frase normal ("A caminho").
 */
const heroTitleByStatus: Record<OrderStatus, string> = {
  pending: "Pedido recebido",
  processing: "Preparando seu pedido",
  shipping: "Chegando até você",
  delivered: "Chegou!",
  cancelled: "Pedido cancelado",
};

/**
 * A linha do tempo de 4 etapas do cartão de status. Mesma guarda de status
 * desconhecido do resto do arquivo (a mesma ideia de
 * `statusConfig[order.status as OrderStatus] || statusConfig.pending`, mais
 * abaixo): `indexOf` devolve -1 para um valor fora da lista (ex.: 'new'), e
 * -1 nunca é `>= i` nem `=== i` — nenhuma etapa fica marcada como passada ou
 * atual, mas a lista renderiza sem quebrar.
 */
const TIMELINE_STATUS_ORDER: OrderStatus[] = [
  "pending",
  "processing",
  "shipping",
  "delivered",
];
const TIMELINE_STEPS: Array<{
  status: OrderStatus;
  label: string;
  icon: LucideIcon;
}> = [
  { status: "pending", label: "Recebido", icon: Package },
  { status: "processing", label: "Separado", icon: Clock },
  { status: "shipping", label: "A caminho", icon: Truck },
  { status: "delivered", label: "Entregue", icon: CheckCircle },
];

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
    // Redesenho 25/09/2026: quando a folha abre a partir de uma estrela do
    // cartão "O que achou da compra?", a nota já vem pré-selecionada — abrir
    // pelo botão "Escrever avaliação" deixa isto `undefined` (0 estrelas).
    rating?: number;
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
        <p className="text-sm font-semibold text-zinc-500">
          Sincronizando pedido…
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
        <h2 className="mb-2 text-xl font-black tracking-tighter text-zinc-900">
          Pedido não encontrado
        </h2>
        <p className="mb-8 text-sm font-medium leading-relaxed text-zinc-500">
          Não conseguimos localizar as informações deste pedido em nosso
          sistema.
        </p>
        <button
          onClick={onBack}
          className="h-12 rounded-2xl bg-zinc-900 px-8 text-sm font-bold text-white transition-all active:scale-95"
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

  // Cartão "O que achou da compra?" (redesenho 25/09/2026) — mesma trava de
  // sempre (ADMIN-090, #101): sem `enableReviews`, sem `user`, ou fora de
  // `delivered`, o cartão inteiro não existe (nada de "cartão vazio").
  const mostrarCartaoDeAvaliacao =
    !!user && config.enableReviews && order.status === "delivered";
  // Um produto por `productId`, sem duplicar — o mesmo pedido pode ter mais
  // de uma linha do MESMO produto (ex.: variantes diferentes).
  const produtosParaAvaliar: OrderItem[] = [];
  const productIdsJaListados = new Set<string>();
  for (const item of order.items) {
    if (!productIdsJaListados.has(item.productId)) {
      productIdsJaListados.add(item.productId);
      produtosParaAvaliar.push(item);
    }
  }
  const totalProdutosAvaliados = produtosParaAvaliar.filter((item) =>
    reviewedProductIds.has(item.productId),
  ).length;
  const proximoProdutoNaoAvaliado = produtosParaAvaliar.find(
    (item) => !reviewedProductIds.has(item.productId),
  );
  const timelineIndex = TIMELINE_STATUS_ORDER.indexOf(
    order.status as OrderStatus,
  );

  // BLOQUEIA B1 (revisor Opus, rodada 2, 25/09/2026): "Total pago" só é
  // verdade quando o dinheiro de fato entrou — mesma chave
  // (`chaveDoPagamento`, calculada acima para `mostrarDevolucao`) que decide
  // a descrição e o selo — E o pedido não está cancelado. Cancelado nunca
  // afirma "pago" aqui, mesmo com dinheiro confirmado: quem conta essa
  // história é `cancelledDescription`/`textoDevolucao`, não o rótulo do
  // total. Antes desta correção "Total pago" aparecia também para PIX
  // `aguardando`, `recusado`, `expirado`, `estornado` e pagamento na entrega
  // ainda não confirmado — uma afirmação falsa sobre dinheiro.
  const dinheiroConfirmado =
    chaveDoPagamento === "pago" ||
    chaveDoPagamento === "pago_apos_expirar" ||
    chaveDoPagamento === "recebido_na_entrega";
  const rotuloDoTotal =
    order.status !== "cancelled" && dinheiroConfirmado ? "Total pago" : "Total";

  return (
    <div className="pb-customer min-h-full bg-zinc-50/50">
      {/* Cabeçalho */}
      <div className="px-6 pb-2 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-zinc-500">Meu pedido</p>
            <h1 className="mt-0.5 text-2xl font-black tracking-tighter text-zinc-900">
              {heroTitleByStatus[order.status as OrderStatus] ||
                heroTitleByStatus.pending}
            </h1>
          </div>
          {lojaTemWhatsappAgora && (
            <button
              onClick={handleWhatsAppSupport}
              // Laudo 05/09, M5: botão só-ícone era "botão" para o leitor
              // de tela — sem nome, pedir ajuda ficava sem significado.
              aria-label="Falar com a loja no WhatsApp"
              className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-emerald-100/50 bg-emerald-50 text-emerald-600 transition-all active:scale-90"
            >
              <MessageCircle className="size-5" />
            </button>
          )}
        </div>

        {/* Chips: ID do pedido (copiável) e data */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div
            role="button"
            tabIndex={0}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-100 bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 shadow-sm transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-zinc-900/20"
            onClick={handleCopyId}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleCopyId();
              }
            }}
          >
            <span className="font-mono">#{order.id.slice(0, 8)}</span>
            {/* Laudo Opus 07/09 (C2): `zinc-550` é token VIVO — o
                tailwind.config.js define os tons intermediários
                550/650/750/850 de propósito. */}
            <Copy className="size-3 text-zinc-550" />
          </div>
          <span className="rounded-full border border-zinc-100 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 shadow-sm">
            {new Date(order.createdAt).toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-6 py-4">
        {/* Cartão de status (hero) */}
        <motion.div
          data-testid="cartao-status"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "relative overflow-hidden rounded-3xl p-5 shadow-sm",
            order.status === "delivered"
              ? // BLOQUEIA B2 (revisor Opus, rodada 2, 25/09/2026): o
                // degradê antigo (emerald-400→600→700) reprovava AA — o
                // texto sentava sobre o emerald-400 claro, e mesmo o
                // emerald-600 mede 3,77:1 contra branco (abaixo do mínimo
                // 4,5:1). emerald-700 já mede 5,48:1; este degradê fica
                // inteiro em 700-900, nunca mais claro que 700 em ponto
                // nenhum do cartão.
                "bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 text-white"
              : order.status === "cancelled"
                ? "border border-red-100 bg-white text-zinc-900"
                : "bg-gradient-to-br from-zinc-700 via-zinc-900 to-zinc-950 text-white",
          )}
        >
          <div className="flex items-center gap-3.5">
            <div
              className={cn(
                "flex size-12 flex-shrink-0 items-center justify-center rounded-2xl",
                order.status === "cancelled" ? "bg-red-50" : "bg-white/15",
              )}
            >
              <StatusIcon
                className={cn(
                  "size-5",
                  order.status === "cancelled" ? "text-red-600" : "text-white",
                )}
              />
            </div>
            <div className="min-w-0">
              <h2
                className={cn(
                  "text-lg font-black tracking-tight",
                  order.status === "cancelled" && "text-red-700",
                )}
              >
                {currentStatus.label}
              </h2>
              {order.status !== "cancelled" && (
                // BLOQUEIA B2: `text-white/80` reprovava AA sobre o
                // emerald-400/600 antigo do cartão entregue — branco sólido
                // nunca reprova, em qualquer um dos fundos escuros deste
                // cartão (dark ou emerald).
                <p className="mt-0.5 text-[13px] leading-snug text-white">
                  {statusDescription}
                </p>
              )}
            </div>
          </div>

          {/* Linha do tempo de 4 etapas — some no cancelado, que tem seu
              próprio quadro de aviso logo abaixo. */}
          {order.status !== "cancelled" && (
            <div className="relative mt-5 flex items-start justify-between gap-1">
              {/* Trilha atrás dos nós (ajuste visual pedido na rodada 2):
                  `inset-x-3.5` (14px) inset até o CENTRO do
                  primeiro e do último nó (`size-7` = 28px, metade = 14px) —
                  o preenchimento é filho desta trilha, então a % do
                  `style.width` é relativa à própria trilha, nunca à linha
                  inteira. */}
              <div className="absolute inset-x-3.5 top-3.5 h-0.5 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-white transition-all duration-700"
                  style={{
                    width: `${(Math.max(timelineIndex, 0) / (TIMELINE_STEPS.length - 1)) * 100}%`,
                  }}
                />
              </div>
              {TIMELINE_STEPS.map((step, i) => {
                const isPast = timelineIndex > i;
                const isCurrent = timelineIndex === i;
                const StepIcon = step.icon;
                return (
                  <div
                    key={step.status}
                    // `relative` (mesmo com offset 0): sem isso, a trilha
                    // `absolute` acima pintaria POR CIMA dos nós — elemento
                    // posicionado pinta depois de elemento estático na mesma
                    // pilha, mesmo vindo antes no DOM. Com os dois
                    // posicionados, a ordem do DOM decide, e a trilha
                    // (declarada primeiro) fica atrás.
                    className="relative flex flex-1 flex-col items-center gap-1.5"
                  >
                    <div
                      className={cn(
                        "flex size-7 items-center justify-center rounded-full transition-colors",
                        isPast
                          ? order.status === "delivered"
                            ? "bg-white text-emerald-700"
                            : "bg-white text-zinc-900"
                          : isCurrent
                            ? "bg-white text-zinc-900 ring-4 ring-white/25"
                            : "border border-white/25 text-white/40",
                      )}
                    >
                      {isPast ? (
                        <Check className="size-3.5" />
                      ) : (
                        <StepIcon className="size-3.5" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-center text-[10px] font-semibold leading-none",
                        isPast || isCurrent ? "text-white" : "text-white/40",
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cancelado: a descrição (cancelledDescription, sem mudar uma
              vírgula) vai num quadro de aviso, não sob o título. */}
          {order.status === "cancelled" && (
            <div className="mt-4 flex gap-2.5 rounded-2xl bg-red-50 p-3">
              <Clock className="mt-0.5 size-4 flex-shrink-0 text-red-600" />
              <p className="text-[13px] leading-relaxed text-red-800">
                {statusDescription}
              </p>
            </div>
          )}

          {/* Rastreio (PEDIDO-060, #105).
              Só aparece quando existe código de verdade — ver `codigoDeRastreio`.
              Fica DENTRO do cartão de status porque é a resposta à única
              pergunta que traz o cliente a esta tela: "onde está meu pedido?". */}
          {codigoDeRastreio && (
            <div
              className={cn(
                "mt-4 flex items-center gap-2 rounded-2xl p-3",
                order.status === "cancelled" ? "bg-zinc-50" : "bg-white/10",
              )}
            >
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-[10px] font-semibold",
                    // BLOQUEIA B2: mesmo motivo do parágrafo de descrição —
                    // `text-white/60` reprovava AA sobre o cartão entregue.
                    order.status === "cancelled"
                      ? "text-zinc-500"
                      : "text-white",
                  )}
                >
                  Código de rastreio
                </span>
                <code
                  className={cn(
                    "block truncate font-mono text-xs font-bold tracking-tight",
                    order.status === "cancelled"
                      ? "text-zinc-900"
                      : "text-white",
                  )}
                >
                  {codigoDeRastreio}
                </code>
              </div>
              <button
                type="button"
                onClick={handleCopyTracking}
                title="Copiar código de rastreio"
                className={cn(
                  "flex size-9 flex-shrink-0 items-center justify-center rounded-xl transition-colors active:scale-95",
                  order.status === "cancelled"
                    ? "bg-white text-zinc-500 hover:text-zinc-900"
                    : // BLOQUEIA B2: ícone em branco sólido — só o fundo
                      // muda de opacidade no hover, nunca o texto/ícone.
                      "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                {copiedTracking ? (
                  <Check className="size-4 text-emerald-400" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
              <a
                href={`https://linkrastreio.com/?codigo=${encodeURIComponent(codigoDeRastreio)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Rastrear entrega"
                className={cn(
                  "flex h-9 flex-shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors active:scale-95",
                  order.status === "cancelled"
                    ? "bg-zinc-900 text-white hover:bg-zinc-800"
                    : "bg-white text-zinc-900 hover:bg-white/90",
                )}
              >
                <Truck className="size-3.5" />
                Rastrear
              </a>
            </div>
          )}

          {/* Espaço reservado: botão "Continuar pagamento Pix" do PR #648 entra aqui */}
        </motion.div>

        {/* Cartão "O que achou da compra?" — em destaque, redesenho 25/09/2026 */}
        {mostrarCartaoDeAvaliacao && (
          <motion.div
            data-testid="cartao-avaliacao"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="rounded-3xl border border-amber-200/60 bg-gradient-to-b from-amber-50 to-white p-5 shadow-sm"
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <h4 className="text-[15px] font-extrabold tracking-tight text-zinc-900">
                O que achou da compra?
              </h4>
              <span className="flex-shrink-0 text-xs font-semibold text-zinc-500">
                {totalProdutosAvaliados} de {produtosParaAvaliar.length}{" "}
                avaliados
              </span>
            </div>

            <div className="space-y-4">
              {produtosParaAvaliar.map((item) => {
                const avaliado = reviewedProductIds.has(item.productId);
                return (
                  <div key={item.productId} className="flex items-start gap-3">
                    <div className="size-14 flex-shrink-0 overflow-hidden rounded-xl border border-zinc-100 bg-zinc-50">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="size-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-zinc-900">
                        {item.name}
                      </p>
                      {avaliado ? (
                        <span className="mt-1.5 inline-flex select-none items-center gap-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 duration-300 animate-in fade-in">
                          <Check className="size-3" />
                          Avaliado
                        </span>
                      ) : (
                        <div className="mt-1.5 flex gap-1">
                          {[1, 2, 3, 4, 5].map((nota) => (
                            <button
                              key={nota}
                              type="button"
                              aria-label={`Dar ${nota} ${nota === 1 ? "estrela" : "estrelas"} para ${item.name}`}
                              onClick={(e) => {
                                avaliarTriggerRef.current = e.currentTarget;
                                setReviewingItem({
                                  productId: item.productId,
                                  productName: item.name,
                                  rating: nota,
                                });
                              }}
                              className="flex size-10 items-center justify-center rounded-lg text-amber-400 transition-transform active:scale-90"
                            >
                              <Star className="size-5 fill-amber-400" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {proximoProdutoNaoAvaliado && (
              <button
                type="button"
                onClick={(e) => {
                  avaliarTriggerRef.current = e.currentTarget;
                  setReviewingItem({
                    productId: proximoProdutoNaoAvaliado.productId,
                    productName: proximoProdutoNaoAvaliado.name,
                  });
                }}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-zinc-900 text-sm font-bold text-white transition-all active:scale-[0.98]"
              >
                <Star className="size-4 fill-amber-400 text-amber-400" />
                Escrever avaliação
              </button>
            )}
          </motion.div>
        )}

        {/* Cartão "Itens do pedido" */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <div className="mb-4 flex items-center justify-between">
            <h4 className="text-[15px] font-extrabold tracking-tight text-zinc-900">
              Itens do pedido
            </h4>
            <span className="text-xs font-semibold text-zinc-500">
              {order.items.length} {order.items.length === 1 ? "item" : "itens"}
            </span>
          </div>

          <div className="space-y-4">
            {order.items.map((item: OrderItem, idx: number) => (
              <div
                key={idx}
                className={cn(
                  "group flex items-center gap-3.5",
                  order.status === "cancelled" && "opacity-60",
                )}
              >
                <div className="relative size-14 flex-shrink-0 overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-50">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  <h5 className="truncate text-sm font-bold leading-tight text-zinc-900 transition-colors group-hover:text-zinc-650">
                    {item.name}
                  </h5>
                  <p className="mt-0.5 text-xs font-medium text-zinc-500">
                    Qtd. {item.quantity}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex-shrink-0 text-sm font-bold",
                    order.status === "cancelled"
                      ? "text-zinc-500 line-through"
                      : "text-zinc-900",
                  )}
                >
                  R$ {item.price.toFixed(2).replace(".", ",")}
                </span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Cartão "Resumo" */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          <h4 className="mb-3 text-[15px] font-extrabold tracking-tight text-zinc-900">
            Resumo
          </h4>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[13px] font-medium text-zinc-600">
              <span>Produtos</span>
              <span className="font-bold text-zinc-900">
                R$ {order.subtotal.toFixed(2).replace(".", ",")}
              </span>
            </div>
            <div className="flex items-center justify-between text-[13px] font-medium text-zinc-600">
              <span>Frete</span>
              <span
                className={cn(
                  "font-bold",
                  order.shipping === 0 ? "text-emerald-700" : "text-zinc-900",
                )}
              >
                {order.shipping > 0
                  ? `R$ ${order.shipping.toFixed(2).replace(".", ",")}`
                  : "Grátis"}
              </span>
            </div>
            {order.discount > 0 && (
              <div className="flex items-center justify-between text-[13px] font-bold text-emerald-700">
                <span>Desconto</span>
                <span>- R$ {order.discount.toFixed(2).replace(".", ",")}</span>
              </div>
            )}
            <div className="my-3 border-t border-dashed border-zinc-200" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-zinc-500">
                {rotuloDoTotal}
              </span>
              <span
                className={cn(
                  "text-2xl font-black tracking-tight",
                  order.status === "cancelled"
                    ? "text-zinc-500"
                    : "text-zinc-950",
                )}
              >
                R$ {order.total.toFixed(2).replace(".", ",")}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Cartão de informações: endereço e pagamento */}
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm"
        >
          {/* Destino */}
          <div className="flex items-start gap-3">
            <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-100">
              <MapPin className="size-4 text-zinc-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-zinc-500">
                {order.retiradaNaLoja
                  ? "Retirada na loja"
                  : "Endereço de entrega"}
              </p>
              {order.retiradaNaLoja && (
                // O endereço REAL da loja no momento da compra, e o aviso
                // neutro — nenhum prazo inventado: a loja confirma quando
                // o pedido está separado.
                <div className="mt-1 space-y-0.5">
                  <p className="text-sm font-bold text-zinc-900">
                    Retire em: {order.enderecoDeRetirada}
                  </p>
                  <p className="text-xs font-medium leading-relaxed text-zinc-500">
                    Aguarde a confirmação da loja para retirar.
                  </p>
                  <p className="pt-1.5 text-xs font-semibold text-zinc-500">
                    Seu endereço
                  </p>
                </div>
              )}
              <p className="mt-1 text-sm font-bold text-zinc-900">
                {order.customer.name}
              </p>
              <p className="mt-0.5 text-xs font-medium leading-relaxed text-zinc-500">
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

          {/* Pagamento */}
          <div className="mt-4 flex items-start gap-3 border-t border-zinc-100 pt-4">
            <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-100">
              <CreditCard className="size-4 text-zinc-500" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="text-xs font-semibold text-zinc-500">Pagamento</p>
              <p className="text-sm font-bold capitalize tracking-tight text-zinc-900">
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
                <p className="text-xs font-medium leading-relaxed text-zinc-500">
                  {textoDaDevolucao}
                </p>
              )}
            </div>
          </div>
        </motion.div>

        {/* Lista de ações */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="overflow-hidden rounded-3xl border border-zinc-100 bg-white shadow-sm"
        >
          {lojaTemWhatsappAgora && (
            <button
              onClick={handleWhatsAppSupport}
              className="flex w-full items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left text-sm font-semibold text-zinc-900 transition-colors last:border-b-0 hover:bg-zinc-50 active:bg-zinc-100"
            >
              <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <MessageCircle className="size-4" />
              </span>
              Falar com a loja
              <ChevronRight className="ml-auto size-4 flex-shrink-0 text-zinc-400" />
            </button>
          )}

          {/* Laudo 0109 (B2): segunda chance do comprovante — ver o
              comentário do handleResendReceipt. Fora do bloco do cancelar
              de propósito: o reenvio faz sentido em QUALQUER estágio do
              pedido, inclusive entregue ou cancelado. */}
          <button
            onClick={handleResendReceipt}
            disabled={isResendingReceipt}
            className="flex w-full items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left text-sm font-semibold text-zinc-900 transition-colors last:border-b-0 hover:bg-zinc-50 active:bg-zinc-100 disabled:opacity-50"
          >
            <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              {isResendingReceipt ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
            </span>
            {isResendingReceipt ? "Reenviando…" : "Reenviar comprovante"}
            <ChevronRight className="ml-auto size-4 flex-shrink-0 text-zinc-400" />
          </button>

          {/* Exige sessão: o convidado chega nesta tela pelo fallback de
              sessionStorage do loadOrder, e update_order_status_atomic passou a
              recusar chamador sem auth.uid() (PEDIDO-010, #115). Sem esta
              condição o botão continuaria visível e falharia sempre.
              'pending'/'processing'/'shipping': o divisor da regra do
              Gabriel (24/08/2026) é se o produto SAIU, não se foi pago —
              'delivered' fica fora, é devolução, outro assunto. */}
          {["pending", "processing", "shipping"].includes(order.status) &&
            user && (
              <button
                onClick={handleCancelOrder}
                disabled={isCancelling}
                className="flex w-full items-center gap-3 border-b border-zinc-100 px-5 py-3.5 text-left text-sm font-semibold text-red-600 transition-colors last:border-b-0 hover:bg-red-50 active:bg-red-100 disabled:opacity-50"
              >
                <span className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
                  {isCancelling ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                </span>
                {isCancelling ? "Processando" : "Cancelar Pedido"}
                <ChevronRight className="ml-auto size-4 flex-shrink-0 text-red-200" />
              </button>
            )}
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
                initialRating={reviewingItem.rating}
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

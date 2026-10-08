import { LazyImage } from "@/components/LazyImage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import {
  fraseDeEsperaDoPedido,
  idadeDoPedidoPendente,
} from "@/lib/idade-do-pedido-pendente";
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { supabase } from "@/lib/supabase";
import { textoCancelamentoDoPainel } from "@/lib/texto-cancelamento-do-painel";
import { cn } from "@/lib/utils";
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import type { Order, OrderStatus, PaymentMethod, PaymentStatus } from "@/types";
import {
  Check,
  Clock,
  Copy,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  Printer,
  Truck,
  X,
  XCircle,
} from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DevolucaoDoPedidoAdminCard } from "./DevolucaoDoPedidoAdminCard";
import { EstornoCard } from "./EstornoCard";
import { EtiquetaDoPedidoCard } from "./EtiquetaDoPedidoCard";
import { OrderReceipt } from "./OrderReceipt";
import {
  OrderStatusBadge,
  PaymentStatusBadge,
  rotuloDoPagamento,
  statusConfig,
} from "./OrderStatusBadge";
import { podeRegistrarPagamento } from "./podeRegistrarPagamento";

const statusFlow: OrderStatus[] = [
  "pending",
  "processing",
  "shipping",
  "delivered",
];

// Os três estados em que a cobrança online não se resolveu a favor do
// lojista: dinheiro ainda não entrou (ou não vai entrar). Avançar o pedido
// nesses estados encaminha mercadoria sem o dinheiro confirmado — por isso
// pedem confirmação. `pago`, `pago_apos_expirar` e `null` (sem cobrança
// online, ex.: pagamento na entrega) não entram aqui: são fluxo legítimo e
// avisar ali transformaria o aviso em ruído.
//
// Falta um SEXTO valor nesta conta, e a omissão é deliberada: `expirado`
// (o PIX venceu e o dinheiro nunca entrou) pertenceria à lista pelo
// critério acima, e não está nela porque HOJE ele nunca aparece sozinho —
// todo escritor de `payment_status='expirado'` grava `status='cancelled'`
// no mesmo UPDATE (`expirar_pedidos_vencidos`, e o backfill de
// 20260807000002), e pedido cancelado não mostra o botão "Avançar". Ou
// seja: a lista está certa por uma garantia que mora em OUTRO arquivo.
//
// ! Se algum dia existir caminho que deixe um `expirado` com status vivo
// (um "reabrir pedido", uma reconciliação que marque sem cancelar), o
// aviso deixa de disparar EM SILÊNCIO no caso mais óbvio de "não pagou".
// Achado da 2ª revisão da ficha, que derrubou o próprio achado para hoje e
// registrou o gatilho. O tipo `PaymentStatus[]` não obriga ninguém a
// decidir sobre valor novo — se a união crescer, esta linha não reclama.
//
// VERIFICADO (Task 3c do plano
// docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md): a revisão
// avaliou `recebido_na_entrega` como oitavo candidato a este array e
// refutou por polaridade — esta lista é de "NÃO pagou"
// (`aguardando`/`recusado`/`estornado`), e `recebido_na_entrega` é
// exatamente o dinheiro entrando pela mão da loja. Ficar de fora é o
// comportamento certo: o botão "Avançar" não precisa pedir confirmação
// quando o pagamento já foi confirmado. Não reabrir isto sem fato novo.
const paymentStatusQuePedeConfirmacao: PaymentStatus[] = [
  "aguardando",
  "recusado",
  "estornado",
];

const getNextStatus = (current: OrderStatus): OrderStatus | null => {
  const currentIndex = statusFlow.indexOf(current);
  if (currentIndex < statusFlow.length - 1) {
    return statusFlow[currentIndex + 1];
  }
  return null;
};

// `Map` em vez de indexação dinâmica — mesma razão de `statusConfigByKey`
// em useOrders.ts: `statusConfig[chave]` acende
// `security/detect-object-injection` no eslint-plugin-security mesmo a
// chave vindo de uma união fechada.
const statusConfigByKey = new Map(Object.entries(statusConfig));

// Rótulo do método de pagamento na ficha. T3 (lote B, 12/09): "Rede PIX" e
// "Rede Crédito" eram vocabulário de operador — passam a ser "PIX" e
// "Cartão de crédito", como o lojista fala.
// "online" existe desde a Fase 2 (CHECKOUT-010): pedido cobrado no site
// via Mercado Pago, não confundir com dinheiro na entrega — quem lança o
// caixa a partir daqui não pode ler "Dinheiro Espécie" e cobrar de novo.
const getPaymentMethodLabel = (method: PaymentMethod) => {
  if (method === "pix") return "PIX";
  if (method === "card") return "Cartão de crédito";
  if (method === "online") return "Pagamento Online";
  return "Dinheiro Espécie";
};

// T3 (lote B, 12/09) — a frase-situação do dinheiro no cabeçalho da seção
// Pagamento (emprestada da direção "Dinheiro primeiro"): a primeira dúvida
// ao abrir a ficha é "esse pedido está pago?". Uma linha, derivada SÓ de
// dados que já existem no pedido — nenhuma regra nova de dinheiro aqui.
//
// 🔴 A fonte do "estado do dinheiro" é a MESMA do selo (`rotuloDoPagamento`,
// de OrderStatusBadge): é ela que resolve o cruzamento pago+cancelado →
// "Pago e cancelado — precisa de atenção" (e os outros casos de atenção).
// Quando o selo pede atenção, a frase REPETE o veredito dele — frase e selo
// saem da mesma decisão e não podem discordar justamente no caso em que o
// dinheiro está preso. Só os casos SEM atenção pendente ganham frase de
// contexto (site/entrega).
function fraseSituacaoDoPagamento(order: Order): string {
  const valor = (order?.total || 0).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  });
  const rotuloDoSelo = rotuloDoPagamento(
    order.paymentStatus,
    order.status,
    order.canal,
  );
  if (rotuloDoSelo.includes("precisa de atenção")) {
    return `${rotuloDoSelo} · R$ ${valor}`;
  }
  // Pedido CANCELADO sem dinheiro entrado (achado 2, menor, da revisão
  // cruzada do PR 549): "Falta receber na entrega" num pedido morto mandava
  // o lojista cobrar quem nunca vai pagar — o próprio
  // `podeRegistrarPagamento` já esconde o botão nesses pedidos. Os casos em
  // que o dinheiro ENTROU e o pedido morreu (pago, recebido_na_entrega)
  // caíram no ramo de atenção acima; o que chega aqui é "nada entrou, nada
  // se deve" — cobre também o online aguardando num pedido já cancelado.
  if (order.status === "cancelled") {
    return "Cancelado · nada a receber";
  }
  // Pagamento na entrega (cash/pix/card): quem decide "entrou" é o registro
  // do recebimento — a MESMA verdade que decide o botão "Marcar como
  // recebido" (`podeRegistrarPagamento`). `recebido_na_entrega` + cancelado
  // já caiu no ramo de atenção acima.
  if (order.paymentMethod !== "online") {
    // D1 (lote C4): o banco não ganhou canal como oitavo payment_status — a
    // venda de balcão grava o MESMO `recebido_na_entrega`/pagamento pendente
    // de sempre. Só a FRASE muda de "entrega" para "balcão" quando o canal
    // é presencial; sem canal presencial, nada muda.
    if (order.canal === "presencial") {
      return order.pagamentoRecebidoEm
        ? `Recebido no balcão · R$ ${valor}`
        : `Falta receber no balcão · R$ ${valor}`;
    }
    return order.pagamentoRecebidoEm
      ? `Recebido na entrega · R$ ${valor}`
      : `Falta receber na entrega · R$ ${valor}`;
  }
  // Cobrança pelo site, sem atenção pendente.
  if (order.paymentStatus === "pago") {
    return `Pago no site · R$ ${valor}`;
  }
  if (order.paymentStatus === "aguardando") {
    return `Aguardando pagamento no site · R$ ${valor}`;
  }
  if (order.paymentStatus === "recusado") {
    return `Pagamento recusado no site · R$ ${valor}`;
  }
  if (order.paymentStatus === "expirado") {
    return `Pagamento expirado no site · R$ ${valor}`;
  }
  // `null` com cobrança online não existe na prática (a cobrança nasce
  // "aguardando"); se aparecer, o rótulo do selo é a frase — sem inventar.
  return `${rotuloDoSelo} · R$ ${valor}`;
}

interface OrderDetailProps {
  order: Order;
  onBack?: () => void;
  onStatusChange: (
    orderId: string,
    status: OrderStatus,
  ) => Promise<void> | void;
  isOffline?: boolean;
  /**
   * Task 4b do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
   * — a função CRUA do hook (`useOrders.registrarPagamentoRecebido`), que
   * LANÇA em caso de falha. Não é o wrapper que `AdminOrdersView` usa no
   * cartão da lista (`handleRegistrarPagamento`, que engole o erro pra não
   * duplicar toast): a ficha precisa SABER se a gravação falhou antes de
   * decidir se avança o status (ver `confirmarRecebimentoEAvancar` abaixo),
   * e um wrapper que sempre resolve não deixaria ela saber.
   *
   * Opcional só para não quebrar os testes que montam `<OrderDetail>`
   * direto sem essa prop (ex.: painel-avisa-pedido-pago-e-cancelado.test.tsx).
   * Em produção, `AdminOrdersView` sempre passa.
   */
  onRegistrarPagamento?: (
    orderId: string,
    recebido: boolean,
  ) => Promise<unknown>;
  /**
   * A-3 (laudo varredura 01/09): nome da LOJA para o recibo impresso, vindo
   * de cima (`AdminOrdersView`, que lê `config.storeName` do useStore).
   * Opcional: os testes que montam `<OrderDetail>` direto sem a prop fazem o
   * recibo cair no fallback do branding (ver OrderReceiptProps).
   */
  storeName?: string;
  /**
   * Leva à tela de Devoluções (o card de devolução do produto abre a
   * devolução escolhida lá). Opcional pelo mesmo motivo das outras: testes
   * montam `<OrderDetail>` sem ela, e aí o card só informa.
   */
  onAbrirDevolucoes?: () => void;
}

const globalSkuCache: Record<string, string> = {};

// Redesenho da ficha (08/10/2026, aprovado pelo dono): a MESMA linguagem do
// card de pedido redesenhado em 07/10 (`AdminOrderCard`) — blocos
// `rounded-2xl border-white/5 bg-white/[0.03]`, sem vidro pesado nem brilho,
// rótulos em minúsculas com inicial maiúscula, nada abaixo de 12px. Só
// APARÊNCIA e ORDEM mudaram: nenhuma regra de dinheiro, status ou permissão.
const blocoDaFicha = "rounded-2xl border border-white/5 bg-white/[0.03]";
const tituloDoBloco = "text-sm font-medium text-zinc-200";

// Os selos de status vêm de `OrderStatusBadge.tsx` (componente compartilhado
// com a lista, escrito em caixa alta de 9px e com `truncate`). Aqui, por
// fora, o texto do selo ganha a escala da ficha e QUEBRA linha em vez de
// virar "PAGO E CANCELADO — PRECIS…" — sem tocar no componente dos outros
// usos (que continua como está).
const seloDaFicha =
  "selo-ficha w-fit [&>span]:whitespace-normal [&>span]:text-xs [&>span]:font-semibold [&>span]:normal-case [&>span]:tracking-normal";

// Mesmo número que o resto da ficha sempre mostrou (`toLocaleString` pt-BR com
// duas casas) — só deixou de repetir a chamada em cada linha.
const formatarValor = (valor: number) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

function ItemSkuBadge({
  loading,
  itemSku,
  productId,
}: Readonly<{
  loading: boolean;
  itemSku?: string;
  productId?: string;
}>) {
  if (loading) {
    return (
      <span className="animate-pulse font-mono text-xs text-zinc-400">
        Carregando SKU...
      </span>
    );
  }
  if (itemSku) {
    return (
      <span className="rounded bg-admin-gold/10 px-1.5 py-0.5 font-mono text-xs text-admin-gold">
        SKU: {itemSku}
      </span>
    );
  }
  // Achado 15 da auditoria de 20/08/2026: sem SKU e sem produto vinculado
  // (item.productId vazio — product_id nulo no banco), a tela imprimia
  // "ID: #" sozinho, um campo com cara de quebrado. Sem id nenhum para
  // mostrar, o campo inteiro some em vez de aparecer vazio.
  if (!productId) {
    return null;
  }
  return (
    <span className="font-mono text-xs text-zinc-400">
      ID: #{productId.slice(-6)}
    </span>
  );
}

// Cabeçalho da ficha: título curto, data e hora, e a frase de espera (pedido
// pendente parado) em linha discreta. Os botões de ação moram na barra fixa
// do topo (`OrderActionBar`, pedido do dono 20/09). O status do PEDIDO já é
// lido na trilha e a situação do PAGAMENTO mora no bloco do dinheiro (uma
// vez só) — por isso nenhum dos dois selos fica aqui, com TRÊS exceções:
//  - pedido CANCELADO não tem trilha: o aviso "Pedido cancelado" é o status;
//  - status FORA da trilha que não seja cancelado (ex.: `new`, desconhecido):
//    o selo do pedido fica aqui, senão a ficha não diria em que pé ele está;
//  - pagamento que "precisa de atenção" (pago e cancelado, estornado, pago
//    fora do fluxo): o selo continua no TOPO, onde o olho cai primeiro — o
//    dinheiro preso não pode ficar só no meio da ficha.
interface OrderHeaderProps {
  order: Order;
  avisoDeEspera: string | null;
}

function OrderHeader({ order, avisoDeEspera }: Readonly<OrderHeaderProps>) {
  const criadoEm = new Date(order.createdAt);
  const data = criadoEm.toLocaleDateString("pt-BR");
  const hora = criadoEm.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const statusForaDaTrilha =
    order.status !== "cancelled" && !statusFlow.includes(order.status);
  const pagamentoPedeAtencao = rotuloDoPagamento(
    order.paymentStatus,
    order.status,
    order.canal,
  ).includes("precisa de atenção");

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-medium leading-tight tracking-tight text-white">
          Pedido{" "}
          <span className="text-admin-gold">#{numeroDoPedido(order.id)}</span>
        </h1>
        {statusForaDaTrilha && (
          <OrderStatusBadge status={order.status} className={seloDaFicha} />
        )}
      </div>
      <p className="text-sm tabular-nums text-zinc-400">
        {data} às {hora}
      </p>

      {pagamentoPedeAtencao && (
        <PaymentStatusBadge
          paymentStatus={order.paymentStatus}
          orderStatus={order.status}
          canal={order.canal}
          className={seloDaFicha}
        />
      )}

      {order.status === "cancelled" && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-3.5">
          <XCircle className="mt-0.5 size-5 shrink-0 text-red-400" />
          <div>
            <p className="text-sm font-medium text-red-300">Pedido cancelado</p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Este pedido foi cancelado e não pode prosseguir.
            </p>
          </div>
        </div>
      )}

      {avisoDeEspera && (
        <p className="flex items-center gap-1.5 text-sm text-amber-400">
          <Clock className="size-4 shrink-0" />
          {avisoDeEspera}
        </p>
      )}
    </header>
  );
}

interface OrderActionBarProps {
  orderId: string;
  orderStatus: OrderStatus;
  nextStatus: OrderStatus | null;
  isOffline: boolean;
  isUpdatingStatus: boolean;
  // Dois callbacks, não um: "Avançar" e "Cancelar pedido" são ações
  // distintas por natureza (uma confirma pagamento pendente, a outra
  // confirma o CANCELAMENTO — laudo #2, L-1: cancelar parou de ser um
  // clique sem guarda) — a distinção continua estrutural, cada botão chama
  // o seu; quem pergunta é o handler de cada um.
  onAdvance: (id: string, nextStatus: OrderStatus) => void;
  onCancel: (id: string) => void;
}

// Pedido do dono (20/09/2026, com captura): a ação do momento volta para o
// TOPO, PRESA logo abaixo da barra "ADMIN" do painel — onde o olho já está.
// É sticky (não fixed): gruda no topo do painel de rolagem, que fica
// exatamente sob a barra ADMIN (h-11, lg:hidden), e não depende de
// containing block — a mesma lição do bug da barra que rolava junto. No
// desktop a barra ADMIN não existe e ela gruda no topo do painel. São os
// MESMOS botões e guardas de sempre: 🖨 imprime · ✕ Cancelar pedido
// (texto vermelho suave, sem preenchimento) · Avançar → próxima etapa
// (dourado, primária, ocupa o resto). Redesenho de 08/10: menos brilho e
// sombra, letra de 14px em vez de 10–11px em caixa alta, alvo de toque de 44px.
function OrderActionBar({
  orderId,
  orderStatus,
  nextStatus,
  isOffline,
  isUpdatingStatus,
  onAdvance,
  onCancel,
}: Readonly<OrderActionBarProps>) {
  const podeCancelar =
    orderStatus !== "cancelled" && orderStatus !== "delivered";
  const podeAvancar = nextStatus !== null && orderStatus !== "cancelled";

  // z-40 basta: dentro do painel é o elemento mais alto ao rolar; a barra
  // ADMIN (z-50) e o menu inferior (z-[60]) vivem FORA do painel e não
  // competem. Linha separadora embaixo (border-b): ela é o teto da ficha.
  // Fundo OPACO: o conteúdo rola por baixo e não pode aparecer através.
  return (
    <div className="sticky top-0 z-40 border-b border-white/5 bg-admin-bg">
      <div className="mx-auto flex w-full max-w-[600px] items-center gap-2 px-4 py-3">
        <Button
          variant="ghost"
          onClick={() => globalThis.print()}
          className="size-11 shrink-0 rounded-xl border border-white/5 bg-white/5 p-0 text-zinc-200 transition-colors hover:bg-white/10 active:scale-95"
          title="Imprimir Pedido"
        >
          <Printer className="size-5" />
        </Button>

        {podeCancelar && (
          <Button
            onClick={() => onCancel(orderId)}
            disabled={isOffline || isUpdatingStatus}
            variant="ghost"
            className="flex h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-300 active:scale-95 disabled:pointer-events-none disabled:opacity-40 min-[420px]:gap-1.5 min-[420px]:px-3"
            title="Cancelar pedido"
            aria-label="Cancelar pedido"
          >
            <XCircle className="size-4" />
            {/* Em tela estreita o botão principal precisa do espaço para o
                texto COMPLETO ("Avançar → Em Separação"): o Cancelar encolhe
                para "Cancelar" e o " pedido" volta a partir de 420px. O nome
                acessível continua "Cancelar pedido" (title e aria-label). */}
            <span>
              Cancelar<span className="hidden min-[420px]:inline"> pedido</span>
            </span>
          </Button>
        )}

        {podeAvancar && nextStatus && (
          <Button
            onClick={() => onAdvance(orderId, nextStatus)}
            disabled={isOffline || isUpdatingStatus}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-normal rounded-xl bg-admin-gold px-2.5 text-sm font-semibold leading-tight text-black transition-colors hover:bg-admin-gold/90 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
          >
            {isUpdatingStatus ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Processando</span>
              </>
            ) : (
              <span className="text-center">{`Avançar → ${statusConfigByKey.get(nextStatus)?.label ?? nextStatus}`}</span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

interface OrderStepperPipelineProps {
  orderStatus: OrderStatus;
}

const statusesStepper: { key: OrderStatus; label: string }[] = [
  { key: "pending", label: "Novo" },
  { key: "processing", label: "Separação" },
  { key: "shipping", label: "Trânsito" },
  { key: "delivered", label: "Finalizado" },
];

// Trilha fina: bolinhas pequenas ligadas por uma linha. Cada etapa desenha o
// trecho de linha que chega nela (da etapa anterior até aqui): dourado quando
// o pedido já chegou nesta etapa, apagado quando ainda não.
function OrderStepperPipeline({
  orderStatus,
}: Readonly<OrderStepperPipelineProps>) {
  if (orderStatus === "cancelled") return null;

  const currentStepperIndex = statusFlow.indexOf(orderStatus);

  return (
    <ol aria-label="Etapas do pedido" className="flex w-full items-start px-1">
      {statusesStepper.map((step, idx) => {
        const isCompleted = idx < currentStepperIndex;
        const isActive = idx === currentStepperIndex;

        return (
          <li
            key={step.key}
            aria-current={isActive ? "step" : undefined}
            className="relative flex flex-1 flex-col items-center gap-1.5"
          >
            {idx > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-1/2 top-[5px] h-px w-full",
                  idx <= currentStepperIndex ? "bg-admin-gold" : "bg-white/10",
                )}
              />
            )}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 size-[11px] rounded-full border",
                isActive &&
                  "border-admin-gold bg-admin-gold ring-4 ring-admin-gold/20",
                isCompleted && "border-admin-gold bg-admin-gold",
                !isActive && !isCompleted && "border-white/20 bg-admin-bg",
              )}
            />
            <span
              className={cn(
                "text-center text-xs",
                isActive && "font-medium text-admin-gold",
                isCompleted && "text-zinc-300",
                !isActive && !isCompleted && "text-zinc-400",
              )}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface OrderDeliveryCardProps {
  order: Order;
  isOffline: boolean;
  copiedAddress: boolean;
  mapsUrlQuery: string;
  /** Estado LOCAL das anotações (`localNotes` de OrderDetail): a linha "Como
   * vai" lê daqui, não de `order.notes`, para não ficar velha depois que a
   * lojista salva uma anotação. */
  notes: string;
  onCopyAddress: () => void;
  onWhatsAppDirect: () => void;
  // Laudo 0109 (A-7): null = número não abre conversa — sem botão.
  whatsappUrl: string | null;
}

// Bloco "Entrega": junta quem recebe (nome + WhatsApp), onde (endereço, ou
// o painel de retirada na loja) e como vai (forma de entrega da nota do
// checkout). Antes eram o card "Cliente" e, soltas na etiqueta, as dicas de
// frete.
function OrderDeliveryCard({
  order,
  isOffline,
  copiedAddress,
  mapsUrlQuery,
  notes,
  onCopyAddress,
  onWhatsAppDirect,
  whatsappUrl,
}: Readonly<OrderDeliveryCardProps>) {
  // Retirada na loja: a cliente BUSCA — a linha diz isso em vez de ler a nota
  // de frete. Entrega comum: nome e prazo da nota do checkout (se a lojista
  // apagar a frase ao editar a anotação, a linha some — aceito); sem nota
  // (pedido antigo, venda de balcão), a linha simplesmente não aparece.
  const formaDeEntrega = order.retiradaNaLoja
    ? "Retirada na loja"
    : (() => {
        const forma = formaDeEntregaDaNota(notes);
        return forma ? `${forma.nome} · ${forma.prazo}` : null;
      })();

  return (
    <section
      data-testid="bloco-entrega"
      className={cn(blocoDaFicha, "space-y-4 p-5")}
    >
      <h3 className={tituloDoBloco}>Entrega</h3>

      {/* T3 (lote B, 12/09): a comanda é de coluna única — nome e WhatsApp
          empilhados, e o botão verde do WhatsApp à direita. */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-medium leading-tight text-white">
            {order.customer.name}
          </p>
          <p className="mt-0.5 text-sm tabular-nums text-zinc-400">
            {order.customer.whatsapp}
          </p>
        </div>
        {whatsappUrl && (
          <button
            onClick={onWhatsAppDirect}
            disabled={isOffline}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:pointer-events-none disabled:opacity-40"
            title="Conversar no WhatsApp"
            aria-label="Conversar no WhatsApp"
          >
            <MessageCircle className="size-5 fill-current" />
          </button>
        )}
      </div>

      {order.retiradaNaLoja && (
        // Retirada na loja: a cliente BUSCA — nada a enviar nem etiqueta a
        // gerar. O endereço é o retrato da compra (customer_data).
        <div
          className="space-y-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3"
          aria-label="Retirada na loja"
        >
          <p className="text-sm font-medium text-emerald-300">
            Retirada na loja
          </p>
          <p className="text-sm leading-relaxed text-zinc-200">
            A cliente busca o pedido em: {order.enderecoDeRetirada}
          </p>
        </div>
      )}

      <div className="space-y-2 border-t border-white/5 pt-4">
        <p className="text-xs text-zinc-400">
          {order.retiradaNaLoja ? "Endereço do cliente" : "Endereço de entrega"}
        </p>
        <p className="text-sm leading-relaxed text-zinc-200">
          {order.customer.address}
          {order.customer.number ? `, ${order.customer.number}` : ""}
          {order.customer.complement ? ` - ${order.customer.complement}` : ""}
          <br />
          <span className="text-zinc-400">
            {order.customer.neighborhood}
            {order.customer.city
              ? ` • ${order.customer.city}${order.customer.state ? `/${order.customer.state}` : ""}`
              : ""}
            {order.customer.cep ? ` • CEP: ${order.customer.cep}` : ""}
            {order.customer.reference
              ? ` • Ref: ${order.customer.reference}`
              : ""}
          </span>
        </p>
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={onCopyAddress}
            className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/5 bg-white/5 px-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10 active:scale-95"
            title="Copiar Endereço"
          >
            {copiedAddress ? (
              <>
                <Check className="size-[15px] text-emerald-400" />
                Copiado
              </>
            ) : (
              <>
                <Copy className="size-[15px] text-zinc-400" />
                Copiar endereço
              </>
            )}
          </button>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsUrlQuery)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-white/5 bg-white/5 px-2 text-[13px] font-medium text-white transition-colors hover:bg-white/10 active:scale-95"
            title="Ver no Google Maps"
          >
            <MapPin className="size-[15px] text-zinc-400" />
            Ver no Maps
          </a>
        </div>
      </div>

      {formaDeEntrega && (
        <p
          data-testid="forma-de-entrega"
          className="flex items-center gap-2 border-t border-white/5 pt-4 text-sm text-zinc-300"
        >
          <Truck className="size-4 shrink-0 text-zinc-400" />
          <span>Como vai: {formaDeEntrega}</span>
        </p>
      )}
    </section>
  );
}

interface OrderItemsCardProps {
  order: Order;
  skus: Record<string, string>;
  loadingSkus: boolean;
}

// Bloco "Itens": linhas compactas e, logo abaixo, a conta do pedido
// (subtotal, desconto, frete, total) — que antes morava no bloco de
// pagamento. Os números e as fórmulas são os mesmos de sempre, só mudaram
// de lugar.
function OrderItemsCard({
  order,
  skus,
  loadingSkus,
}: Readonly<OrderItemsCardProps>) {
  const { items } = order;
  const totalUnits = items.reduce((acc, item) => acc + item.quantity, 0);

  return (
    <section data-testid="bloco-itens" className={cn(blocoDaFicha, "p-5")}>
      <div className="flex items-center justify-between gap-3">
        <h3 className={tituloDoBloco}>Itens do pedido</h3>
        <span className="text-xs text-zinc-400">
          {totalUnits} {totalUnits === 1 ? "unidade" : "unidades"}
        </span>
      </div>
      <div className="mt-3 divide-y divide-white/5">
        {items.map((item) => {
          const itemSku = item.variantId
            ? skus[`var-${item.variantId}`] || skus[`prod-${item.productId}`]
            : skus[`prod-${item.productId}`];

          return (
            <div
              key={`${item.productId}-${item.variantId || "default"}`}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="size-12 shrink-0 overflow-hidden rounded-xl border border-white/10">
                <LazyImage
                  src={item.image}
                  alt={item.name}
                  className="size-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {item.name}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs tabular-nums text-zinc-400">
                    {item.quantity} × R$ {formatarValor(item.price)}
                  </span>
                  <ItemSkuBadge
                    loading={loadingSkus}
                    itemSku={itemSku}
                    productId={item.productId}
                  />
                </div>
              </div>
              <p className="shrink-0 text-sm font-medium tabular-nums text-white">
                R$ {formatarValor((item.price || 0) * (item.quantity || 0))}
              </p>
            </div>
          );
        })}
      </div>

      <div
        className={cn(
          "space-y-1.5 text-sm tabular-nums",
          items.length > 0 && "mt-4 border-t border-white/5 pt-4",
        )}
      >
        <div className="flex justify-between text-zinc-300">
          <span>Subtotal</span>
          <span>R$ {formatarValor(order?.subtotal || 0)}</span>
        </div>

        {(order?.discount > 0 || order?.couponCode) && (
          <div className="flex justify-between text-amber-400">
            <span className="flex items-center gap-1.5">
              Desconto
              {order.couponCode && (
                <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium">
                  {order.couponCode}
                </span>
              )}
            </span>
            <span>- R$ {formatarValor(order?.discount || 0)}</span>
          </div>
        )}

        <div className="flex justify-between text-zinc-300">
          <span>Frete</span>
          <span
            className={(order?.shipping || 0) === 0 ? "text-emerald-400" : ""}
          >
            {(order?.shipping || 0) === 0
              ? "Grátis"
              : `R$ ${formatarValor(order?.shipping || 0)}`}
          </span>
        </div>

        <div className="flex justify-between border-t border-white/5 pt-2 text-base font-semibold text-white">
          <span>Total</span>
          <span>R$ {formatarValor(order?.total || 0)}</span>
        </div>
      </div>
    </section>
  );
}

interface OrderFinanceCardProps {
  order: Order;
  /** Task 4b — `undefined` só nos testes que montam `<OrderDetail>` direto
   * sem a prop (ver `OrderDetailProps.onRegistrarPagamento`); nesse caso o
   * bloco de recebimento não renderiza (ver guarda no JSX abaixo). */
  onRegistrarPagamento?: (orderId: string, recebido: boolean) => void;
  registrandoPagamento?: boolean;
}

// Bloco do dinheiro ("Pagamento"), logo depois da trilha: a forma de pagamento
// ao lado do título, o total grande, UMA frase com a situação (e o selo, uma
// vez só) e, por último, o botão de recebimento. A conta (subtotal, desconto, frete) foi
// para o bloco "Itens".
function OrderFinanceCard({
  order,
  onRegistrarPagamento,
  registrandoPagamento,
}: Readonly<OrderFinanceCardProps>) {
  // T3 (lote B, 12/09) — a frase-situação do dinheiro responde "esse pedido
  // está pago?" antes de qualquer outra coisa. Verde quando o dinheiro entrou
  // SEM pendência; âmbar para tudo o mais — inclusive os "precisa de
  // atenção", que não podem pintar de verde só porque a frase começa com
  // "Pago" (pago e cancelado é dinheiro PRESO, não resolvido).
  const situacao = fraseSituacaoDoPagamento(order);
  // "Recebido no balcão" (D1, lote C4) é o MESMO fato que "Recebido na
  // entrega" num canal diferente — dinheiro entrou, sem pendência. Sem esta
  // linha, a venda de balcão paga ficava âmbar (cor de pendência), o
  // oposto da verdade.
  const situacaoPositiva =
    !situacao.includes("precisa de atenção") &&
    (situacao.startsWith("Pago no site") ||
      situacao.startsWith("Recebido na entrega") ||
      situacao.startsWith("Recebido no balcão"));

  return (
    <section
      data-testid="bloco-dinheiro"
      className={cn(blocoDaFicha, "space-y-4 p-5")}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className={tituloDoBloco}>Pagamento</h3>
        <p className="text-sm font-medium text-zinc-300">
          {getPaymentMethodLabel(order.paymentMethod)}
        </p>
      </div>

      <div>
        <p className="text-xs text-zinc-400">Total do pedido</p>
        <p className="mt-0.5 text-3xl font-semibold tabular-nums leading-none text-white">
          <span className="mr-1 text-lg font-medium text-zinc-400">R$</span>
          {formatarValor(order?.total || 0)}
        </p>
      </div>

      {/* A frase e o selo vão em LINHAS PRÓPRIAS, largura cheia: o selo tem
          `truncate` e, dividindo linha com outra coisa, voltava a virar
          "PAGO E CANCELADO — PRECIS…". */}
      <div className="space-y-2">
        <p
          className={cn(
            "text-sm font-medium",
            situacaoPositiva ? "text-emerald-400" : "text-amber-400",
          )}
        >
          {situacao}
        </p>
        <PaymentStatusBadge
          paymentStatus={order.paymentStatus}
          orderStatus={order.status}
          canal={order.canal}
          className={seloDaFicha}
        />
      </div>

      {/* Task 4b do plano recebimento-na-entrega — o botão de pagamento
          recebido na mão fica disponível na FICHA o tempo todo, mesma
          condição (`podeRegistrarPagamento`) e mesmo comportamento do
          cartão da lista (Task 4). `onRegistrarPagamento` falta só nos
          testes que montam `<OrderDetail>` direto sem a prop. */}
      {onRegistrarPagamento && podeRegistrarPagamento(order) && (
        <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-4">
          {order.pagamentoRecebidoEm ? (
            <>
              <span className="text-sm font-medium text-emerald-400">
                Recebido em{" "}
                {new Date(order.pagamentoRecebidoEm).toLocaleDateString(
                  "pt-BR",
                  { day: "2-digit", month: "short" },
                )}
              </span>
              <button
                type="button"
                onClick={() => onRegistrarPagamento(order.id, false)}
                disabled={registrandoPagamento}
                className="h-10 shrink-0 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                Desfazer
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onRegistrarPagamento(order.id, true)}
              disabled={registrandoPagamento}
              className="h-11 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-400 transition-colors hover:bg-emerald-500 hover:text-black disabled:opacity-50"
            >
              {registrandoPagamento ? "Registrando..." : "Marcar como recebido"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

interface OrderLogisticsCardProps {
  localTrackingCode: string;
  isEditingTracking: boolean;
  trackingValue: string;
  isSavingTracking: boolean;
  copiedTracking: boolean;
  isOffline: boolean;
  setTrackingValue: (val: string) => void;
  setIsEditingTracking: (val: boolean) => void;
  onSaveTracking: () => void;
  onCopyTracking: () => void;
}

// Linha "Código de rastreio" da lista de envio: vazia convida com "Adicionar"
// (dourado); preenchida mostra o código em fonte mono com copiar / rastrear /
// editar; editar abre o campo ali mesmo. O "rastreio" fica só para leitor de
// tela (`sr-only`): na lista há dois "Adicionar" e o botão precisa dizer qual.
function OrderLogisticsCard({
  localTrackingCode,
  isEditingTracking,
  trackingValue,
  isSavingTracking,
  copiedTracking,
  isOffline,
  setTrackingValue,
  setIsEditingTracking,
  onSaveTracking,
  onCopyTracking,
}: Readonly<OrderLogisticsCardProps>) {
  if (isEditingTracking) {
    return (
      <div className="space-y-3 px-4 py-3.5 duration-300 animate-in fade-in">
        <label
          htmlFor="tracking-input"
          className="block text-sm font-medium text-zinc-200"
        >
          Código de rastreio
        </label>
        <Input
          id="tracking-input"
          name="trackingCode"
          autoComplete="off"
          value={trackingValue}
          onChange={(e) => setTrackingValue(e.target.value.toUpperCase())}
          placeholder="EX: BR123456789BR"
          className="h-11 rounded-xl border-white/10 bg-zinc-950 font-mono text-sm text-white focus:border-admin-gold/30"
          disabled={isSavingTracking}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setTrackingValue(localTrackingCode);
              setIsEditingTracking(false);
            }}
            className="h-10 rounded-xl px-3 text-zinc-300 hover:text-white"
            disabled={isSavingTracking}
            aria-label="Cancelar edição do código"
          >
            <X className="size-4" />
          </Button>
          <Button
            size="sm"
            onClick={onSaveTracking}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-admin-gold px-4 text-sm font-semibold text-black hover:bg-admin-gold/90"
            disabled={isSavingTracking}
          >
            {isSavingTracking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    );
  }

  if (!localTrackingCode) {
    // T3 (lote B, 12/09) — estado vazio como CONVITE, agora em linha (era uma
    // caixa tracejada grande).
    return (
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-200">
            Código de rastreio
          </h3>
          <p className="text-xs text-zinc-400">
            Quando despachar, cole o código dos Correios.
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setIsEditingTracking(true)}
          disabled={isOffline}
          className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-medium text-admin-gold hover:bg-admin-gold/10 hover:text-admin-gold active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="size-4" />
          <span>
            Adicionar<span className="sr-only"> rastreio</span>
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-zinc-200">
          Código de rastreio
        </h3>
        <span className="block select-all break-all font-mono text-sm font-medium tracking-wider text-white">
          {localTrackingCode}
        </span>
      </div>
      <div className="flex shrink-0 items-center">
        <button
          onClick={onCopyTracking}
          className="flex size-10 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          title="Copiar Código"
        >
          {copiedTracking ? (
            <Check className="size-4 text-emerald-400" />
          ) : (
            <Copy className="size-4" />
          )}
        </button>
        <a
          href={`https://linkrastreio.com/?codigo=${localTrackingCode}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex size-10 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
          title="Rastrear nos Correios"
        >
          <ExternalLink className="size-4" />
        </a>
        <button
          onClick={() => setIsEditingTracking(true)}
          disabled={isOffline}
          className="flex size-10 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          title="Editar Código"
        >
          <Edit3 className="size-4" />
        </button>
      </div>
    </div>
  );
}

interface OrderNotesCardProps {
  localNotes: string;
  isEditingNotes: boolean;
  notesValue: string;
  isSavingNotes: boolean;
  isOffline: boolean;
  setNotesValue: (val: string) => void;
  setIsEditingNotes: (val: boolean) => void;
  onSaveNotes: () => void;
}

// Linha "Anotações internas" da lista de envio — mesma ideia do rastreio:
// vazia convida com "Adicionar", preenchida mostra o texto INTEIRO (sem
// aspas nem itálico, com as quebras de linha) com "Editar", e editar abre o
// campo ali mesmo. O texto inteiro importa: `notes` traz a observação da
// cliente, a variante escolhida ("Produto: Tamanho G") e a frase do frete, e
// a ficha não tem a variante em outro lugar. As palavras
// "anotação"/"notas" ficam só para leitor de tela (`sr-only`), como no
// rastreio.
function OrderNotesCard({
  localNotes,
  isEditingNotes,
  notesValue,
  isSavingNotes,
  isOffline,
  setNotesValue,
  setIsEditingNotes,
  onSaveNotes,
}: Readonly<OrderNotesCardProps>) {
  if (isEditingNotes) {
    return (
      <div className="space-y-3 px-4 py-3.5 duration-300 animate-in fade-in">
        <label
          htmlFor="notes-textarea"
          className="block text-sm font-medium text-zinc-200"
        >
          Anotações internas
        </label>
        <textarea
          id="notes-textarea"
          name="notes"
          autoComplete="off"
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          placeholder="Ex: Cliente solicitou entrega após as 18h..."
          className="h-24 w-full resize-none rounded-xl border border-white/10 bg-zinc-950 p-3 text-sm text-white focus:border-admin-gold/30 focus:outline-none"
          disabled={isSavingNotes}
        />
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setNotesValue(localNotes);
              setIsEditingNotes(false);
            }}
            className="h-10 rounded-xl px-3 text-zinc-300 hover:text-white"
            disabled={isSavingNotes}
            aria-label="Cancelar edição das anotações"
          >
            <X className="size-4" />
          </Button>
          <Button
            size="sm"
            onClick={onSaveNotes}
            className="flex h-10 items-center gap-1.5 rounded-xl bg-admin-gold px-4 text-sm font-semibold text-black hover:bg-admin-gold/90"
            disabled={isSavingNotes}
          >
            {isSavingNotes ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    );
  }

  if (!localNotes) {
    // T3 (lote B, 12/09) — estado vazio como CONVITE, agora em linha.
    return (
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-200">
            Anotações internas
          </h3>
          <p className="text-xs text-zinc-400">
            Combinados com o cliente: horário, presente, troca…
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setIsEditingNotes(true)}
          disabled={isOffline}
          className="flex h-10 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-medium text-admin-gold hover:bg-admin-gold/10 hover:text-admin-gold active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="size-4" />
          <span>
            Adicionar<span className="sr-only"> anotação</span>
          </span>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-zinc-200">
          Anotações internas
        </h3>
        <Button
          variant="ghost"
          onClick={() => setIsEditingNotes(true)}
          disabled={isOffline}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-zinc-300 hover:bg-white/5 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
        >
          <Edit3 className="size-4 text-zinc-400" />
          <span>
            Editar<span className="sr-only"> notas</span>
          </span>
        </Button>
      </div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-zinc-200">
        {localNotes}
      </p>
    </div>
  );
}

export const OrderDetail = memo(function OrderDetail({
  order,
  onStatusChange,
  isOffline = false,
  onRegistrarPagamento,
  storeName,
  onAbrirDevolucoes,
}: Readonly<OrderDetailProps>) {
  const [localTrackingCode, setLocalTrackingCode] = useState(
    order.trackingCode || "",
  );
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const [trackingValue, setTrackingValue] = useState(order.trackingCode || "");
  const [isSavingTracking, setIsSavingTracking] = useState(false);

  // Espelho do pedido que ESTE componente está mostrando agora — escrita no
  // corpo do render (não em `useEffect`) porque, ao contrário do card de
  // etiqueta, `OrderDetail` é `memo`d e NÃO desmonta ao trocar de pedido: o
  // pai troca a prop `order`, este componente recebe a renderização nova, e
  // o valor fica correto a tempo de qualquer callback que chegue depois.
  // Usado para validar o `orderId` que `EtiquetaDoPedidoCard` devolve no
  // `onTrackingAtualizado` (2ª rodada da revisão Opus sobre aadbf4c): o
  // card pode estar desmontado (com `key={order.id}`) quando a resposta de
  // um pedido antigo chega, então a defesa que protege O ESTADO DESTE
  // componente tem que morar AQUI, não só dentro do card.
  const orderIdAtualRef = useRef(order.id);
  orderIdAtualRef.current = order.id;

  const [localNotes, setLocalNotes] = useState(order.notes || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(order.notes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const [skus, setSkus] = useState<Record<string, string>>({});
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  // Avanço represado enquanto espera confirmação — de "pedido não pago" (ver
  // `paymentStatusQuePedeConfirmacao` acima) OU da pergunta de recebimento
  // na entrega (Task 4b). `null` = nenhuma confirmação pendente / diálogo
  // fechado. `perguntaRecebimento` decide qual dos dois textos o mesmo
  // AlertDialog mostra — ver JSX abaixo.
  const [pendingAdvance, setPendingAdvance] = useState<{
    orderId: string;
    status: OrderStatus;
    perguntaRecebimento: boolean;
  } | null>(null);

  const handleStatusChange = async (
    orderId: string,
    nextStatus: OrderStatus,
  ) => {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      await onStatusChange(orderId, nextStatus);
    } catch {
      // parent component handles error
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Ponto de entrada exclusivo do botão "Avançar" — o botão de abortar chama
  // handleStatusChange direto com "cancelled" (ver onCancel no JSX abaixo),
  // então esta função nunca recebe "cancelled" e não precisa mais comparar
  // valor para distinguir os dois casos. Ela desvia para a confirmação só quando o
  // pedido de verdade não foi liquidado; do contrário avança igual a antes,
  // sem fricção nenhuma.
  const requestStatusChange = (orderId: string, nextStatus: OrderStatus) => {
    if (
      order.paymentStatus &&
      paymentStatusQuePedeConfirmacao.includes(order.paymentStatus)
    ) {
      setPendingAdvance({
        orderId,
        status: nextStatus,
        perguntaRecebimento: false,
      });
      return;
    }

    // Task 4b — o instante em que o dinheiro troca de mão: pedido de
    // pagamento na entrega (não "online"), ainda sem recebimento
    // registrado, avançando justo para "delivered". `podeRegistrarPagamento`
    // é a MESMA condição que decide o botão do cartão e da ficha — ver
    // `podeRegistrarPagamento.ts`. Sem `onRegistrarPagamento` (só acontece
    // nos testes que montam `<OrderDetail>` direto, ver `OrderDetailProps`)
    // não há como gravar nada, então não faz sentido abrir a pergunta.
    if (
      onRegistrarPagamento &&
      nextStatus === "delivered" &&
      !order.pagamentoRecebidoEm &&
      podeRegistrarPagamento(order)
    ) {
      setPendingAdvance({
        orderId,
        status: nextStatus,
        perguntaRecebimento: true,
      });
      return;
    }

    handleStatusChange(orderId, nextStatus);
  };

  // Usada pelo caso "pagamento não confirmado" (perguntaRecebimento: false)
  // e por "Ainda não" do caso "pergunta de recebimento" (perguntaRecebimento:
  // true) — os dois só avançam o status, sem gravar nada.
  const confirmPendingAdvance = () => {
    if (!pendingAdvance) return;
    const { orderId, status } = pendingAdvance;
    setPendingAdvance(null);
    handleStatusChange(orderId, status);
  };

  // 🔴 Task 4b — a ordem não se negocia: grava o dinheiro PRIMEIRO, avança o
  // status DEPOIS, e SÓ SE a gravação não tiver lançado. `onRegistrarPagamento`
  // já mostra o próprio toast de erro (ver `useOrders.registrarPagamentoRecebido`)
  // — o catch aqui só ABORTA, sem chamar `handleStatusChange`: o pedido
  // continua "em aberto" e o botão de registrar continua na tela, em vez de
  // ficar "entregue" e sem registro nenhum — o dano silencioso que esta
  // tarefa existe pra evitar.
  const confirmarRecebimentoEAvancar = async () => {
    if (!pendingAdvance || !onRegistrarPagamento) return;
    const { orderId, status } = pendingAdvance;
    setPendingAdvance(null);
    try {
      await onRegistrarPagamento(orderId, true);
    } catch (err) {
      console.error(
        "[OrderDetail] Erro ao registrar pagamento recebido antes de avançar:",
        err,
      );
      return;
    }
    handleStatusChange(orderId, status);
  };

  // Task 4b — botão "Marcar como recebido"/"Desfazer" DENTRO da ficha
  // (Consolidado Financeiro), independente da pergunta acima: em qualquer
  // momento, não só no instante de avançar para "delivered". Mesmo molde de
  // `AdminOrdersView.handleRegistrarPagamento` — engole o erro (o hook já
  // mostra o próprio toast) e só desabilita o botão durante a chamada.
  const [registrandoPagamento, setRegistrandoPagamento] = useState(false);
  const handleRegistrarPagamento = async (
    orderId: string,
    recebido: boolean,
  ) => {
    if (!onRegistrarPagamento) return;
    setRegistrandoPagamento(true);
    try {
      await onRegistrarPagamento(orderId, recebido);
    } catch (err) {
      console.error("[OrderDetail] Erro ao registrar pagamento recebido:", err);
    } finally {
      setRegistrandoPagamento(false);
    }
  };

  useEffect(() => {
    setLocalTrackingCode(order.trackingCode || "");
    setTrackingValue(order.trackingCode || "");
    setLocalNotes(order.notes || "");
    setNotesValue(order.notes || "");
  }, [order.trackingCode, order.notes]);

  const itemsSerialized = JSON.stringify(
    order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: item.quantity,
    })),
  );

  useEffect(() => {
    const fetchSkus = async () => {
      try {
        const itemsList = JSON.parse(itemsSerialized) as {
          productId: string;
          variantId: string | null;
        }[];
        const productIds = itemsList.map((item) => item.productId);
        const variantIds = itemsList
          .map((item) => item.variantId)
          .filter((id): id is string => !!id);

        const missingProductIds = productIds.filter(
          (id) => !globalSkuCache[`prod-${id}`],
        );
        const missingVariantIds = variantIds.filter(
          (id) => !globalSkuCache[`var-${id}`],
        );

        if (missingProductIds.length === 0 && missingVariantIds.length === 0) {
          const cachedSkus: Record<string, string> = {};
          productIds.forEach((id) => {
            cachedSkus[`prod-${id}`] = globalSkuCache[`prod-${id}`];
          });
          variantIds.forEach((id) => {
            cachedSkus[`var-${id}`] = globalSkuCache[`var-${id}`];
          });
          setSkus(cachedSkus);
          return;
        }

        setLoadingSkus(true);

        if (missingProductIds.length > 0) {
          const { data: productsData } = await supabase
            .from("vw_produtos_admin")
            .select("id, codigo")
            .in("id", missingProductIds);
          productsData?.forEach((p) => {
            if (p.codigo) globalSkuCache[`prod-${p.id}`] = p.codigo;
          });
        }

        if (missingVariantIds.length > 0) {
          const { data: variantsData } = await supabase
            .from("product_variants")
            .select("id, sku")
            .in("id", missingVariantIds);
          variantsData?.forEach((v) => {
            if (v.sku) globalSkuCache[`var-${v.id}`] = v.sku;
          });
        }

        const resultSkus: Record<string, string> = {};
        productIds.forEach((id) => {
          if (globalSkuCache[`prod-${id}`])
            resultSkus[`prod-${id}`] = globalSkuCache[`prod-${id}`];
        });
        variantIds.forEach((id) => {
          if (globalSkuCache[`var-${id}`])
            resultSkus[`var-${id}`] = globalSkuCache[`var-${id}`];
        });
        setSkus(resultSkus);
      } catch (err) {
        console.error("Error fetching SKUs:", err);
      } finally {
        setLoadingSkus(false);
      }
    };

    fetchSkus();
  }, [itemsSerialized]);

  const nextStatus = getNextStatus(order.status);

  const displayAddress = [
    order.customer.address && order.customer.number
      ? `${order.customer.address}, ${order.customer.number}`
      : order.customer.address || "",
    order.customer.complement ? `Comp: ${order.customer.complement}` : "",
    order.customer.neighborhood,
    [order.customer.city, order.customer.state].filter(Boolean).join(" - "),
    order.customer.cep ? `CEP: ${order.customer.cep}` : "",
    order.customer.reference ? `Ref: ${order.customer.reference}` : "",
  ]
    .filter(Boolean)
    .join(" - ");

  const mapsQueryParts: string[] = [];
  const streetAddr = order.customer.address || "";
  const num = order.customer.number || "";
  if (streetAddr) {
    if (num && !streetAddr.toLowerCase().includes(num.toLowerCase())) {
      mapsQueryParts.push(`${streetAddr}, ${num}`);
    } else {
      mapsQueryParts.push(streetAddr);
    }
  }
  if (order.customer.neighborhood) {
    mapsQueryParts.push(order.customer.neighborhood);
  }
  // Sem cidade, a busca no mapa não leva Monte Carmelo calada: só empurra o
  // que existe de verdade. Cidade e estado são checados em separado — pedido
  // com só um dos dois não pode perder o que tem, e o `.filter(Boolean)`
  // abaixo já cuida de não deixar "-" órfão quando falta um dos dois.
  if (order.customer.city || order.customer.state) {
    mapsQueryParts.push(
      [order.customer.city, order.customer.state].filter(Boolean).join(" - "),
    );
  }
  if (order.customer.cep) {
    mapsQueryParts.push(order.customer.cep);
  }
  const mapsUrlQuery = mapsQueryParts.join(", ");

  // Laudo 0109 (A-8): a cópia só comemora se DEU certo —
  // `copiarParaClipboard` devolve false quando a API recusa (permissão,
  // janela sem foco), e aí o aviso é de erro, não de sucesso.
  const handleCopyAddress = async () => {
    const ok = await copiarParaClipboard(displayAddress);
    if (!ok) {
      toast.error("Não foi possível copiar.");
      return;
    }
    setCopiedAddress(true);
    toast.success("Endereço copiado para a área de transferência!");
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyTracking = async () => {
    const ok = await copiarParaClipboard(localTrackingCode);
    if (!ok) {
      toast.error("Não foi possível copiar.");
      return;
    }
    setCopiedTracking(true);
    toast.success("Código de rastreamento copiado!");
    setTimeout(() => setCopiedTracking(false), 2000);
  };

  const handleSaveTracking = async () => {
    try {
      setIsSavingTracking(true);
      const { error } = await supabase
        .from("marketplace_orders")
        .update({ tracking_code: trackingValue.trim() || null })
        .eq("id", order.id);

      if (error) throw error;
      setLocalTrackingCode(trackingValue.trim());
      setIsEditingTracking(false);
      toast.success("Código de rastreamento salvo!");
    } catch (err) {
      console.error("Error saving tracking code:", err);
      toast.error("Erro ao salvar código de rastreamento.");
    } finally {
      setIsSavingTracking(false);
    }
  };

  const handleSaveNotes = async () => {
    try {
      setIsSavingNotes(true);
      const { error } = await supabase
        .from("marketplace_orders")
        .update({ notes: notesValue.trim() || null })
        .eq("id", order.id);

      if (error) throw error;
      setLocalNotes(notesValue.trim());
      setIsEditingNotes(false);
      toast.success("Notas operacionais salvas!");
    } catch (err) {
      console.error("Error saving notes:", err);
      toast.error("Erro ao salvar notas operacionais.");
    } finally {
      setIsSavingNotes(false);
    }
  };

  // Laudo 0109 (A-7): número sem DDD+numero não abre conversa válida.
  // Sem link, o toque não abre janela nenhuma — e o botão nem renderiza
  // (ver OrderCustomerCard abaixo).
  const whatsappUrl = linkWhatsappDoCliente(order.customer?.whatsapp);

  // Laudo #2 (L-1): cancelar pedido deixa de ser UM clique sem guarda — a
  // ação mais destrutiva do painel pede confirmação com texto por caso
  // (pago? em rota?), na mesma régua do cancelamento pelo cliente.
  const handleCancelarComConfirmacao = (id: string) => {
    const texto = textoCancelamentoDoPainel({
      status: order.status,
      payment_status: order.paymentStatus,
      // L3e: pedido enviado e reativado não gera a devolução automática —
      // sem este campo o confirm prometeria um estorno que não vai existir.
      cancelledAfterShipping: order.cancelledAfterShipping,
      // G4: devolução parcial já concluída também impede a linha nova.
      valorEstornado: order.valorEstornado,
    });
    if (!globalThis.confirm(texto)) return;
    void handleStatusChange(id, "cancelled");
  };

  // Laudo #2 (L-8): pedido pendente não expira nunca (decisão deliberada —
  // venda fechada por fora) — o que faltava era o SINAL de idade. Sem ele, o
  // fantasma afunda na lista e prende o estoque sobre a memória do lojista.
  const avisoDeEspera = fraseDeEsperaDoPedido(
    idadeDoPedidoPendente(order.createdAt, order.status),
  );

  const handleWhatsAppDirect = () => {
    if (!whatsappUrl) return;
    const message = `Olá ${order.customer?.name || "Cliente"}! Entramos em contato sobre o seu pedido #${numeroDoPedido(order.id)}.`;
    globalThis.open(
      `${whatsappUrl}?text=${encodeURIComponent(message)}`,
      "_blank",
    );
  };

  // pb-[calc(7rem+safe-area)]: com a ação no topo (sticky, pedido do dono
  // 20/09/2026), no celular o pé da folha cobre SÓ o menu inferior flutuante
  // (~68px + margens + safe-area do iPhone com notch) — o 11rem antigo
  // compensava a barra que morava no pé (achado 1 da revisão do PR 549) e
  // virou espaço morto. lg:pb-28 é o respiro final padrão do painel (a
  // mesma régua do dashboard).
  return (
    <div className="min-h-screen bg-admin-bg pb-[calc(7rem+var(--safe-area-bottom-fixed,env(safe-area-inset-bottom,0px)))] duration-500 animate-in fade-in lg:pb-28">
      {/* Pedido do dono (20/09/2026): a barra de ação nasce aqui, no topo da
          ficha, e gruda sob a barra "ADMIN" ao rolar (sticky). O pb da folha
          agora cobre só o menu inferior flutuante — a ação não mora mais no
          pé. */}
      <OrderActionBar
        orderId={order.id}
        orderStatus={order.status}
        nextStatus={nextStatus}
        isOffline={isOffline}
        isUpdatingStatus={isUpdatingStatus}
        onAdvance={requestStatusChange}
        onCancel={handleCancelarComConfirmacao}
      />
      {/* Redesenho de 08/10/2026 — coluna ÚNICA (~600px centrados), na ordem
          em que o lojista LÊ a ficha: ação (fixa no topo desde 20/09) →
          cabeçalho → trilha → dinheiro (+ devolução do produto e do
          dinheiro, coladas nele) → entrega → itens (com a conta) → envio
          (etiqueta, rastreio e anotações em linhas). O grid de 2 colunas saiu. */}
      <div className="mx-auto w-full max-w-[600px] space-y-4 px-4 pt-5 md:px-6 md:pt-6">
        <OrderHeader order={order} avisoDeEspera={avisoDeEspera} />

        <OrderStepperPipeline orderStatus={order.status} />

        <OrderFinanceCard
          order={order}
          onRegistrarPagamento={
            onRegistrarPagamento ? handleRegistrarPagamento : undefined
          }
          registrandoPagamento={registrandoPagamento}
        />
        {/* Devolução de PRODUTO (plano 2026-09-26, seção "Devoluções"):
            só existe para pedido entregue — e mora logo antes da devolução
            de DINHEIRO, que é outra coisa (estorno do pedido). */}
        {order.status === "delivered" && (
          <DevolucaoDoPedidoAdminCard
            key={order.id}
            orderId={order.id}
            onAbrirDevolucoes={onAbrirDevolucoes}
          />
        )}
        {/* T6 do plano de estorno pelo app (08/09/2026): só cobrança
            pelo site passa pelo Mercado Pago — dinheiro/cartão na
            entrega não tem estorno pelo app, e a tela nem oferece. Na
            comanda, a devolução mora logo abaixo da seção Pagamento, que
            é de quem ela trata. */}
        {order.paymentMethod === "online" &&
          (order.paymentStatus === "pago" ||
            order.paymentStatus === "pago_apos_expirar" ||
            order.paymentStatus === "estornado") && (
            <EstornoCard order={order} />
          )}

        <OrderDeliveryCard
          order={order}
          isOffline={isOffline}
          copiedAddress={copiedAddress}
          mapsUrlQuery={mapsUrlQuery}
          notes={localNotes}
          onCopyAddress={handleCopyAddress}
          onWhatsAppDirect={handleWhatsAppDirect}
          whatsappUrl={whatsappUrl}
        />
        <OrderItemsCard order={order} skus={skus} loadingSkus={loadingSkus} />

        {/* Envio em linhas simples, separadas por divisores: uma linha por
            assunto, e tocar abre/edita ali mesmo. */}
        <section
          data-testid="envio-lista"
          aria-label="Envio e anotações"
          className={cn(blocoDaFicha, "divide-y divide-white/5")}
        >
          {/* Emissão da etiqueta de envio dentro da ficha do pedido — migrou de
              Admin > Frete (busca/seleção global) para o pedido já aberto.
              Venda de balcão (`canal === "presencial"`) não tem envio: a
              cliente leva o produto na hora, não existe etiqueta para gerar. */}
          {order.canal !== "presencial" && (
            <EtiquetaDoPedidoCard
              // `key={order.id}` aqui NÃO é o que impede o vazamento entre
              // pedidos — 2ª rodada da revisão Opus sobre aadbf4c corrigiu um
              // comentário anterior que dizia o contrário. O que protege é a
              // dupla checagem por `orderId` (dentro do card, via
              // `useEffect`+cleanup; e aqui embaixo, no `onTrackingAtualizado`)
              // — essa dupla checagem funciona COM ou SEM o `key`. Mantemos o
              // `key` só pelo ganho de UX: ele força o card a desmontar e
              // remontar ao trocar de pedido, então a troca já entra direto no
              // skeleton de "carregando" em vez de mostrar por um instante os
              // dados do pedido anterior antes do `useEffect` interno do card
              // zerar o estado.
              key={order.id}
              orderId={order.id}
              isOffline={isOffline}
              onTrackingAtualizado={(orderIdDaResposta, codigo) => {
                // A resposta pode ser de um pedido que este componente não
                // mostra mais (card desmontado com a resposta ainda em voo, ou
                // clique antigo cuja resposta chegou depois da troca) —
                // ignora sem tocar no estado local se não bater com o pedido
                // ATUAL. Independe de o card ainda existir na árvore.
                if (orderIdDaResposta !== orderIdAtualRef.current) return;
                setLocalTrackingCode(codigo);
                setTrackingValue(codigo);
              }}
            />
          )}
          <OrderLogisticsCard
            localTrackingCode={localTrackingCode}
            isEditingTracking={isEditingTracking}
            trackingValue={trackingValue}
            isSavingTracking={isSavingTracking}
            copiedTracking={copiedTracking}
            isOffline={isOffline}
            setTrackingValue={setTrackingValue}
            setIsEditingTracking={setIsEditingTracking}
            onSaveTracking={handleSaveTracking}
            onCopyTracking={handleCopyTracking}
          />
          <OrderNotesCard
            localNotes={localNotes}
            isEditingNotes={isEditingNotes}
            notesValue={notesValue}
            isSavingNotes={isSavingNotes}
            isOffline={isOffline}
            setNotesValue={setNotesValue}
            setIsEditingNotes={setIsEditingNotes}
            onSaveNotes={handleSaveNotes}
          />
        </section>
      </div>

      <OrderReceipt order={order} storeName={storeName} />

      <AlertDialog
        open={pendingAdvance !== null}
        onOpenChange={(open) => !open && setPendingAdvance(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          {pendingAdvance?.perguntaRecebimento ? (
            <>
              {/* Task 4b — pedido de pagamento na entrega, avançando para
                  "delivered": o instante em que o dinheiro troca de mão.
                  "Recebi" grava o pagamento e SÓ DEPOIS avança (ver
                  `confirmarRecebimentoEAvancar`); "Ainda não" só avança. */}
              <AlertDialogHeader>
                <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
                  Recebeu os R${" "}
                  {(order.total || 0).toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  deste pedido?
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-zinc-400">
                  Pedido de pagamento na entrega. Se você já recebeu o dinheiro
                  na mão, confirme abaixo — o registro fica salvo no pedido.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4 gap-2">
                <AlertDialogAction
                  onClick={confirmPendingAdvance}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  Ainda não
                </AlertDialogAction>
                <AlertDialogAction
                  onClick={confirmarRecebimentoEAvancar}
                  className="rounded-xl border-0 bg-emerald-500 px-4 py-2 text-xs font-bold text-black hover:bg-emerald-500/90"
                >
                  Recebi
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
                  Este pedido não está com o pagamento confirmado
                </AlertDialogTitle>
                <AlertDialogDescription className="text-xs text-zinc-400">
                  O dinheiro deste pedido não entrou. Se você avançar, a
                  mercadoria caminha para sair mesmo assim — e, depois de
                  finalizado, não dá mais para cancelar e devolver ao estoque.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-4 gap-2">
                <AlertDialogCancel className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
                  Cancelar
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmPendingAdvance}
                  className="rounded-xl border-0 bg-admin-gold px-4 py-2 text-xs font-bold text-black hover:bg-admin-gold/90"
                >
                  Avançar mesmo assim
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

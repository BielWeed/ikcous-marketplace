import {
  type CategoriaErroPagamento,
  PagamentoOnline,
} from "@/components/checkout/PagamentoOnline";
import { Button } from "@/components/ui/button";
import { AddressForm } from "@/components/ui/custom/AddressForm";
import { AddressList } from "@/components/ui/custom/AddressList";
import { CouponInput } from "@/components/ui/custom/CouponInput";
import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { formatarCep, useBuscaCep } from "@/hooks/useBuscaCep";
import { useCart } from "@/hooks/useCart";
import { useCoupons } from "@/hooks/useCoupons";
import { useDeferredRender } from "@/hooks/useDeferredRender";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useOrders } from "@/hooks/useOrders";
import { PAGAMENTO_ONLINE_LIGADO } from "@/lib/flags";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Address, CartItem, Customer, PaymentMethod, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { zodResolver } from "@hookform/resolvers/zod";
import confetti from "canvas-confetti";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  Check,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  MapPin,
  Phone,
  Plus,
  Smartphone,
  Sparkles,
  Tag,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import * as z from "zod";

// Intervalo da verificação periódica da tela do PIX (ver o useEffect de
// polling, no corpo do componente) — extraído para constante porque o teto
// de segurança abaixo é derivado DELE (contagem de ticks, não de relógio).
const INTERVALO_VERIFICACAO_PAGAMENTO_MS = 10_000;

// Teto de segurança da verificação periódica da tela do PIX. NÃO é o
// critério normal de parada — esse é o `payment_status` terminal do pedido
// (ver `verificarPagamento`, no useEffect). Isto é só para não consultar
// para sempre um pedido que ninguém vai pagar depois que a reserva expira.
//
// De onde vem o número: a varredura do prazo roda a cada 5 minutos
// (`supabase/migrations/20260807000001_agenda_expiracao.sql:12`,
// `*/5 * * * *`) e o webhook do Mercado Pago levou ~90s no incidente real
// de 16/08/2026 que motivou a correção original (CHECKOUT-090) — 60 min de
// vida (a partir de quando esta tela monta, perto de quando expires_at é
// carimbado) dão folga generosa sobre esse pior caso medido. NÃO reduza
// este número sem entender por que ele existe.
//
// Por que é CONTAGEM DE TICKS, e não relógio (2ª correção, achado
// BLOQUEANTE da revisão de 16/08/2026 — a MESMA classe de defeito
// reaparecendo por outra porta): a 1ª correção trocou "prazo vencido"
// (`expires_at <= Date.now()`) por "estado terminal", mas manteve um teto
// de segurança que comparava `Date.now()` do NAVEGADOR do cliente com
// `expires_at`, um instante gravado pelo SERVIDOR. Num aparelho com o
// relógio adiantado em δ, a parada acontece em `expires_at + 30min − δ` —
// com δ maior que ~28 min (nada incomum: fuso mal configurado, relógio de
// hardware sem NTP), o polling morre ANTES do webhook conseguir gravar, e o
// cliente que pagou fica preso na tela do QR. Contar TICKS do próprio
// `setInterval` mede o mesmo relógio nas DUAS pontas — não há nada do
// servidor para comparar, então não há divergência de relógio para
// explorar. `expires_at` continua sendo lido na consulta (é o único caminho
// até `pago_apos_expirar`), só deixou de decidir quando parar.
const TETO_TICKS_VERIFICACAO_PAGAMENTO =
  (60 * 60 * 1000) / INTERVALO_VERIFICACAO_PAGAMENTO_MS; // 60 min / 10s = 360 ticks

interface CheckoutFormValues {
  name: string;
  whatsapp: string;
  cep?: string;
  street?: string;
  number?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
}

interface CheckoutViewProps {
  readonly cart?: CartItem[];
  readonly subtotal?: number;
  readonly shipping?: number;
  readonly total?: number;
  readonly onClearCart?: () => void;
  readonly onNavigate: (view: View, productId?: string) => void;
  readonly onSetBackOverride: (override: (() => void) | null) => void;
}

export function CheckoutView({
  cart: propCart,
  subtotal: propSubtotal,
  shipping: propShipping,
  total: propTotal,
  onClearCart: propOnClearCart,
  onNavigate,
  onSetBackOverride,
}: CheckoutViewProps) {
  const { config, isLoaded: storeConfigLoaded } = useStore();
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(380);
  const {
    cart: ctxCart,
    cartTotal: ctxSubtotal,
    shippingFee: ctxShipping,
    clearCart: ctxClearCart,
    addToCart,
    selectedShippingOption,
    shippingCep,
  } = useCart();

  const cart = propCart ?? ctxCart;
  const subtotal = propSubtotal ?? ctxSubtotal;
  const shipping = propShipping ?? ctxShipping;
  const total = propTotal ?? ctxSubtotal + ctxShipping;
  const onClearCart = propOnClearCart ?? ctxClearCart;
  // CHECKOUT-090: realtime ligado (antes `useOrders(false, true)` desligava
  // o efeito inteiro na primeira linha de useOrders.ts — nenhuma assinatura
  // era criada, e a tela do PIX nunca soube que o pedido tinha sido pago) e
  // `isAdmin` corrigido para `false` — esta é a tela do CLIENTE, e o valor
  // antigo (`true`) só era inofensivo porque `enabled=false` desligava tudo
  // antes de chegar a importar. `createOrder` não lê `isAdmin` em nenhum
  // ramo (useOrders.ts); `updateOrderStatus` passa a validar de verdade
  // (só cancela pedido `pending`), mas o único uso daqui
  // (handleCancelarPedidoESairDoPagamento) já embrulha a chamada num
  // try/catch que relê o pedido depois — uma recusa cliente-side cai no
  // mesmo caminho que uma recusa da RPC.
  //
  // `onRealtimeEvent` recebe o payload CRU do Postgres (não o `Order`
  // mapeado) — é o único lugar que carrega `payment_status`: o
  // `handleRealtimeUpdate` interno de useOrders.ts só copia `status` e
  // `trackingCode` para o array `orders`, nunca `payment_status`. Fecha
  // sobre `orderId`/`setStatusPagamentoPix`, declarados mais abaixo no
  // corpo do componente — seguro porque este callback só é INVOCADO de
  // forma assíncrona, depois que o componente já terminou de renderizar (e
  // as duas ligações já existem), nunca durante a construção da função.
  const { createOrder, updateOrderStatus } = useOrders(true, false, {
    onRealtimeEvent: (payload: any) => {
      if (payload?.eventType !== "UPDATE") return;
      const pedidoAtualizado = payload.new;
      if (!pedidoAtualizado || pedidoAtualizado.id !== orderId) return;
      if (pedidoAtualizado.payment_status === "pago") {
        setStatusPagamentoPix("confirmado");
      } else if (pedidoAtualizado.payment_status === "pago_apos_expirar") {
        setStatusPagamentoPix("fora-do-prazo");
      }
    },
  });
  const { validateCoupon } = useCoupons();
  const { user, profile, loading: authLoading } = useAuth();
  // CHECKOUT-070 (#197): sinal de rede para o cancelamento do pagamento
  // falho — mesmo hook já usado por ShippingCalculator, sem mecanismo novo.
  const isOffline = useOnlineStatus();
  const {
    addresses,
    fetchAddresses,
    addAddress,
    updateAddress,
    loading: addressesLoading,
  } = useAddresses();

  const formatWhatsApp = (value: string) => {
    const numbers = value.replaceAll(/\D/g, "");

    if (numbers.length <= 2) return numbers;
    if (numbers.length <= 7)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
    if (numbers.length <= 11)
      return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7, 11)}`;
  };

  const getDefaultWhatsApp = () => {
    const whatsapp = profile?.whatsapp || user?.user_metadata?.whatsapp;
    return whatsapp ? formatWhatsApp(whatsapp) : "";
  };

  const dynamicSchema = useMemo(() => {
    return z
      .object({
        name: z.string().min(1, "Nome é obrigatório"),
        whatsapp: z.string().min(14, "WhatsApp inválido"),
        cep: z.string().optional(),
        street: z.string().optional(),
        number: z.string().optional(),
        neighborhood: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        complement: z.string().optional(),
      })
      .superRefine((data, ctx) => {
        if (!user) {
          if (!data.cep || data.cep.length < 8) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "CEP inválido",
              path: ["cep"],
            });
          }
          if (!data.street || data.street.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Rua é obrigatória",
              path: ["street"],
            });
          }
          if (!data.number || data.number.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Número é obrigatório",
              path: ["number"],
            });
          }
          if (!data.neighborhood || data.neighborhood.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Bairro é obrigatório",
              path: ["neighborhood"],
            });
          }
          if (!data.city || data.city.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Cidade é obrigatória",
              path: ["city"],
            });
          }
          if (!data.state || data.state.trim() === "") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Estado inválido",
              path: ["state"],
            });
          }
        }
      });
  }, [user]);

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(dynamicSchema),
    defaultValues: {
      name: profile?.full_name || user?.user_metadata?.name || "",
      whatsapp: getDefaultWhatsApp(),
      cep: localStorage.getItem("ikcous_last_shipping_cep") || "38500-000",
      city: "Monte Carmelo",
      state: "MG",
    },
    mode: "onChange",
  });

  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (storeConfigLoaded && !hasInitializedRef.current) {
      hasInitializedRef.current = true;
      const isNational = config.shippingCoverage === "national";
      if (!form.formState.isDirty) {
        form.reset({
          name: profile?.full_name || user?.user_metadata?.name || "",
          whatsapp: getDefaultWhatsApp(),
          cep:
            localStorage.getItem("ikcous_last_shipping_cep") ||
            (isNational ? "" : config.originCep || "38500-000"),
          city: isNational ? "" : "Monte Carmelo",
          state: isNational ? "" : "MG",
        });
      }
    }
  }, [
    storeConfigLoaded,
    config.shippingCoverage,
    config.originCep,
    profile,
    user,
  ]);

  // Busca de CEP do checkout de convidado — mesma implementação do
  // AddressForm, atrás de useBuscaCep (#184 corrida, #185 timeout, #186
  // abort no desmonte).
  const { buscando: isSearchingCep, buscar: buscarCep } = useBuscaCep(
    (endereco) => {
      if (endereco.logradouro)
        form.setValue("street", endereco.logradouro, {
          shouldValidate: true,
        });
      if (endereco.bairro)
        form.setValue("neighborhood", endereco.bairro, {
          shouldValidate: true,
        });
      if (endereco.localidade)
        form.setValue("city", endereco.localidade, {
          shouldValidate: true,
        });
      if (endereco.uf)
        form.setValue("state", endereco.uf, { shouldValidate: true });
    },
  );

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [orderId, setOrderId] = useState("");
  // O prazo NÃO é estado daqui — chega do banco pela resposta da edge
  // function, dentro do PagamentoOnline (ver comentário lá).
  const [aguardandoPagamento, setAguardandoPagamento] = useState(false);
  // CHECKOUT-090: estado de três valores, não dois booleanos independentes
  // — dois booleanos podem divergir (os dois `true` ao mesmo tempo, ou os
  // dois `false` quando um dos dois status chegou), e essa divergência é
  // exatamente o defeito que esta tarefa existe para impedir. `null` é o
  // QR ainda valendo; os outros dois são finais, sem caminho de volta a
  // `null` nem um para o outro.
  //
  // 'confirmado' é o `payment_status === 'pago'` de sempre.
  //
  // 'fora-do-prazo' é `payment_status === 'pago_apos_expirar'`. Achado 1 da
  // revisão (16/08/2026): esse status NÃO é pagamento legítimo do ponto de
  // vista do pedido — é o que a varredura do prazo grava quando o
  // pagamento chega DEPOIS da reserva vencer, e nesse caminho o pedido já
  // foi marcado `status='cancelled'` e o estoque já foi devolvido ANTES
  // (supabase/migrations/20260807000000_reserva_com_expiracao.sql:113-116).
  // A spec do webhook confirma que esse status "não toca estoque nem
  // status" (docs/superpowers/specs/2026-08-07-fase-3-webhook-design.md:79)
  // e a decisão do Gabriel (mesma spec, linha 136, e reafirmada em
  // 16/08/2026 para o texto desta tela) é que ninguém automático reativa o
  // pedido: ele decide caso a caso, pelo painel, depois do push "Pagamento
  // fora do fluxo" que o webhook manda ao lojista. Mostrar "a loja já está
  // preparando seu pedido" aqui seria mentir sobre um pedido cancelado — a
  // tela própria deste estado (PagamentoForaDoPrazoView, abaixo) diz que o
  // dinheiro entrou, que o prazo venceu e que a loja entra em contato para
  // confirmar ou devolver o valor, sem prometer entrega.
  //
  // Confirmado por dois caminhos independentes — o evento de realtime
  // (onRealtimeEvent, acima) e a verificação periódica (useEffect abaixo,
  // rede de segurança contra WebSocket caído) — e nenhum dos dois estados
  // finais tem caminho de volta a `null`.
  const [statusPagamentoPix, setStatusPagamentoPix] = useState<
    "confirmado" | "fora-do-prazo" | null
  >(null);
  // CHECKOUT-050: falha da criação da cobrança precisa ficar NA TELA — um
  // toast (2500ms, sonner.tsx) some antes do cliente sair de olhar o botão
  // "Pagar", no rodapé, para o topo. `categoria` decide se existe "Tentar de
  // novo" (ver CategoriaErroPagamento em PagamentoOnline.tsx): nunca
  // reclassificada aqui por texto de mensagem, só repassada como o
  // PagamentoOnline mandou.
  const [erroPagamento, setErroPagamento] = useState<{
    mensagem: string;
    categoria: CategoriaErroPagamento;
  } | null>(null);
  // CHECKOUT-070 (#197): saída para pagamento falho. `isCancelandoPedido`
  // trava o botão contra clique repetido (cancelar duas vezes bateria na
  // guarda de status da RPC, mas evitar a segunda viagem de rede evita até
  // o erro). `erroCancelamento` é o mesmo padrão de `erroPagamento`: banner
  // fixo na tela, não toast — um toast (2500ms) some antes do cliente ler.
  const [isCancelandoPedido, setIsCancelandoPedido] = useState(false);
  const isCancelandoPedidoRef = useRef(false);
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null);
  // Congelado no momento do submit, como orderId — sem isso, o onClearCart()
  // duas linhas abaixo zera o carrinho, cartTotal/shippingFee caem para 0
  // (ou ficam negativos com cupom aplicado) e o Brick nasce cobrando um
  // valor que não bate com o total já gravado no pedido.
  const [valorDoPedido, setValorDoPedido] = useState(0);
  // Mesmo motivo do valorDoPedido: onClearCart() zera `cart` duas linhas
  // abaixo, e cancelar o pagamento precisa devolver estes itens depois. Um
  // ref (não estado) porque nada aqui precisa re-renderizar a tela.
  const itensDoPedidoParaRestaurarRef = useRef<CartItem[]>([]);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discount: number;
  } | null>(null);
  const [couponError, setCouponError] = useState<string>("");
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null,
  );
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const hasPushedAddressModalState = useRef(false);

  // Solo-ninja: Reset scroll when internal views change (address form or success)
  useEffect(() => {
    if (isAddressModalOpen || showSuccess) {
      const mainContainer = document.querySelector("main");
      if (mainContainer) {
        mainContainer.scrollTop = 0;
      }
      globalThis.scrollTo(0, 0);
    }
  }, [isAddressModalOpen, showSuccess]);

  // Push virtual history state when modal opens to intercept browser back button
  useEffect(() => {
    if (isAddressModalOpen && !hasPushedAddressModalState.current) {
      console.log("[CheckoutView] Pushing virtual address state");
      globalThis.history.pushState(
        { modal: "address" },
        "",
        globalThis.location.pathname,
      );
      hasPushedAddressModalState.current = true;
    } else if (!isAddressModalOpen) {
      hasPushedAddressModalState.current = false;
    }
  }, [isAddressModalOpen]);

  // Handle back button override for address modal
  useEffect(() => {
    if (isAddressModalOpen) {
      onSetBackOverride(() => () => {
        setIsAddressModalOpen(false);
        setEditingAddressId(null);
      });
    } else if (showSuccess || aguardandoPagamento) {
      // Sucesso ou aguardando pagamento: o pedido já foi criado e o carrinho
      // já foi limpo — não existe formulário para o botão voltar recuperar.
      // Sem este ramo, o voltar do Android saía direto para o carrinho vazio,
      // sem aviso, com o pedido reservado e o prazo de 30 minutos correndo.
      onSetBackOverride(() => () => onNavigate("home"));
    } else {
      onSetBackOverride(null);
    }

    return () => onSetBackOverride(null);
  }, [
    isAddressModalOpen,
    showSuccess,
    aguardandoPagamento,
    onSetBackOverride,
    onNavigate,
  ]);

  // Guest checkout enabled - no redirect
  useEffect(() => {
    if (!authLoading && !user) {
      console.log("[CheckoutView] Guest mode active.");
    }
  }, [user, authLoading]);

  // Pagamento online exige conta (decisão do Gabriel, 16/08/2026) — sem isto,
  // um cliente que selecionou "Pagar agora com PIX" e teve a SESSÃO expirar
  // com a tela ainda aberta (ex.: token vencendo enquanto ele preenchia o
  // formulário) ficaria com `paymentMethod` preso em "online" mesmo sem
  // `user`, e `handleSubmitEvent` tentaria criar um pedido que o backend
  // (`criar-pagamento`, guard `PAGAMENTO_ONLINE_EXIGE_CONTA`) recusaria de
  // qualquer jeito — só que depois de já ter criado o PEDIDO (a recusa é na
  // função que gera a cobrança, uma chamada depois). `!authLoading`: não
  // mexe enquanto o hook de auth ainda está resolvendo a sessão inicial —
  // nesse intervalo `user` é `undefined`, não uma sessão que caiu de
  // verdade.
  useEffect(() => {
    if (!authLoading && !user && paymentMethod === "online") {
      setPaymentMethod("pix");
    }
  }, [authLoading, user, paymentMethod]);

  useEffect(() => {
    if (profile) {
      form.setValue("name", profile.full_name || "", { shouldValidate: true });
      form.setValue(
        "whatsapp",
        profile.whatsapp ? formatWhatsApp(profile.whatsapp) : "",
        { shouldValidate: true },
      );
      form.trigger();
    } else if (user) {
      form.trigger();
    }
  }, [profile, user, form]);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    }
  }, [user, fetchAddresses]);

  const handleSelectAddress = useCallback((address: Address) => {
    setSelectedAddressId(address.id);
  }, []);

  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.is_default) || addresses[0];
      handleSelectAddress(defaultAddr);
    }
  }, [addresses, selectedAddressId, handleSelectAddress]);

  // CHECKOUT-090: verificação periódica do pagamento. Nasceu como "rede de
  // segurança" contra o WebSocket do realtime cair sem avisar, mas o achado
  // 3 da revisão (16/08/2026) mostrou que no celular ela é o mecanismo
  // PRINCIPAL, não a rede de segurança: esconder a aba por ~3s já derruba a
  // liderança do realtime (useLeaderElection.ts: debounce de 300ms +
  // resignLeadership) e ~4s depois disso o canal compartilhado é removido
  // (useOrders.ts: refCount-- -> removeChannel após o debounce de 4s) — o
  // `postgres_changes` do Supabase NÃO tem replay, então o UPDATE que chegar
  // nesse intervalo (~3,3s a ~7,3s sem cobertura) está perdido para sempre.
  // No fluxo DOMINANTE (abrir o app do banco, pagar, voltar para cá) é este
  // useEffect quem descobre a confirmação, não o realtime.
  //
  // Por isso, além de reler o BANCO (nunca a edge function `criar-pagamento`,
  // que bate na API do Mercado Pago a cada chamada) a cada
  // INTERVALO_VERIFICACAO_PAGAMENTO_MS, o listener de `visibilitychange`
  // abaixo dispara a verificação IMEDIATAMENTE quando a aba volta a ficar
  // visível — sem ele o cliente esperaria o próximo tick de até 10s, ou bem
  // mais, porque o navegador aplica "intensive throttling" a timer de aba em
  // segundo plano. Fica de fora quando a aba está em segundo plano —
  // desperdício que multiplica por cliente parado — e para sozinho quando o
  // pedido é confirmado (efeito não recria o intervalo, e a limpeza do
  // anterior já rodou), quando o componente desmonta (mesma limpeza), quando
  // o `payment_status` chega a um dos quatro status TERMINAIS ('pago',
  // 'pago_apos_expirar', 'recusado', 'estornado' — ver `verificarPagamento`,
  // abaixo), ou quando o teto de TICKS (não de relógio — ver o comentário
  // grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no topo do arquivo) é
  // atingido. 'expirado' continua sendo consultado normalmente, porque é o
  // único caminho até 'pago_apos_expirar'.
  //
  // ESCOPO (decidido na tarefa): só cliente LOGADO. `marketplace_orders_
  // select_policy` só concede SELECT a `authenticated` — pedido de convidado
  // tem `user_id` NULL e `anon` não tem política nenhuma, então a consulta
  // abaixo voltaria vazia (RLS) mesmo sem este `!user`. A checagem explícita
  // evita gastar uma consulta por 10s sabendo de antemão que ela nunca pode
  // confirmar nada, e documenta a decisão em vez de depender do RLS calado.
  useEffect(() => {
    if (!aguardandoPagamento || !orderId || statusPagamentoPix || !user?.id)
      return;

    let parado = false;
    // Conta ticks do INTERVALO, não invocações de verificarPagamento — a
    // chamada extra do visibilitychange (abaixo) não é uma passagem do
    // relógio programado, é uma verificação avulsa disparada por um evento
    // do usuário. Contar as duas juntas faria quem alterna de aba com
    // frequência esgotar o teto bem antes dos 60 min reais de vida.
    let ticks = 0;

    const verificarPagamento = async () => {
      if (parado) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const { data, error } = await supabase
        .from("marketplace_orders")
        .select("payment_status, expires_at")
        .eq("id", orderId)
        .single();

      if (parado || error || !data) return;

      // Ver o comentário do estado `statusPagamentoPix`, acima: os dois
      // status são finais e mutuamente exclusivos.
      if (data.payment_status === "pago") {
        setStatusPagamentoPix("confirmado");
        return;
      }
      if (data.payment_status === "pago_apos_expirar") {
        setStatusPagamentoPix("fora-do-prazo");
        return;
      }

      // Os outros dois status terminais não têm tela própria aqui — só
      // param de consultar (a constraint do banco não modela caminho de
      // volta a partir deles, ver
      // `supabase/migrations/20260807000000_reserva_com_expiracao.sql:17`).
      if (
        data.payment_status === "recusado" ||
        data.payment_status === "estornado"
      ) {
        parado = true;
        clearInterval(intervalId);
        return;
      }

      // `data.expires_at` continua sendo LIDO (é o único caminho até
      // 'pago_apos_expirar'), mas não decide mais quando parar — ver o
      // comentário grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no topo do
      // arquivo, sobre por que comparar com o relógio do cliente é o mesmo
      // defeito por outra porta.
    };

    const intervalId = setInterval(() => {
      ticks += 1;
      // Teto de segurança por TICKS, nunca por `expires_at`/`Date.now()`
      // (ver o comentário grande de `TETO_TICKS_VERIFICACAO_PAGAMENTO`, no
      // topo do arquivo). REGRESSÃO corrigida na 3ª revisão (16/08/2026):
      // gravar `parado = true` de forma SÍNCRONA aqui, logo após disparar
      // `verificarPagamento()`, acontecia ANTES da consulta ao Supabase
      // resolver — `verificarPagamento` suspende no primeiro `await`, e
      // `await` sempre cede pelo menos um microtask antes de voltar. Como o
      // guard de `verificarPagamento` é `if (parado || error || !data)
      // return;`, a resposta do último tick era descartada em 100% dos
      // casos, mesmo quando ela trazia `payment_status: 'pago'`. Anexar o
      // corte ao `.finally()` da PRÓPRIA chamada garante que `parado` só
      // vira `true` depois que `verificarPagamento` já consumiu a resposta
      // deste tick — o teto continua parando no mesmo tick de antes, só que
      // sem descartar o resultado que o motivou.
      verificarPagamento().finally(() => {
        if (ticks >= TETO_TICKS_VERIFICACAO_PAGAMENTO) {
          parado = true;
          clearInterval(intervalId);
        }
      });
    }, INTERVALO_VERIFICACAO_PAGAMENTO_MS);

    // Achado 3 da revisão: dispara a verificação NA HORA em que a aba volta
    // a ficar visível, em vez de esperar o próximo tick do intervalo acima.
    // `verificarPagamento` já se protege sozinha (checa `document.
    // visibilityState` e `parado` no topo), então só precisa ser chamada —
    // as mesmas guardas de parada valem aqui.
    const aoVoltarAFicarVisivel = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "visible"
      ) {
        verificarPagamento();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", aoVoltarAFicarVisivel);
    }

    return () => {
      parado = true;
      clearInterval(intervalId);
      if (typeof document !== "undefined") {
        document.removeEventListener(
          "visibilitychange",
          aoVoltarAFicarVisivel,
        );
      }
    };
  }, [aguardandoPagamento, orderId, statusPagamentoPix, user?.id]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="size-12 animate-spin rounded-full border-4 border-zinc-100 border-t-zinc-900" />
      </div>
    );
  }

  // Remove !user early return to allow guest checkout UI to render
  // if (!user) return null; // Wait for redirect

  // Values are now passed from props to ensure consistency
  const discount = appliedCoupon?.discount || 0;
  const finalTotal = total - discount;

  const isValid = form.formState.isValid;

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponError("");
  };

  const handleApplyCoupon = async (code: string) => {
    setCouponError("");
    try {
      const result = await validateCoupon(code, subtotal);

      if (result.valid) {
        setAppliedCoupon({ code, discount: result.discount });
      } else {
        setCouponError(result.message || "Cupom inválido");
      }
    } catch (error) {
      console.error("Error applying coupon:", error);
      setCouponError("Erro ao validar cupom");
    }
  };

  const handleNewAddressSubmit = async (
    data: Omit<Address, "id" | "user_id">,
  ): Promise<void> => {
    let result;
    if (editingAddressId) {
      const success = await updateAddress(editingAddressId, data);
      if (success) {
        result = addresses.find((a) => a.id === editingAddressId);
      }
    } else {
      result = await addAddress(data);
    }

    if (result) {
      // Use history.back() to close instead of direct state set
      // This ensures history is cleared and triggers our backOverride cleanup
      globalThis.history.back();
      handleSelectAddress(result);
      // Auto-scroll back to summary section if needed
      globalThis.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleEditAddress = (address: Address) => {
    setEditingAddressId(address.id);
    setIsAddressModalOpen(true);
  };

  const handleSubmitEvent = async () => {
    const isFormValid = await form.trigger();
    if (!isFormValid) {
      toast.error(
        "Por favor, preencha todos os campos obrigatórios corretamente.",
      );
      return;
    }

    const data = form.getValues();

    setIsSubmitting(true);

    if (user && !selectedAddressId) {
      toast.error("Por favor, adicione ou selecione um endereço de entrega.");
      setIsSubmitting(false);
      return;
    }

    const customerInfo = data as unknown as Customer;
    const observations = notes || undefined;

    const variantNotes = cart
      .filter((item) => item.variantNames)
      .map((item) => `${item.product.name}: ${item.variantNames}`)
      .join("\n");
    const shippingNotes = selectedShippingOption
      ? `Frete Escolhido: ${selectedShippingOption.name} (Prazo: ${selectedShippingOption.deliveryDays} dias)`
      : undefined;
    const noteParts = [observations, variantNotes, shippingNotes].filter(
      Boolean,
    );
    const finalNotes =
      noteParts.length > 0 ? noteParts.join("\n\n") : undefined;

    const orderData: any = {
      customer: customerInfo,
      items: cart.map((item) => ({
        product_id: item.product.id, // Fixed key name for RPC
        quantity: item.quantity,
        variant_id: item.variantId, // Fixed key name for RPC
      })),
      totalAmount: finalTotal,
      shippingCost: shipping,
      // Identificam a cotação que o servidor gravou; sem isso o banco cai na
      // taxa padrão da loja e o total não fecha.
      destinationCep: shippingCep,
      shippingOptionId: selectedShippingOption?.id ?? null,
      paymentMethod,
      addressId: user ? selectedAddressId : null,
      addressData: user
        ? null
        : {
            cep: data.cep,
            street: data.street,
            number: data.number,
            neighborhood: data.neighborhood,
            city: data.city || "Monte Carmelo",
            state: data.state || "MG",
            complement: data.complement,
          },

      couponCode: appliedCoupon?.code,
      notes: finalNotes,
      status: "pending",
    };

    try {
      const ehOnline = paymentMethod === "online";
      const order = await createOrder(orderData, {
        comPagamentoOnline: ehOnline,
      });
      setOrderId(order.id);
      setValorDoPedido(finalTotal);
      // Snapshot ANTES do onClearCart() da linha seguinte — depois dele
      // `cart` (propCart ?? ctxCart) já está vazio. CHECKOUT-070 (#197)
      // usa isto para devolver os itens se o pagamento online falhar.
      itensDoPedidoParaRestaurarRef.current = cart;

      // 🤖 Automação Solo-Ninja: O disparo agora é 100% via Backend (Edge Function + Webhook)
      onClearCart();

      if (ehOnline) {
        // NÃO mostra sucesso e NÃO solta confete: o pedido só está reservado,
        // e quem confirma pagamento é o webhook (Fase 3). Chamar isso de
        // sucesso aqui é a mentira que a tela de hoje conta.
        setAguardandoPagamento(true);
        return;
      }

      setShowSuccess(true);

      // Trigger confetti celebration
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#000000", "#ffffff", "#10b981", "#fbbf24"],
      });
    } catch (error: any) {
      console.error("Error creating order:", error);
      const errorMessage =
        error.message || "Ocorreu um erro ao processar seu pedido.";
      toast.error(`Falha no Pedido: ${errorMessage}`);
      // Fallback alert if toast fails or for critical notice
      if (!error.message)
        globalThis.alert(
          "Ocorreu um erro ao criar o pedido. Por favor, tente novamente.",
        );
    } finally {
      setIsSubmitting(false);
    }
  };

  // CHECKOUT-070 (#197): saída para quem teve o pagamento online recusado —
  // cancela o pedido (devolve estoque) e devolve o cliente ao carrinho para
  // ele concluir escolhendo "pagar na entrega". Só existe para sessão
  // autenticada: `update_order_status_atomic` recusa qualquer chamador sem
  // `auth.uid()` desde o PEDIDO-010 (#115) — pedido de convidado não tem
  // sessão para passar nessa guarda, e isso não é contornado aqui (ver botão
  // condicionado a `user` abaixo, e o relatório desta task).
  //
  // Achados 1 e 2 da revisão: nunca confiar no retorno de updateOrderStatus
  // para decidir "foi cancelado". O ramo offline de useOrders empilha a
  // mudança e RESOLVE sem lançar (ele foi escrito para o admin); e a
  // mensagem de guarda "Apenas pedidos pendentes..." é a MESMA (P0001) tanto
  // para "o pg_cron já cancelou" quanto para "o lojista adiantou para
  // processing" — casos opostos. Por isso o handler relê o status real do
  // pedido depois de chamar a RPC (RLS do dono permite) e só navega quando a
  // releitura confirma 'cancelled'. Qualquer outra coisa é falha segura.
  const handleCancelarPedidoESairDoPagamento = async () => {
    // Proteção contra clique duplo. Precisa ser REF, não o estado
    // `isCancelandoPedido`: dois cliques síncronos (dois `dispatchEvent` na
    // mesma tarefa, antes de qualquer re-render) leriam o mesmo `false`
    // fechado no closure de cada chamada — o React 18 agrupa os dois
    // `setIsCancelandoPedido(true)` num único commit, então checar o ESTADO
    // aqui não pegaria o segundo clique a tempo. Mutação de ref é síncrona.
    if (isCancelandoPedidoRef.current) return;
    isCancelandoPedidoRef.current = true;

    setIsCancelandoPedido(true);
    setErroCancelamento(null);
    try {
      if (isOffline) {
        // Sem rede o ramo offline de useOrders só empilha e resolve — não
        // vale nem tentar a RPC. Mensagem específica em vez do genérico.
        setErroCancelamento(
          "Sem conexão com a internet. Conecte-se e tente cancelar de novo — o pedido continua reservado.",
        );
        return;
      }

      try {
        // MESMA rpc que a reconciliação da #180 (PR #198) já ensinou a
        // gravar payment_status — não existe, e não deve existir, outro
        // caminho de cancelamento neste front. `silent=true`: o toast de
        // 2500ms do useOrders someria antes do cliente ler; o erro fica no
        // banner fixo abaixo, como erroCancelamento.
        await updateOrderStatus(orderId, "cancelled", undefined, true);
      } catch (erroRpc) {
        // Não decide aqui: a RPC pode recusar com a MESMA mensagem P0001
        // por dois motivos opostos (pg_cron já cancelou vs. lojista
        // adiantou). Quem decide é a releitura logo abaixo.
        console.error("Erro ao chamar RPC de cancelamento:", erroRpc);
      }

      const { data, error: erroLeitura } = await supabase
        .from("marketplace_orders")
        .select("status")
        .eq("id", orderId)
        .single();

      const statusFinal = data?.status;
      if (erroLeitura || statusFinal !== "cancelled") {
        console.error("Cancelamento não confirmado:", erroLeitura);
        // Precedente ADMIN-010 (#94): só não segue em frente quando a
        // gravação não é confirmada — nunca leva o cliente ao carrinho como
        // se o cancelamento tivesse dado certo.
        setErroCancelamento(
          statusFinal && statusFinal !== "pending"
            ? "Este pedido não está mais pendente — o lojista já deve ter começado a prepará-lo. Fale com a loja se ainda quiser cancelar."
            : "Não foi possível confirmar o cancelamento. Tente novamente.",
        );
        return;
      }

      for (const item of itensDoPedidoParaRestaurarRef.current) {
        addToCart(
          item.product,
          item.quantity,
          item.variantId,
          item.variantNames,
        );
      }
      onNavigate("cart");
    } finally {
      isCancelandoPedidoRef.current = false;
      setIsCancelandoPedido(false);
    }
  };

  if (aguardandoPagamento && orderId) {
    // CHECKOUT-090: pagamento confirmado — troca o QR (e o aviso de reserva
    // de 30 minutos, que é justamente a frase que faz o cliente achar que
    // falhou) pela confirmação. Ramos separados, ANTES do JSX do QR: os três
    // (QR, confirmado, fora do prazo) nunca podem coexistir na tela.
    if (statusPagamentoPix === "confirmado") {
      return (
        <PagamentoConfirmadoView
          orderId={orderId}
          valor={valorDoPedido}
          onNavigate={onNavigate}
        />
      );
    }

    if (statusPagamentoPix === "fora-do-prazo") {
      return (
        <PagamentoForaDoPrazoView
          orderId={orderId}
          valor={valorDoPedido}
          onNavigate={onNavigate}
        />
      );
    }

    return (
      <div className="min-h-dvh space-y-4 bg-gray-50/10 px-3.5 pt-4">
        <h1 className="text-lg font-bold text-zinc-900">
          Finalize o pagamento
        </h1>
        <p className="text-xs text-zinc-500">
          Seu pedido está reservado. Se o pagamento não sair em 30 minutos, os
          itens voltam para o estoque e o pedido é cancelado.
        </p>
        {erroPagamento ? (
          <div className="space-y-3 rounded-2xl border border-red-100 bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-500" />
              <p className="text-sm font-medium text-red-700">
                {erroPagamento.mensagem}
              </p>
            </div>
            {erroPagamento.categoria === "recuperavel" && (
              <Button
                onClick={() => {
                  setErroPagamento(null);
                  // Achado da 2ª revisão do #197: sem isto, um cancelamento
                  // que falhou deixa a mensagem dele pendurada — "Tentar de
                  // novo" limpava só o erro de pagamento, e no erro seguinte
                  // a caixa vermelha reaparecia com um aviso de cancelamento
                  // que já não vale mais.
                  setErroCancelamento(null);
                }}
                className="w-full rounded-xl bg-red-600 text-white hover:bg-red-600/90"
              >
                Tentar de novo
              </Button>
            )}
            {/* CHECKOUT-070 (#197): visível nos dois casos — no terminal é a
                única ação; no recuperável fica em segundo plano (variant
                "outline"), sem roubar o destaque de "Tentar de novo". Só
                para sessão autenticada (ver comentário do handler acima). */}
            {user ? (
              <Button
                onClick={handleCancelarPedidoESairDoPagamento}
                disabled={isCancelandoPedido}
                variant={
                  erroPagamento.categoria === "terminal" ? "default" : "outline"
                }
                className={cn(
                  "w-full rounded-xl gap-2",
                  erroPagamento.categoria === "terminal" &&
                    "bg-zinc-900 text-white hover:bg-zinc-900/90",
                )}
              >
                {isCancelandoPedido && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Cancelar pedido e voltar ao carrinho
              </Button>
            ) : (
              // Achado 3 da revisão do #197: sem sessão, `update_order_status_atomic`
              // recusaria a chamada (PEDIDO-010, #115) — não dá para
              // esconder o botão e não dizer nada. O convidado precisa
              // saber que o pedido se resolve sozinho e que entrar na
              // conta é a única forma de cancelar antes disso.
              <p className="text-xs text-zinc-500">
                Como você não está com a conta aberta, não é possível cancelar
                por aqui. Se o pagamento não sair em 30 minutos, o pedido é
                cancelado automaticamente e os itens voltam para o estoque. Para
                cancelar agora, entre na sua conta.
              </p>
            )}
            {erroCancelamento && (
              <p className="text-xs font-medium text-red-700">
                {erroCancelamento}
              </p>
            )}
          </div>
        ) : (
          <PagamentoOnline
            orderId={orderId}
            valor={valorDoPedido}
            onErro={(msg, categoria) =>
              setErroPagamento((atual) =>
                // Achado 3 da revisão do CHECKOUT-050 (#194): a doc do
                // Mercado Pago não é clara sobre a ordem entre `onSubmit`
                // rejeitado e `callbacks.onError` do Brick — o segundo pode
                // disparar DEPOIS do primeiro. Uma vez terminal na tela,
                // NENHUM erro seguinte substitui: rebaixar para recuperável
                // reabriria "Tentar de novo" para uma recusa que nunca
                // muda com nova tentativa.
                atual?.categoria === "terminal"
                  ? atual
                  : { mensagem: msg, categoria },
              )
            }
          />
        )}
      </div>
    );
  }

  if (showSuccess) {
    return (
      <SuccessView
        orderId={orderId}
        appliedCoupon={appliedCoupon}
        discount={discount}
        onNavigate={onNavigate}
      />
    );
  }

  if (isAddressModalOpen) {
    return (
      <AddressSelectionView
        editingAddressId={editingAddressId}
        addresses={addresses}
        onNewAddressSubmit={handleNewAddressSubmit}
        onCancel={() => globalThis.history.back()}
      />
    );
  }

  return (
    <div className="pb-customer-summary min-h-dvh bg-gray-50/10 pt-2">
      <div className="space-y-4 px-3.5">
        {/* Customer Info */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/55 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <User className="size-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Dados de Identificação
            </span>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="checkout-name"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  Nome Completo
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  autoComplete="name"
                  {...form.register("name")}
                  placeholder="Como devemos te chamar?"
                  className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                />
                {form.formState.errors.name && (
                  <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                    {form.formState.errors.name.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-tel"
                  className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                >
                  WhatsApp para Contato
                </label>
                <div className="relative">
                  <Phone
                    className="absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-zinc-400"
                    aria-hidden="true"
                  />
                  <Controller
                    control={form.control}
                    name="whatsapp"
                    render={({ field }) => (
                      <input
                        id="checkout-tel"
                        type="tel"
                        autoComplete="tel"
                        value={field.value}
                        onChange={(e) =>
                          field.onChange(formatWhatsApp(e.target.value))
                        }
                        placeholder="(00) 00000-0000"
                        maxLength={15}
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 py-3 pl-12 pr-4 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                      />
                    )}
                  />
                </div>
                {form.formState.errors.whatsapp && (
                  <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                    {form.formState.errors.whatsapp.message}
                  </p>
                )}
              </div>
            </div>

            {/* Guest Address Fields */}
            {!user && (
              <div className="space-y-4 border-t border-zinc-100/50 pt-4">
                <div className="mb-1 flex items-center gap-2">
                  <MapPin className="size-4 text-zinc-400" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    Endereço de Entrega
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-cep"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      CEP
                    </label>
                    <div className="relative">
                      <input
                        id="guest-cep"
                        {...form.register("cep")}
                        placeholder={
                          config.shippingCoverage === "national"
                            ? "00000-000"
                            : "38500-000"
                        }
                        disabled={isSearchingCep}
                        className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                        onChange={async (e) => {
                          const { limpo, formatado } = formatarCep(
                            e.target.value,
                          );
                          form.setValue("cep", formatado, {
                            shouldValidate: true,
                          });
                          localStorage.setItem(
                            "ikcous_last_shipping_cep",
                            formatado,
                          );

                          const isNational =
                            config.shippingCoverage === "national";
                          if (isNational) {
                            await buscarCep(limpo);
                          }
                        }}
                      />
                      {isSearchingCep && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <Loader2 className="size-4 animate-spin text-zinc-400" />
                        </div>
                      )}
                    </div>
                    {form.formState.errors.cep && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.cep.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-neighborhood"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Bairro
                    </label>
                    <input
                      id="guest-neighborhood"
                      {...form.register("neighborhood")}
                      placeholder="Seu bairro"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.neighborhood && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.neighborhood.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <label
                      htmlFor="guest-street"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Rua
                    </label>
                    <input
                      id="guest-street"
                      {...form.register("street")}
                      placeholder="Nome da rua"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.street && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.street.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-number"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Número
                    </label>
                    <input
                      id="guest-number"
                      {...form.register("number")}
                      placeholder="123"
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                    {form.formState.errors.number && (
                      <p className="ml-1 mt-1.5 text-[10px] font-bold uppercase text-red-500">
                        {form.formState.errors.number.message}
                      </p>
                    )}
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-city"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Cidade
                    </label>
                    <input
                      id="guest-city"
                      {...form.register("city")}
                      readOnly={
                        !config.shippingCoverage ||
                        config.shippingCoverage !== "national"
                      }
                      placeholder={
                        config.shippingCoverage === "national"
                          ? "Cidade"
                          : "Monte Carmelo"
                      }
                      className={cn(
                        "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                        config.shippingCoverage === "national"
                          ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                          : "cursor-not-allowed bg-zinc-100 text-zinc-500",
                      )}
                    />
                  </div>
                  <div className="col-span-1 md:col-span-1">
                    <label
                      htmlFor="guest-state"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Estado
                    </label>
                    <input
                      id="guest-state"
                      {...form.register("state")}
                      readOnly={
                        !config.shippingCoverage ||
                        config.shippingCoverage !== "national"
                      }
                      maxLength={2}
                      placeholder={
                        config.shippingCoverage === "national" ? "UF" : "MG"
                      }
                      className={cn(
                        "w-full rounded-xl border-2 border-transparent px-4 py-3 text-sm font-medium outline-none transition-all",
                        config.shippingCoverage === "national"
                          ? "bg-zinc-50 text-zinc-800 focus:border-zinc-900 focus:bg-white"
                          : "cursor-not-allowed bg-zinc-100 text-zinc-500",
                      )}
                    />
                  </div>
                  <div className="col-span-2">
                    <label
                      htmlFor="guest-complement"
                      className="mb-1.5 ml-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    >
                      Complemento (Opcional)
                    </label>
                    <input
                      id="guest-complement"
                      {...form.register("complement")}
                      placeholder="Apto, Bloco, Fundos, etc."
                      className="w-full rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-zinc-900 focus:bg-white"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Saved Addresses (Logged In Only) */}
        {user && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                  <MapPin className="size-4" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Seus Endereços
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingAddressId(null);
                  setIsAddressModalOpen(true);
                }}
                className="flex h-8 items-center gap-1 rounded-xl bg-primary px-3 text-[9px] font-bold uppercase tracking-wider text-white transition-all hover:opacity-90"
              >
                <Plus className="size-3" /> Novo
              </Button>
            </div>
            <div className="p-4 sm:p-5">
              {addressesLoading ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <div className="border-3 mb-3 size-6 animate-spin rounded-full border-zinc-100 border-t-primary" />
                  <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                    Sincronizando endereços...
                  </p>
                </div>
              ) : (
                <AddressList
                  addresses={addresses}
                  selectable
                  selectedId={selectedAddressId || undefined}
                  onSelect={handleSelectAddress}
                  onEdit={handleEditAddress}
                />
              )}
            </div>
          </div>
        )}

        {/* Coupon */}
        {config.enableCoupons && (
          <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
              <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
                <Tag className="size-4" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Vantagem Exclusiva
              </span>
            </div>
            <div className="p-4">
              <CouponInput
                onApply={handleApplyCoupon}
                onRemove={handleRemoveCoupon}
                appliedCoupon={appliedCoupon}
                error={couponError}
              />
            </div>
          </div>
        )}

        {/* Payment Method */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <CreditCard className="size-4" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Meio de Pagamento
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 p-4">
            {[
              ...(PAGAMENTO_ONLINE_LIGADO
                ? [
                    {
                      value: "online" as PaymentMethod,
                      // SÓ PIX, e o rótulo tem de dizer isso. A Fase 3 recusa
                      // cartão em DOIS lugares — o Brick só oferece
                      // `bankTransfer` (PagamentoOnline.tsx) e a criar-pagamento
                      // devolve 400 "No momento aceitamos apenas PIX". O rótulo
                      // antigo dizia "(PIX ou cartão)" e sobreviveu à Fase 3:
                      // prometia ao cliente o que o código nega.
                      // Ao religar cartão na Fase 3.5, este rótulo volta junto.
                      label: "Pagar agora com PIX",
                      icon: CreditCard,
                      color: "text-violet-500 bg-violet-50",
                      // Pagamento online exige conta (decisão do Gabriel,
                      // 16/08/2026) — só esta opção carrega a exigência; as
                      // outras (entrega) continuam abertas a convidado.
                      requerConta: true,
                    },
                  ]
                : []),
              {
                value: "pix" as PaymentMethod,
                label: "Pix na Entrega",
                icon: Smartphone,
                color: "text-emerald-500 bg-emerald-50",
                requerConta: false,
              },
              {
                value: "card" as PaymentMethod,
                label: "Cartão na Entrega",
                icon: CreditCard,
                color: "text-blue-500 bg-blue-50",
                requerConta: false,
              },
              {
                value: "cash" as PaymentMethod,
                label: "Dinheiro na Entrega",
                icon: Banknote,
                color: "text-amber-500 bg-amber-50",
                requerConta: false,
              },
            ].map((option) => {
              const Icon = option.icon;
              const isSelected = paymentMethod === option.value;
              // Bloqueada só pela FALTA DE CONTA, nunca só por
              // `requerConta` — um cliente logado escolhe "Pagar agora com
              // PIX" normalmente. NÃO esconde a opção: some sem explicação
              // faria o convidado achar que a loja não aceita PIX pelo
              // site. Mostra com aparência de indisponível, e o clique vira
              // o caminho para resolver (entrar/criar conta), em vez de
              // selecionar o método.
              const bloqueadaPorFaltaDeConta = option.requerConta && !user;
              return (
                <button
                  key={option.value}
                  onClick={() => {
                    if (bloqueadaPorFaltaDeConta) {
                      haptic.light();
                      onNavigate("auth");
                      return;
                    }
                    setPaymentMethod(option.value);
                  }}
                  className={`flex w-full items-center gap-4 rounded-2xl border-2 p-3.5 shadow-sm transition-all duration-300 active:scale-[0.99] ${
                    bloqueadaPorFaltaDeConta
                      ? "border-zinc-50 bg-zinc-50/40 opacity-70"
                      : isSelected
                        ? "z-10 border-zinc-900 bg-white shadow-md"
                        : "border-zinc-50 bg-zinc-50/50 hover:border-zinc-100 hover:bg-white"
                  }`}
                >
                  <div
                    className={`flex size-10 items-center justify-center rounded-xl ${option.color} transition-all duration-300 ${isSelected && !bloqueadaPorFaltaDeConta ? "scale-105" : ""}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex min-w-0 flex-col items-start gap-1 text-left">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${isSelected && !bloqueadaPorFaltaDeConta ? "text-zinc-900" : "text-zinc-400"}`}
                    >
                      {option.label}
                    </span>
                    {bloqueadaPorFaltaDeConta && (
                      <span className="text-[9px] font-medium normal-case leading-snug tracking-normal text-zinc-400">
                        Pagar pelo site exige conta, para você acompanhar o
                        pedido e receber a confirmação. Toque para entrar ou
                        criar a sua.
                      </span>
                    )}
                  </div>
                  {bloqueadaPorFaltaDeConta ? (
                    <Lock className="ml-auto size-4 shrink-0 text-zinc-300" />
                  ) : (
                    <div
                      className={`ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${isSelected ? "scale-105 border-primary bg-primary" : "border-zinc-200"}`}
                    >
                      {isSelected && <Check className="size-3 text-white" />}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Notes */}
        <div className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
            <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
              <FileText className="size-4" />
            </div>
            <label
              htmlFor="order-notes"
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-500"
            >
              Notas Adicionais (Opcional)
            </label>
          </div>
          <div className="p-4">
            <textarea
              id="order-notes"
              name="order_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Deixar na portaria, campainha estragada, etc..."
              rows={2}
              className="w-full resize-none rounded-xl border-2 border-transparent bg-zinc-50 px-4 py-3 text-sm font-medium text-zinc-800 outline-none transition-all focus:border-primary focus:bg-white"
              autoComplete="off"
            />
          </div>
        </div>

        {/* Location Notice */}
        <div className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50 p-5 text-slate-800 shadow-md">
          <div className="absolute right-0 top-0 rotate-12 p-4 opacity-5 transition-transform duration-700 group-hover:rotate-0">
            <MapPin className="size-16 text-zinc-500" />
          </div>
          <div className="relative z-10 flex items-start gap-3">
            <div className="mt-0.5 shrink-0">
              <AlertCircle className="size-5 text-zinc-500" />
            </div>
            <div>
              <h4 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-900">
                Aviso de Região
              </h4>
              <p className="text-[10px] font-medium uppercase leading-relaxed tracking-tight text-slate-500">
                Nossos serviços de entrega premium estão ativos exclusivamente
                em{" "}
                <span className="font-black text-slate-900">
                  Monte Carmelo, MG
                </span>
                .
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer to prevent overlap by the sticky footer and bottom nav */}
      <div
        className="hidden md:block"
        style={{ height: "140px" }}
        aria-hidden="true"
      />
      <div
        className="block md:hidden"
        style={{ height: "calc(160px + var(--safe-area-bottom, 0px))" }}
        aria-hidden="true"
      />

      {/* Order Summary - Fixed Bottom Bar */}
      {typeof document !== "undefined" &&
        document.body &&
        createPortal(
          <AnimatePresence>
            {isPresent && isReady && (
              <motion.div
                initial={{ y: "100%", opacity: 0.5 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: "100%", opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                className="bottom-safe-navigation fixed inset-x-0 z-[110] rounded-t-2xl border-t border-zinc-100 bg-white/95 p-3 px-4 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 md:rounded-b-none md:rounded-t-2xl md:border-x md:border-b-0 md:border-t md:border-zinc-200/60"
              >
                <div className="mx-auto flex max-w-screen-md items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-col">
                    <span className="mb-1 text-[9px] font-bold uppercase leading-none tracking-wider text-zinc-400">
                      Total a Pagar
                    </span>
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className="text-lg font-black leading-none tracking-tight text-zinc-900">
                        R$ {finalTotal.toFixed(2).replace(".", ",")}
                      </span>
                      {discount > 0 && (
                        <span className="text-[9px] font-bold uppercase text-red-500">
                          (-R$ {discount.toFixed(2).replace(".", ",")} OFF)
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      haptic.medium();
                      handleSubmitEvent();
                    }}
                    disabled={!isValid || isSubmitting}
                    className={cn(
                      "h-12 px-6 transition-all duration-300 active:scale-[0.98] flex items-center justify-center gap-2 rounded-2xl uppercase tracking-wider font-bold text-xs shrink-0 shadow-lg",
                      !isValid || isSubmitting
                        ? "bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200 shadow-none"
                        : "bg-primary text-white hover:bg-primary/90 shadow-black/10",
                    )}
                  >
                    {isSubmitting ? (
                      <div className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                    ) : (
                      <>
                        <span>Finalizar Pedido</span>
                        <ArrowLeft className="size-4 rotate-180" />
                      </>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

// Sub-components to reduce cognitive complexity

interface SuccessViewProps {
  orderId: string;
  appliedCoupon: { code: string; discount: number } | null;
  discount: number;
  onNavigate: (view: View, productId?: string) => void;
}

function SuccessView({
  orderId,
  appliedCoupon,
  discount,
  onNavigate,
}: Readonly<SuccessViewProps>) {
  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-emerald-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-emerald-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <Check className="size-14 text-emerald-500" />
        </div>
        <div className="absolute -right-4 -top-4 size-8 animate-pulse rounded-full bg-amber-400 blur-xl" />
        <div className="absolute -bottom-2 -left-2 size-6 animate-pulse rounded-full bg-primary/30 blur-lg delay-500" />
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pedido Celebrado!
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Identificador:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Sua escolha premium foi registrada. Agora, nossa equipe cuidará de
            cada detalhe da logística.
          </p>
        </div>
        {appliedCoupon && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-100/50 bg-emerald-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-600">
            Vantagem Ativa: R$ {discount.toFixed(2).replace(".", ",")} OFF
          </div>
        )}
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        <button
          onClick={() => onNavigate("home")}
          className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
        >
          Retornar à Vitrine
          <ArrowLeft className="size-5 rotate-180" />
        </button>
        <button
          onClick={() => onNavigate("profile")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Ver Meus Pedidos
        </button>
      </div>
    </div>
  );
}

// CHECKOUT-090: tela de PIX confirmado. Mesmo padrão visual do SuccessView
// (ícone de check em círculo esmeralda, hierarquia de texto, dois botões de
// saída) — sem redesenho. Diferente do SuccessView (pedido pago na entrega,
// nada a confirmar), aqui existiu de fato um pagamento online recebido, daí
// o valor pago em destaque.
interface PagamentoConfirmadoViewProps {
  orderId: string;
  valor: number;
  onNavigate: (view: View, productId?: string) => void;
}

function PagamentoConfirmadoView({
  orderId,
  valor,
  onNavigate,
}: Readonly<PagamentoConfirmadoViewProps>) {
  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-emerald-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-emerald-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <Check className="size-14 text-emerald-500" />
        </div>
        <div className="absolute -right-4 -top-4 size-8 animate-pulse rounded-full bg-amber-400 blur-xl" />
        <div className="absolute -bottom-2 -left-2 size-6 animate-pulse rounded-full bg-primary/30 blur-lg delay-500" />
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pagamento Confirmado!
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Pedido:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <p className="text-lg font-black text-emerald-600">
          R$ {valor.toFixed(2).replace(".", ",")} recebido
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Seu pagamento foi confirmado e a loja já está preparando seu
            pedido.
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        <button
          onClick={() => onNavigate("profile")}
          className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-primary text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-primary/90 active:scale-95"
        >
          Ver Meus Pedidos
        </button>
        <button
          onClick={() => onNavigate("home")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Retornar à Vitrine
        </button>
      </div>
    </div>
  );
}

// CHECKOUT-090: tela do pagamento recebido DEPOIS que o prazo de reserva
// venceu. Decisão de produto do Gabriel (16/08/2026, tomada explicitamente
// com ele — texto abaixo NÃO é redação livre): "Recebemos seu pagamento,
// mas o prazo de reserva venceu. A loja vai te contatar em breve para
// confirmar ou devolver o valor." Honesto, não promete o que talvez não
// possa cumprir, e evita que a pessoa pague de novo achando que falhou.
//
// Por trás: `payment_status = 'pago_apos_expirar'` significa que a
// varredura do prazo já marcou `status='cancelled'` e já devolveu o
// estoque (20260807000000_reserva_com_expiracao.sql:113-116) — a
// mercadoria pode já ter sido vendida a outra pessoa. Um humano decide
// caso a caso (spec do webhook, linha 136): reativa se ainda tiver a
// mercadoria, ou estorna pelo painel do MP se não tiver. Por isso esta
// tela NUNCA promete entrega, preparo, envio ou prazo — só que o dinheiro
// chegou e que alguém vai falar com o cliente. Visual deliberadamente
// distinto do sucesso (âmbar, não esmeralda; ícone de alerta, não de
// check): isto não é uma comemoração.
interface PagamentoForaDoPrazoViewProps {
  orderId: string;
  valor: number;
  onNavigate: (view: View, productId?: string) => void;
}

function PagamentoForaDoPrazoView({
  orderId,
  valor,
  onNavigate,
}: Readonly<PagamentoForaDoPrazoViewProps>) {
  const { config } = useStore();

  // Mesmo mecanismo de contato já usado em OrderDetailsView, ProductView e
  // ProfileView (wa.me com DDI 55 prefixado para número de 10 ou 11
  // dígitos) — não um novo. `numeroLimpo` vazio (config.whatsappNumber não
  // configurado) desliga o botão em vez de abrir um link quebrado.
  const numeroLimpo = (config.whatsappNumber || "").replace(/\D/g, "");

  const handleFalarComALoja = () => {
    if (!numeroLimpo) return;
    let phone = numeroLimpo;
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const mensagem = `Olá! Paguei o pedido #${orderId.slice(-6).toUpperCase()}, mas o prazo de reserva venceu. Podem me ajudar?`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(mensagem)}`;
    globalThis.open(url, "_blank");
  };

  return (
    <div className="pb-customer flex min-h-full flex-col items-center justify-center bg-white px-6 text-center">
      <div className="group relative mb-12">
        <div className="absolute inset-0 scale-[2.5] rounded-2xl bg-amber-100 opacity-30 blur-3xl transition-opacity duration-1000 group-hover:opacity-50" />
        <div className="relative flex size-32 items-center justify-center rounded-2xl border-4 border-white bg-amber-50 shadow-2xl transition-transform duration-700 group-hover:scale-110">
          <AlertCircle className="size-14 text-amber-500" />
        </div>
      </div>

      <h2 className="mb-4 text-4xl font-black leading-tight tracking-tighter text-zinc-900 duration-700 animate-in slide-in-from-bottom-4">
        Pagamento Recebido
      </h2>

      <div className="mb-12 space-y-4 duration-1000 animate-in fade-in slide-in-from-bottom-8">
        <p className="text-sm font-black uppercase tracking-[0.2em] text-zinc-400">
          Pedido:{" "}
          <span className="text-zinc-900">
            #{orderId.slice(-6).toUpperCase()}
          </span>
        </p>
        <p className="text-lg font-black text-amber-600">
          R$ {valor.toFixed(2).replace(".", ",")} recebido
        </p>
        <div className="mx-auto max-w-[300px]">
          <p className="text-sm font-medium leading-relaxed text-zinc-500">
            Recebemos seu pagamento, mas o prazo de reserva venceu. A loja vai
            te contatar em breve para confirmar ou devolver o valor.
          </p>
        </div>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4 duration-1000 animate-in slide-in-from-bottom-12">
        {numeroLimpo && (
          <button
            onClick={handleFalarComALoja}
            className="shadow-3xl flex h-16 items-center justify-center gap-3 rounded-2xl bg-amber-500 text-[11px] font-black uppercase tracking-[0.3em] text-white shadow-black/10 transition-all hover:bg-amber-500/90 active:scale-95"
          >
            Falar com a Loja
          </button>
        )}
        <button
          onClick={() => onNavigate("profile")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Ver Meus Pedidos
        </button>
        <button
          onClick={() => onNavigate("home")}
          className="flex h-16 items-center justify-center gap-3 rounded-2xl border-2 border-zinc-100 bg-white text-[11px] font-black uppercase tracking-[0.3em] text-primary transition-all hover:border-primary active:scale-95"
        >
          Retornar à Vitrine
        </button>
      </div>
    </div>
  );
}

interface AddressSelectionViewProps {
  editingAddressId: string | null;
  addresses: Address[];
  onNewAddressSubmit: (data: Omit<Address, "id" | "user_id">) => Promise<void>;
  onCancel: () => void;
}

function AddressSelectionView({
  editingAddressId,
  addresses,
  onNewAddressSubmit,
  onCancel,
}: Readonly<AddressSelectionViewProps>) {
  return (
    <div className="min-h-screen bg-white pb-16 duration-500 animate-in slide-in-from-right">
      <div className="mx-auto max-w-md p-4">
        <div className="group relative mb-5 overflow-hidden rounded-2xl bg-primary p-5 shadow-lg">
          <div className="absolute right-0 top-0 -mr-16 -mt-16 size-32 rounded-full bg-white/5 blur-2xl transition-colors group-hover:bg-white/10" />
          <div className="absolute bottom-0 left-0 -mb-12 -ml-12 size-24 rounded-full bg-white/5 blur-xl" />

          <div className="relative z-10 flex flex-col">
            <h2 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
              {editingAddressId ? "Editar Endereço" : "Novo Endereço"}
              <Sparkles className="size-4.5 animate-pulse text-amber-400" />
            </h2>
            <p className="text-[10px] font-bold uppercase leading-tight tracking-wider text-white/80">
              {editingAddressId
                ? "Atualize os dados para entrega"
                : "Onde entregaremos seu produto?"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-white p-5 shadow-sm">
          <AddressForm
            initialData={
              editingAddressId
                ? addresses.find((a) => a.id === editingAddressId)
                : undefined
            }
            onSubmit={onNewAddressSubmit}
            onCancel={onCancel}
          />
        </div>

        <div className="mt-8 px-6 text-center">
          <p className="text-[10px] font-bold uppercase leading-relaxed tracking-widest text-zinc-300">
            Seus dados estão seguros e serão usados apenas para a logística de
            entrega.
          </p>
        </div>
      </div>
    </div>
  );
}

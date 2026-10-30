import { useStore } from "@/contexts/StoreContext";
import { useAddresses } from "@/hooks/useAddresses";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { useOrders } from "@/hooks/useOrders";
import { useProducts } from "@/hooks/useProducts";
import { atingiuOMinimo } from "@/lib/atingiu-o-minimo";
import {
  enderecoDeEntregaEfetivo,
  resumoDoEndereco,
} from "@/lib/endereco-de-entrega";
import type { PromessaDeCanal } from "@/lib/estrategias-de-frete";
import { promessasDeFrete } from "@/lib/estrategias-de-frete";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { ehModalidadeDaLoja, ehRetiradaNaLoja } from "@/lib/guarda-de-frete";
import { precoVendido } from "@/lib/preco-vendido";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartItem, Order, Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import { ArrowRight, ShieldCheck, Sparkles, Truck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
// Sub-components
import { AddressList } from "@/components/ui/custom/AddressList";
import { CartFooterSummary } from "@/components/ui/custom/CartFooterSummary";
import { CartItemsList } from "@/components/ui/custom/CartItemsList";
import { EmptyCart } from "@/components/ui/custom/EmptyCart";
import { AvisoDeFreteGratis } from "@/components/ui/custom/FreeShippingBlock";
import { OrderList } from "@/components/ui/custom/OrderList";
import { OrderSearch } from "@/components/ui/custom/OrderSearch";
import { ShippingCalculator } from "@/components/ui/custom/ShippingCalculator";
import type { EstadoDaBarraDeFrete } from "@/components/ui/custom/ShippingProgress";
import { ShippingProgress } from "@/components/ui/custom/ShippingProgress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeferredRender } from "@/hooks/useDeferredRender";

interface CartViewProps {
  cart?: CartItem[];
  onUpdateQuantity?: (
    productId: string,
    quantity: number,
    variantId?: string,
  ) => void;
  onRemove?: (productId: string, variantId?: string) => void;
  onNavigate: (view: View, id?: string) => void;
  initialTab?: "cart" | "orders";
  isActive?: boolean;
}

/**
 * Decide o que a lista de pedidos vira depois de uma recarga.
 *
 * POR QUE EXISTE: toda `fetchUserOrders` aborta a busca anterior
 * (useOrders:862-865) e a busca abortada devolve `[]` EM SILÊNCIO
 * (useOrders:912-919). Desde o #321 a recarga por visibilidade dispara isso
 * sozinha quando a pessoa volta ao app — e tocar em "Meus Pedidos" dentro da
 * janela do timer é o fluxo exato de quem voltou do pagamento PIX. Gravar o
 * `[]` da corrida perdida apagava da tela uma lista que o banco nunca apagou.
 *
 * A REGRA (padrão da casa, OrderDetailsView:303): recarga vazia com lista em
 * memória mantém o que está na tela — melhor um dado de um segundo atrás do
 * que piscar para "nenhum pedido" por causa de uma resposta abortada. O vazio
 * GENUÍNO continua fluindo quando não havia nada em memória (primeira carga),
 * e recarga com conteúdo sempre substitui. Preso por teste em
 * `cart-view-lista-de-pedidos-resiste-a-recarga-vazia.test.tsx` — função pura
 * de propósito, pelo mesmo motivo do `decidirSaidaDoCheckout` (#328): montar
 * a view inteira no teste arrasta o mundo e, medido neste ambiente, pendura o
 * `act` (aba orders + jsdom + framer-motion).
 *
 * DESDE o laudo #3 (onda 2, 03/09) a lista do usuário LOGADO não passa mais
 * por aqui: ela vive no estado do hook `useOrders` (vivo por realtime) e o
 * próprio hook não grava o `[]` de uma busca abortada (useOrders.ts:970-977).
 * A função fica exportada para o caminho do convidado/futuro reuso e para o
 * teste que documenta a lição da corrida abortada.
 */
export const mesclarListaAposRecarga = <T,>(
  atual: T[],
  nova: T[] | null | undefined,
): T[] => {
  const lista = nova || [];
  return lista.length > 0 || atual.length === 0 ? lista : atual;
};

/**
 * Achado CartView-328: com o preset "desligado" (ou "por_produto" sem item
 * marcado) o carrinho renderizava `ShippingProgress` do mesmo jeito,
 * passando progressPercent=0 e amountToFree=0 — e o componente, que não
 * distingue "zero porque falta tudo" de "zero porque não existe meta",
 * imprimia "META FRETE GRÁTIS ... Faltam R$ 0,00". Só existe meta de VALOR
 * na estratégia "acima_de_valor"; "desligado" e "por_produto" sem marcação
 * não têm limiar nenhum para anunciar. Quando o frete já está garantido
 * (`freteGratis` — inclui "sempre" e "por_produto" com item marcado) o
 * bloco também deve aparecer, só que para comemorar "Liberado", não para
 * uma meta.
 *
 * FRETE V3 (T3, 23/09/2026): o segundo parâmetro deixou de ser
 * `freeShippingMin` (só o canal local) — vira `temMetaPorValor`, já
 * decidido pelo chamador para o canal da MODALIDADE ESCOLHIDA (local ou
 * nacional, via `promessasDeFrete`): a meta que faz sentido mostrar depende
 * de qual delas está na mesa, nunca mais só da local.
 *
 * Função pura exportada pelo mesmo motivo de `mesclarListaAposRecarga`
 * acima: montar a `CartView` inteira no teste arrasta o mundo (useOrders,
 * useProducts, realtime...) só para exercitar uma decisão de booleano.
 */
export function deveExibirMetaDeFreteGratis(
  freteGratis: boolean,
  temMetaPorValor: boolean,
): boolean {
  return freteGratis || temMetaPorValor;
}

/**
 * O ESTADO da barra de progresso (`ShippingProgress`) — os dois defeitos que
 * esta função fecha (T3-2, 23/09/2026, revisão pós-T3):
 *
 * CASO A (retirada): `store-pickup` chega SEMPRE com preço 0 da edge — o
 * preço zero dela é a NATUREZA da retirada, não a meta de valor tendo sido
 * batida (ver `precoFinalDaOpcao`, estrategias-de-frete.ts: a regra local
 * aplicada num preço já 0 continua 0, com QUALQUER preset). Com retirada
 * escolhida e a meta de valor do canal LOCAL ainda não alcançada, o estado
 * certo é "meta" (progresso real) — nunca "liberado". Se a meta de valor JÁ
 * foi alcançada, "liberado" continua valendo: a promessa é real, a
 * retirada só a antecipa.
 *
 * CORREÇÃO (revisão Opus, 23/09/2026): retirada + "sempre"/"por_produto"
 * marcado (canal SEM meta de valor) NÃO chega a esta função na tela — o
 * PRÓPRIO CARTÃO fica ESCONDIDO nesse caso, não "liberado". O portão de
 * exibição (`deveExibirMetaDeFreteGratis`, chamado pelo `CartView` antes de
 * montar `ShippingProgress`) recebe `freteGratis && !ehRetirada` (falso,
 * porque é retirada) e `temMetaPorValor` (falso, porque "sempre"/
 * "por_produto" não são "acima_de_valor") — os dois falsos escondem o
 * cartão. Se esta função FOR chamada com esses parâmetros (ela aceita
 * qualquer `estrategiaDoCanal`, sem essa guarda), devolve "liberado" — a
 * promessa daquele preset é real —, mas isso é comportamento de função
 * pura sem chamador hoje, não o que a tela mostra.
 *
 * CASO B (nacional "mais_barata"): a meta de valor pode estar batida
 * (`subtotal >= minimoDoCanal`) sem que a OPÇÃO ESCOLHIDA seja a
 * beneficiada — o alcance "mais_barata" só zera a mais barata; as demais
 * mantêm o preço cheio (contrato §3: front nunca recalcula, só lê o preço
 * final que a edge já mandou). Meta batida + opção escolhida cobrando
 * (`precoDaOpcaoEscolhida > 0`) NUNCA pode virar "liberado" nem "meta" (que
 * mostraria "Faltam R$ 0,00", mentira): "gratis_so_na_mais_barata" avisa que
 * o grátis é só na mais barata; "meta_atingida_sem_gratis" cobre o alcance
 * "todas" residual (cotação nacional desatualizada — caso raro, texto
 * neutro sem prometer o grátis para a opção escolhida).
 *
 * Função pura pelo mesmo motivo de `deveExibirMetaDeFreteGratis` logo
 * acima: decisão de dinheiro se prova em unit test que discrimina, não
 * colada na árvore de JSX.
 */
export function estadoDaBarraDeFrete(args: {
  /** Veredito único do CartContext: preço final da opção escolhida é 0. */
  freteGratis: boolean;
  /** `ehRetiradaNaLoja(selectedShippingOption?.id)`. */
  ehRetirada: boolean;
  estrategiaDoCanal: PromessaDeCanal["estrategia"];
  /** Só significa algo quando `estrategiaDoCanal === "acima_de_valor"`. */
  minimoDoCanal: number;
  nationalBenefitScope: "mais_barata" | "todas";
  subtotal: number;
  /** Preço final da opção escolhida (`null` = sem opção/indefinido). */
  precoDaOpcaoEscolhida: number | null;
}): EstadoDaBarraDeFrete {
  const temMetaPorValor = args.estrategiaDoCanal === "acima_de_valor";
  const metaBatida =
    temMetaPorValor && atingiuOMinimo(args.subtotal, args.minimoDoCanal);

  // CASO A: retirada com meta de valor em jogo e ainda não batida — o preço
  // 0 da retirada não conta.
  if (args.ehRetirada && temMetaPorValor && !metaBatida) {
    return "meta";
  }

  const opcaoCobra =
    args.precoDaOpcaoEscolhida != null && args.precoDaOpcaoEscolhida > 0;

  // CASO B: meta batida, mas a opção escolhida ainda cobra — o alcance
  // decide a frase, nunca "liberado" nem "Faltam R$ 0,00".
  if (metaBatida && opcaoCobra) {
    return args.nationalBenefitScope === "mais_barata"
      ? "gratis_so_na_mais_barata"
      : "meta_atingida_sem_gratis";
  }

  if (args.freteGratis) return "liberado";

  return "meta";
}

export function CartView({
  cart: propCart,
  onUpdateQuantity: propOnUpdateQuantity,
  onRemove: propOnRemove,
  onNavigate,
  onAddToCart,
  initialTab = "cart",
  isActive = true,
}: CartViewProps & {
  onAddToCart?: (product: Product, quantity?: number) => void;
}) {
  const { config } = useStore();
  // Nenhuma forma na entrega/retirada: a loja só recebe pelo app (exige conta).
  const soPeloApp =
    formasPagamentoNaEntregaValidas(config.formasPagamentoEntrega).length === 0;
  const { getFreeShippingEligibleProducts } = useProducts();
  const {
    cart: ctxCart,
    isLoading: lendoOCarrinhoSalvo,
    shippingFee: ctxShippingFee,
    freteIndefinido,
    freteGratis,
    updateQuantity,
    removeFromCart,
    clearCart,
    selectedShippingOption,
    freteEscolhidoPelaCliente,
    setSelectedShippingOption,
    shippingCep,
    setShippingCep,
    enderecoSelecionadoId,
    setEnderecoSelecionadoId,
  } = useCart();

  const { user } = useAuth();

  const cart = propCart ?? ctxCart;
  const onUpdateQuantity = propOnUpdateQuantity ?? updateQuantity;

  // O DESTINO DO FRETE É O ENDEREÇO DE ENTREGA: o escolhido
  // (`enderecoSelecionadoId`, compartilhado com o checkout) ou, na falta, o
  // principal do cadastro — a MESMA função que o CheckoutView usa. Não há
  // campo de CEP no carrinho: sem endereço, a calculadora pede o cadastro e
  // o "Finalizar Compra" continua livre (o endereço também pode ser
  // informado na finalização). O convidado não tem cadastro: o destino dele
  // é o CEP da última cotação feita no checkout, se houver.
  const { addresses, fetchAddresses } = useAddresses();
  const enderecoDestino = user
    ? enderecoDeEntregaEfetivo(addresses, enderecoSelecionadoId)
    : undefined;
  const cepDoDestino = user
    ? (enderecoDestino?.cep ?? null)
    : (shippingCep ?? null);
  const [escolhendoEndereco, setEscolhendoEndereco] = useState(false);

  useEffect(() => {
    if (user) {
      fetchAddresses();
    }
  }, [user, fetchAddresses]);

  // "Cadastrar endereço" leva à tela de endereço; o que for criado lá chega
  // aqui pela lista compartilhada do `useAddresses`. O endereço NOVO passa a
  // ser o de entrega — foi para entregar nele que a pessoa o cadastrou a
  // partir do carrinho. `null` = não há cadastro iniciado daqui.
  const idsAntesDoCadastroRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const antes = idsAntesDoCadastroRef.current;
    if (!antes) return;
    const novo = addresses.find((a) => !antes.has(a.id));
    if (!novo) return;
    idsAntesDoCadastroRef.current = null;
    setEnderecoSelecionadoId(novo.id);
  }, [addresses, setEnderecoSelecionadoId]);
  // Voltou ao carrinho: o cadastro iniciado daqui já terminou (salvo — e aí
  // o efeito acima, que roda antes, já escolheu o novo) ou foi abandonado.
  // Sem apagar a marca, um endereço cadastrado DEPOIS pelo Perfil viraria o
  // de entrega sem a cliente escolher.
  useEffect(() => {
    if (isActive) idsAntesDoCadastroRef.current = null;
  }, [isActive]);
  // Foco de quem fecha a folha pelo teclado (Esc/X/escolha): volta ao
  // "Trocar". Desligado quando a saída é o formulário ou a aba sai de foco.
  const botaoTrocarRef = useRef<HTMLButtonElement>(null);
  const devolverFocoAoTrocarRef = useRef(true);
  // Aba fora de foco (checkout ou formulário por cima): o seletor de
  // endereço não fica aberto por trás nem reabre sozinho na volta.
  useEffect(() => {
    if (!isActive) {
      devolverFocoAoTrocarRef.current = false;
      setEscolhendoEndereco(false);
    }
  }, [isActive]);

  const cadastrarEndereco = () => {
    haptic.light();
    idsAntesDoCadastroRef.current = new Set(addresses.map((a) => a.id));
    devolverFocoAoTrocarRef.current = false;
    setEscolhendoEndereco(false);
    onNavigate("address-form");
  };
  // Onda 2, laudo 02/09 #3: a aba "Meus Pedidos" deriva da lista VIVA do
  // hook — o mesmo estado que o realtime alimenta (handleRealtimeUpdate/
  // Insert/Delete em useOrders.ts:1247-1279). Antes a view copiava a lista
  // para um estado local na entrada da aba e ficava congelada até sair e
  // voltar. Prendado por tests/front/cart-aba-pedidos-viva.test.tsx.
  // `ordersLoadError`: a consulta falhou (rede/servidor) — a aba mostra "Não
  // conseguimos carregar" com "Tentar de novo" em vez de "Nenhum pedido".
  // `?? null` porque dublês de teste anteriores ao campo devolvem `undefined`.
  const {
    fetchUserOrders,
    orders: pedidosVivos,
    ordersLoadError: erroDosPedidos,
  } = useOrders(true, false);
  const [isPresent] = usePresence();
  const isReady = useDeferredRender(80);
  const isSummaryReady = useDeferredRender(380);

  const [activeTab, setActiveTab] = useState<"cart" | "orders">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const [removingId, setRemovingId] = useState<string | null>(null);

  // Directional Tab Transitions
  const [tabDirection, setTabDirection] = useState<number>(0);
  const [prevTab, setPrevTab] = useState<"cart" | "orders">(activeTab);

  if (activeTab !== prevTab) {
    setTabDirection(activeTab === "orders" ? 1 : -1);
    setPrevTab(activeTab);
  }

  const tabVariants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 30 : dir < 0 ? -30 : 0,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -30 : dir < 0 ? 30 : 0,
      opacity: 0,
    }),
  };

  // Orders State — local só do MODO CONVIDADO (busca de OrderSearch +
  // rastreio salvo em sessionStorage). Para usuário logado a lista da aba é
  // a do hook, viva (laudo #3, onda 2).
  const [pedidosConvidado, setPedidosConvidado] = useState<Order[]>([]);
  const orders = user ? pedidosVivos : pedidosConvidado;
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  // A primeira busca dos pedidos da conta já respondeu? A busca só arranca
  // depois do `useDeferredRender` (~80 ms) e `isLoadingOrders` nasce falso:
  // sem isto, aparelho sem cache dizia "Nenhum pedido" por um instante antes
  // de carregar. "Nenhum pedido" só vale DEPOIS da primeira resposta.
  const [primeiraBuscaFeita, setPrimeiraBuscaFeita] = useState(false);
  const [orderViewMode, setOrderViewMode] = useState<"user" | "guest">(
    user ? "user" : "guest",
  );
  const [ordersTab, setOrdersTab] = useState<"active" | "history">("active");

  // Directional Orders Sub-tab Transitions
  const [ordersTabDirection, setOrdersTabDirection] = useState<number>(0);
  const [prevOrdersTab, setPrevOrdersTab] = useState<"active" | "history">(
    ordersTab,
  );

  if (ordersTab !== prevOrdersTab) {
    setOrdersTabDirection(ordersTab === "history" ? 1 : -1);
    setPrevOrdersTab(ordersTab);
  }

  // Conta logada, nada em memória e nenhuma resposta ainda: é "carregando".
  const carregandoPrimeiraVez =
    Boolean(user) && pedidosVivos.length === 0 && !primeiraBuscaFeita;

  const { activeOrdersCount, historyOrdersCount } = useMemo(() => {
    let active = 0;
    let history = 0;
    orders.forEach((o) => {
      if (["pending", "processing", "shipping"].includes(o.status)) {
        active++;
      } else {
        history++;
      }
    });
    return { activeOrdersCount: active, historyOrdersCount: history };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      const isActive = ["pending", "processing", "shipping"].includes(o.status);
      return ordersTab === "active" ? isActive : !isActive;
    });
  }, [orders, ordersTab]);

  useEffect(() => {
    if (!isReady) return;
    if (activeTab === "orders") {
      if (user) {
        setIsLoadingOrders(true);
        // A lista não é mais copiada para cá: `fetchUserOrders` atualiza o
        // estado do hook (useOrders.ts:952-954) e a aba deriva dele — é isso
        // que faz o realtime alcançar a aba (laudo #3, onda 2). Na corrida
        // perdida de recarga, o próprio hook NÃO grava o `[]` do aborto
        // (useOrders.ts:970-977), então a lista em tela não pisca.
        fetchUserOrders().then(() => {
          setIsLoadingOrders(false);
          setPrimeiraBuscaFeita(true);
          setOrderViewMode("user");
        });
      } else {
        setOrderViewMode("guest");
        try {
          const cached = sessionStorage.getItem("guest_tracked_orders");
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setPedidosConvidado(parsed);
            }
          }
        } catch (e) {
          console.error("Error loading guest orders from sessionStorage:", e);
        }
      }
    }
  }, [user, fetchUserOrders, activeTab, isReady]);

  // "Tentar de novo" da lista de pedidos: refaz a leitura do servidor. O hook
  // limpa o erro quando a resposta vem ok e o mantém se falhar de novo.
  const devolverFocoDoRetryRef = useRef(false);
  const tentarCarregarPedidosDeNovo = useCallback(() => {
    devolverFocoDoRetryRef.current = true;
    setIsLoadingOrders(true);
    fetchUserOrders().then(() => {
      setIsLoadingOrders(false);
      setPrimeiraBuscaFeita(true);
    });
  }, [fetchUserOrders]);

  // Foco de quem tocou em "Tentar de novo": se a leitura falhar de novo, o
  // botão continua montado (a OrderList o mantém, "Carregando…") e o foco
  // fica nele. Se der certo, o botão sai de cena — o foco vai para o painel
  // da aba (tabIndex -1, estável), em vez de cair no corpo da página.
  useEffect(() => {
    if (!devolverFocoDoRetryRef.current || isLoadingOrders) return;
    devolverFocoDoRetryRef.current = false;
    if (!erroDosPedidos) document.getElementById("painel-orders")?.focus();
  }, [isLoadingOrders, erroDosPedidos]);

  useEffect(() => {
    const getScrollElement = () => document.querySelector("main");

    const initialMain = getScrollElement();
    if (initialMain) {
      initialMain.scrollTop = 0;
    }

    // Handle micro-delays for React lazy-load mounts and Framer-Motion transition settle times
    const rafHandle = requestAnimationFrame(() => {
      const el = getScrollElement();
      if (el) el.scrollTop = 0;
    });

    const timer1 = setTimeout(() => {
      const el = getScrollElement();
      if (el) el.scrollTop = 0;
    }, 50);

    const timer2 = setTimeout(() => {
      const el = getScrollElement();
      if (el) el.scrollTop = 0;
    }, 150);

    return () => {
      cancelAnimationFrame(rafHandle);
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [activeTab]);

  const subtotal = useMemo(
    () =>
      cart.reduce((sum, item) => {
        if (!item?.product?.price) return sum;
        // Laudo 31/08 (menor E): regra única do preço em preco-vendido.ts —
        // `||` cobrava o preço cheio de variação com override ZERO.
        return (
          sum +
          precoVendido(
            item.product,
            item.product.variants?.find((v) => v.id === item.variantId),
          ) *
            (item.quantity || 0)
        );
      }, 0),
    [cart],
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [cart],
  );

  // T3 (23/09): a promessa que vale para a barra de progresso é a do CANAL
  // da modalidade ESCOLHIDA (local ou nacional) — nunca mais só a local.
  // Sem escolha, o resultado não é exibido (a `ShippingProgress` só monta
  // com `!freteIndefinido`, mais abaixo), então o default "nacional" aqui é
  // inofensivo.
  const promessaDoCanalEscolhido = useMemo(() => {
    const promessas = promessasDeFrete(config);
    return ehModalidadeDaLoja(selectedShippingOption?.id)
      ? promessas.local
      : promessas.nacional;
  }, [config, selectedShippingOption?.id]);

  const {
    progressPercent,
    amountToFree,
    shipping,
    total,
    savings,
    isNearlyThere,
  } = useMemo(() => {
    if (cart.length === 0)
      return {
        progressPercent: 0,
        amountToFree: 0,
        shipping: 0,
        total: 0,
        savings: 0,
        isNearlyThere: false,
      };

    // FRETE V2 (onda D-1, 03/09): o grátis do carrinho é o VEREDITO ÚNICO do
    // CartContext (`freteGratis` — presets de presets-de-frete-gratis.ts,
    // modelo exclusivo). Até hoje este memo mantinha a cópia ANTIGA da regra,
    // morta duas vezes aqui:
    //  1. leitura INCONDICIONAL de `product.freeShipping` (mostrava
    //     "Economizou"/grátis com item marcado mesmo com o preset desligado
    //     — a marcação só vale dentro do preset "por_produto");
    //  2. trava `&& !!user` no limiar (convidado tem o MESMO direito do
    //     logado — a entrega dele é local e o frete local entra na mesma
    //     regra; lição #53: regra copiada diverge).
    //
    // REVISÃO A3 (frete v2, 03/09): `savings` ZEROU nos dois caminhos. Ele
    // comparava contra `config.shippingFee` — a taxa fixa que MORREU nesta
    // branch (campo órfão no banco; o edge não cota mais por ela), então
    // "Economizou R$ X" media a economia contra um preço que não existe. O
    // que de fato deixaria de ser cobrado é a cotação/entrega local — e, com
    // o grátis ativo, não há cotação em mãos para citar número nenhum. Sem
    // número honesto, sem número: o selo diz "Frete grátis aplicado".
    //
    // Barra de progresso segue o limiar da MODALIDADE ESCOLHIDA (T3, 23/09
    // — antes só existia a regra local; agora local e nacional têm
    // estratégias independentes, e o limiar certo é o do canal que está de
    // fato na mesa). SEM trava de login (mesmo padrão do CartReminder na
    // frente B). "desligado" e "por_produto" não têm barra de valor — quem
    // comunica o grátis por produto é a marcação no produto.
    const isRuleActive =
      promessaDoCanalEscolhido.estrategia === "acima_de_valor";
    const meta = promessaDoCanalEscolhido.minimo;

    // CASO A (revisão Opus, pós-T3, 23/09): `store-pickup` chega SEMPRE com
    // preço 0 da edge — isso não é a meta de VALOR batida (a retirada é
    // grátis por natureza, com QUALQUER preset). Sem esta guarda, o atalho
    // `freteGratis` abaixo mostrava 100%/"Faltam R$ 0,00" para uma loja cuja
    // meta local a cliente ainda não alcançou. Só pula o atalho quando a
    // retirada está em jogo E existe meta de valor E ela AINDA não foi
    // batida — meta já batida (ou canal sem meta de valor, "sempre"/
    // "por_produto") continua no atalho: a promessa ali é real.
    const ehRetiradaEscolhida = ehRetiradaNaLoja(selectedShippingOption?.id);
    const retiradaComMetaNaoBatida =
      ehRetiradaEscolhida && isRuleActive && !atingiuOMinimo(subtotal, meta);

    if (freteGratis && !retiradaComMetaNaoBatida) {
      return {
        progressPercent: 100,
        amountToFree: 0,
        shipping: 0,
        total: subtotal,
        savings: 0,
        isNearlyThere: false,
      };
    }

    const progress = isRuleActive ? Math.min((subtotal / meta) * 100, 100) : 0;
    const diff = isRuleActive ? Math.max(0, meta - subtotal) : 0;
    // FRETE INDEFINIDO (laudo caça-bugs 30/08, achado 7): com provedor de
    // cotação real e nenhuma cotação escolhida, `ctxShippingFee` é o chute de
    // fábrica — exibir `null` ("A calcular") e NÃO somar frete ao total.
    // REVISÃO A3: `save` zerou junto — comparava contra `config.shippingFee`,
    // o preço morto da taxa fixa (ver o comentário acima).
    const ship = freteIndefinido ? null : ctxShippingFee;
    const tot = subtotal + (ship ?? 0);
    const save = 0;
    const nearly = Boolean(isRuleActive && progress >= 70 && progress < 100);

    return {
      progressPercent: isRuleActive ? progress : 0,
      amountToFree: diff,
      shipping: ship,
      total: tot,
      savings: save,
      isNearlyThere: nearly,
    };
  }, [
    subtotal,
    promessaDoCanalEscolhido,
    freteGratis,
    cart.length,
    ctxShippingFee,
    freteIndefinido,
    selectedShippingOption?.id,
  ]);

  const freeShippingProducts = useMemo(() => {
    return getFreeShippingEligibleProducts(
      cart.filter((i) => i?.product?.id).map((i) => i.product.id),
    );
  }, [cart, getFreeShippingEligibleProducts]);

  // UI-191 (G10): a pergunta de "esvaziar" é a caixa de confirmação da casa
  // (AlertDialog), não o `confirm()` do navegador -- que numa loja instalada
  // aparece com o endereço do site e o visual do sistema. Mesma ação: só
  // `clearCart()`, só depois do "sim".
  const [confirmandoEsvaziar, setConfirmandoEsvaziar] = useState(false);
  const handleClearCart = () => setConfirmandoEsvaziar(true);

  const handleRemove = useCallback(
    (productId: string, variantId?: string) => {
      const key = `${productId}-${variantId || "default"}`;
      setRemovingId(key);
      setTimeout(() => {
        // A lixeira é o fluxo que pede o aviso com "Desfazer" (UI-170): quem
        // injeta o próprio `onRemove` segue com o contrato de antes.
        if (propOnRemove) propOnRemove(productId, variantId);
        else removeFromCart(productId, variantId, { comDesfazer: true });
        setRemovingId(null);
      }, 300);
    },
    [propOnRemove, removeFromCart],
  );
  // Caça 4 (C5): a retirada na loja chega com preço 0 por natureza -- os dois
  // resumos (computador e rodapé do celular) dizem "Retirada na loja" e não
  // anunciam "frete grátis", que seria promessa que a loja pode não ter.
  const retiradaEscolhida = ehRetiradaNaLoja(selectedShippingOption?.id);
  return (
    <div className="pb-customer-summary flex min-h-full flex-col bg-background text-foreground">
      {/* Laudo de acessibilidade 05/09 (onda 3, item B1): o carrinho não
          tinha NENHUM heading — leitor de tela sem título de página.
          sr-only: zero pixel muda. Rodada 2 (Codex, 08/09, item 4): com
          initialTab="orders" a tela visível é "Meus Pedidos", mas o h1
          continuava dizendo "Carrinho" — agora acompanha a aba ativa. */}
      <h1 className="sr-only">
        {activeTab === "orders" ? "Meus Pedidos" : "Carrinho"}
      </h1>
      {/* Abas Carrinho / Meus pedidos: o indicador de tinta desliza sob o
          texto da aba ativa (estilo Tinta, 24/10/2026). */}
      <div className="sticky top-[-2px] z-50 bg-background/95 px-4 py-3 backdrop-blur-md min-[380px]:px-5">
        <div
          className="relative flex overflow-hidden rounded-2xl bg-muted/60 p-1"
          role="tablist"
        >
          <motion.div
            aria-hidden="true"
            className="absolute inset-y-1 rounded-xl bg-foreground"
            initial={false}
            animate={{
              left: activeTab === "cart" ? "4px" : "50%",
              width: "calc(50% - 4px)",
            }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />

          <button
            id="tab-cart"
            role="tab"
            aria-selected={activeTab === "cart"}
            aria-controls="painel-cart"
            onClick={() => {
              haptic.light();
              setActiveTab("cart");
              onNavigate("cart");
            }}
            className={cn(
              "relative z-10 h-11 flex-1 rounded-xl px-3 text-[15px] font-semibold transition-colors duration-300",
              activeTab === "cart"
                ? "text-background"
                : "text-muted-foreground",
            )}
          >
            Carrinho ({cartCount})
          </button>

          <button
            id="tab-orders"
            role="tab"
            aria-selected={activeTab === "orders"}
            aria-controls="painel-orders"
            onClick={() => {
              haptic.light();
              setActiveTab("orders");
              onNavigate("orders");
            }}
            className={cn(
              "relative z-10 h-11 flex-1 rounded-xl px-3 text-[15px] font-semibold transition-colors duration-300",
              activeTab === "orders"
                ? "text-background"
                : "text-muted-foreground",
            )}
          >
            Meus pedidos
          </button>
        </div>
      </div>

      <div className="relative flex w-full flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={tabDirection}>
          {activeTab === "cart" ? (
            <motion.div
              key="cart-content"
              id="painel-cart"
              role="tabpanel"
              aria-labelledby="tab-cart"
              custom={tabDirection}
              variants={tabVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { ease: [0.16, 1, 0.3, 1], duration: 0.38 },
                opacity: { duration: 0.2 },
              }}
              className="flex w-full flex-1 flex-col"
            >
              {cart.length === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  {/* Lendo o carrinho salvo da conta: ainda não dá para dizer
                      "vazio" (caça 11-D #6). `isLoading` termina sempre — o
                      `finally` da leitura e o tempo-limite de 8 s. */}
                  {lendoOCarrinhoSalvo && !propCart ? (
                    <div
                      role="status"
                      className="flex flex-col items-center gap-3 px-6 py-16"
                    >
                      <Skeleton className="h-4 w-40" />
                      <p className="text-sm text-muted-foreground">
                        Carregando seu carrinho…
                      </p>
                    </div>
                  ) : (
                    <EmptyCart onNavigate={onNavigate} />
                  )}
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-7xl flex-col items-stretch gap-6 px-4 pb-6 pt-1 min-[380px]:px-5 lg:flex-row lg:items-start lg:gap-8 lg:px-8 lg:py-6">
                  {/* Coluna Esquerda: Itens, Frete Grátis e Checkout Convidado */}
                  <div className="w-full min-w-0 flex-1 space-y-6">
                    <CartItemsList
                      cart={cart}
                      removingId={removingId}
                      onUpdateQuantity={onUpdateQuantity}
                      onRemove={handleRemove}
                      handleClearCart={handleClearCart}
                    />

                    {/* FRETE V2 (onda D-1): o grátis agora é o veredito
                        único do CartContext (`freteGratis` — a cópia antiga
                        `hasFreeShippingItem` lia a marcação incondicional e
                        escondia a calculadora mesmo com o preset desligado).
                        CORREÇÃO CartView-495 (15/09): a calculadora NÃO
                        soma mais `&& !freteGratis` na condição. No preset
                        "por_produto" o `freteGratis` do CartContext lê a
                        marcação `product.freeShipping` do SNAPSHOT do
                        carrinho (localStorage) — a RPC do pedido lê
                        `produtos.frete_gratis` FRESCO do banco na hora de
                        fechar (20261081000000:294-318) e recusa o pedido
                        pedindo uma opção de entrega (:324-326) quando os
                        dois discordam. Esconder a calculadora enquanto o
                        cliente ACHA que é grátis tirava dele a única chance
                        de deixar um `shipping_option_id` pronto para esse
                        caso. A própria `ShippingCalculator` já lê o mesmo
                        `freteGratis` (via `useCartState`) e se rotula
                        sozinha como "GRÁTIS" nesse estado — ver
                        shipping-calculator-frete-gratis-fonte-unica.test.tsx —,
                        então nada muda visualmente quando os dois lados
                        concordam; só passa a existir uma saída quando
                        discordam. */}
                    {/* Uma calculadora cotando por vez: o carrinho continua
                        montado atrás do checkout (aba mantida viva), e o
                        checkout tem a própria. Fora da aba, esta desmonta —
                        o lacre do desmonte descarta a resposta em voo. */}
                    {cart.length > 0 && isActive && (
                      <div className="space-y-3">
                        <ShippingCalculator
                          key={user?.id ?? "convidado"}
                          cart={cart}
                          selectedOption={selectedShippingOption}
                          selecaoEscolhidaPelaCliente={
                            freteEscolhidoPelaCliente
                          }
                          onSelectOption={setSelectedShippingOption}
                          onCepValidated={setShippingCep}
                          cepDestino={cepDoDestino}
                          cepDaSelecao={shippingCep}
                          destino={
                            enderecoDestino
                              ? {
                                  apelido: enderecoDestino.name,
                                  resumo: resumoDoEndereco(enderecoDestino),
                                }
                              : null
                          }
                          mensagemSemDestino={
                            user
                              ? "Cadastre um endereço para ver o frete e o prazo — ou continue e informe o endereço na finalização."
                              : "O frete é calculado pelo endereço de entrega, que você informa na finalização da compra."
                          }
                          acaoDoEndereco={
                            !user ? null : addresses.length > 0 ? (
                              <button
                                ref={botaoTrocarRef}
                                type="button"
                                aria-haspopup="dialog"
                                aria-expanded={escolhendoEndereco}
                                onClick={() => {
                                  haptic.light();
                                  devolverFocoAoTrocarRef.current = true;
                                  setEscolhendoEndereco(true);
                                }}
                                className="min-h-11 select-none rounded-xl border border-solid border-border bg-background px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                              >
                                Trocar
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={cadastrarEndereco}
                                className="min-h-11 select-none rounded-xl bg-foreground px-3 text-[13px] font-semibold text-background transition-colors hover:bg-foreground/90"
                              >
                                Cadastrar endereço
                              </button>
                            )
                          }
                        />
                        {/* SELETOR DE ENDEREÇO EM FOLHA (22/09, relato da
                            cliente no celular): o painel antigo nascia NO
                            FLUXO, logo abaixo do card de frete — com o
                            carrinho rolado até o fim, ele caía atrás do
                            rodapé fixo Total/Finalizar e da navegação, e
                            nada rolava até ele (medido: só o endereço já
                            escolhido ficava à vista; os outros e o "Novo
                            endereço" ficavam cobertos). A folha modal é
                            portalada no body em z-[130], ACIMA dos dois
                            rodapés; a lista rola DENTRO dela e o
                            "Cadastrar novo endereço" fica no rodapé da
                            folha, sempre à vista. Prova geométrica em
                            tests/e2e/jornada-trocar-endereco-carrinho.spec.ts. */}
                        <Sheet
                          open={
                            Boolean(user) &&
                            escolhendoEndereco &&
                            addresses.length > 0
                          }
                          onOpenChange={setEscolhendoEndereco}
                        >
                          <SheetContent
                            side="bottom"
                            data-testid="seletor-endereco-entrega"
                            className="mx-auto max-h-[85dvh] gap-0 rounded-t-3xl sm:max-w-md"
                            // A folha abre por ESTADO (sem SheetTrigger): o
                            // Radix não tem gatilho para devolver o foco e
                            // ele cairia no body. Volta ao "Trocar" — exceto
                            // quando a saída é o formulário de endereço ou
                            // a aba saiu de foco (botão desmontado).
                            onCloseAutoFocus={(evento) => {
                              evento.preventDefault();
                              const botao = botaoTrocarRef.current;
                              if (
                                devolverFocoAoTrocarRef.current &&
                                botao?.isConnected
                              ) {
                                botao.focus();
                              }
                            }}
                          >
                            <SheetHeader className="shrink-0 px-5 pb-3 pr-12 pt-5">
                              <SheetTitle className="text-base font-bold tracking-tight text-foreground">
                                Entregar em
                              </SheetTitle>
                              <SheetDescription className="text-[13px] text-muted-foreground">
                                Escolha onde receber o pedido. O frete é
                                recalculado para o endereço escolhido.
                              </SheetDescription>
                            </SheetHeader>
                            <div
                              data-testid="seletor-endereco-lista"
                              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-3"
                            >
                              <AddressList
                                addresses={addresses}
                                selectable
                                compact
                                selectedId={enderecoDestino?.id}
                                onSelect={(endereco) => {
                                  haptic.light();
                                  // Compara com o id GUARDADO, não com o
                                  // efetivo: se o guardado aponta para um
                                  // endereço que sumiu da lista, o carrinho
                                  // mostra o principal como "Selecionado" —
                                  // tocá-lo tem de trocar o id morto pelo
                                  // dele, ou o checkout envia um addressId
                                  // que não existe. Mesmo id guardado: só
                                  // fecha.
                                  if (endereco.id !== enderecoSelecionadoId) {
                                    setEnderecoSelecionadoId(endereco.id);
                                  }
                                  setEscolhendoEndereco(false);
                                }}
                              />
                            </div>
                            {/* Rodapé FIXO da folha: fora da área que rola,
                                com a área segura do aparelho (mesma
                                variável dos rodapés da casa). */}
                            <SheetFooter className="mt-0 shrink-0 border-t border-border bg-background px-5 pb-[calc(0.75rem+var(--safe-area-bottom,env(safe-area-inset-bottom,0px)))] pt-3">
                              <button
                                type="button"
                                onClick={cadastrarEndereco}
                                className="flex h-12 w-full select-none items-center justify-center rounded-2xl border border-dashed border-input text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                              >
                                + Cadastrar novo endereço
                              </button>
                            </SheetFooter>
                          </SheetContent>
                        </Sheet>
                      </div>
                    )}

                    {/* Frete indefinido esconde o cartão de progresso: com
                        `shipping ?? 0` ele anunciava "Frete VIP Liberado" em
                        verde enquanto o rodapé dizia "A calcular" — duas
                        frases opostas na mesma tela (revisão da frente
                        horário-e-convidado, achado baixa). */}
                    {user &&
                      cart.length > 0 &&
                      !freteIndefinido &&
                      deveExibirMetaDeFreteGratis(
                        // MENOR (revisão Opus, pós-T3): retirada na loja
                        // (`store-pickup`) SEMPRE chega a R$ 0 da edge — o
                        // preço zero dela não é a promessa da loja tendo
                        // batido. Sem esta guarda, uma loja com o grátis
                        // DESLIGADO ainda comemorava "Frete Grátis Liberado"
                        // assim que a cliente escolhia retirar. A barra de
                        // meta por valor (`temMetaPorValor`, abaixo) continua
                        // igual — ela não depende de retirada.
                        freteGratis &&
                          !ehRetiradaNaLoja(selectedShippingOption?.id),
                        promessaDoCanalEscolhido.estrategia ===
                          "acima_de_valor",
                      ) && (
                        <ShippingProgress
                          estado={estadoDaBarraDeFrete({
                            freteGratis,
                            ehRetirada: ehRetiradaNaLoja(
                              selectedShippingOption?.id,
                            ),
                            estrategiaDoCanal:
                              promessaDoCanalEscolhido.estrategia,
                            minimoDoCanal: promessaDoCanalEscolhido.minimo,
                            nationalBenefitScope: config.nationalBenefitScope,
                            subtotal,
                            precoDaOpcaoEscolhida: shipping,
                          })}
                          savings={savings}
                          progressPercent={progressPercent}
                          amountToFree={amountToFree}
                          isNearlyThere={isNearlyThere}
                          freeShippingProducts={freeShippingProducts}
                          onAddToCart={onAddToCart}
                          deferred={!isReady}
                          onNavigate={onNavigate}
                        />
                      )}

                    {/* Sem frete cotado (convidada, ou logada que ainda não
                        escolheu a entrega) o cartão de progresso acima não
                        existe — e o carrinho ficava mudo sobre frete grátis
                        enquanto a Home dizia "Liberado" ou "Faltam R$ X"
                        (medição de 30/10/2026). Aqui entra o MESMO aviso da
                        Home (mesmo componente, mesma conta, limite da
                        configuração da loja). Só informa: não mexe no frete
                        nem no total. Com frete cotado e logada segue só o
                        cartão de antes (sem aviso duplicado), e a retirada
                        na loja não fala de frete grátis. */}
                    {cart.length > 0 &&
                      (!user || freteIndefinido) &&
                      !ehRetiradaNaLoja(selectedShippingOption?.id) && (
                        <AvisoDeFreteGratis cartTotal={subtotal} />
                      )}

                    {!user && cart.length > 0 && (
                      <div className="rounded-[18px] border border-border bg-muted/30 p-5">
                        {/* Header */}
                        <div className="mb-5 flex items-center gap-3">
                          <div className="flex size-11 items-center justify-center rounded-xl bg-foreground text-background">
                            <Sparkles className="size-5" />
                          </div>
                          <div>
                            <h3 className="text-[15px] font-semibold text-foreground">
                              Opções de Compra
                            </h3>
                            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                              Rápido e Seguro
                            </p>
                          </div>
                        </div>

                        {/* Options/Benefits List */}
                        <div className="mb-5 space-y-4 border-t border-border pt-4">
                          <div className="flex gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                              <Truck className="size-4 text-foreground/70" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-foreground">
                                Identificar-se (Entrar)
                              </p>
                              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                                {/* FRETE V2 (onda D-1, 03/09): a promessa
                                    "e ativar o frete grátis (acima de
                                    R$ X)" morreu com a trava de login da
                                    regra — convidado tem o MESMO direito
                                    do logado (frente B no CartContext;
                                    mesmo corte do "Faça login para
                                    liberar o Frete VIP" no CartReminder).
                                    "Acumular pontos" nunca existiu no app.
                                    Prometer ao convidado que o login
                                    libera o que ele JÁ ganha é promessa
                                    falsa. */}
                                Faça login para salvar seus itens.
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                              <Sparkles className="size-4 text-foreground/70" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-foreground">
                                {soPeloApp
                                  ? "Entre para finalizar"
                                  : "Comprar como Convidado"}
                              </p>
                              <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                                {/* Só promete o que vale (caça 11-D #3): loja
                                    sem forma na entrega só fecha pelo app, e
                                    isso exige conta; fora da cidade também.
                                    O checkout avisa os dois antes do envio. */}
                                {soPeloApp
                                  ? "Nesta loja o pagamento é feito pelo app, por isso é preciso entrar na sua conta para finalizar."
                                  : "Você pode comprar como visitante em muitos casos; se precisar de conta, avisamos antes de finalizar."}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Button Actions */}
                        <div className="flex flex-col gap-3">
                          <button
                            onClick={() => {
                              haptic.medium();
                              onNavigate("auth" as any);
                            }}
                            className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-[0.98]"
                          >
                            Identificar-se e Entrar
                            <ArrowRight className="size-5" />
                          </button>

                          <div className="flex items-center justify-center gap-3">
                            <div className="h-px flex-1 bg-border" />
                            <span className="text-[13px] text-muted-foreground">
                              ou se preferir
                            </span>
                            <div className="h-px flex-1 bg-border" />
                          </div>

                          <button
                            onClick={() => {
                              haptic.light();
                              onNavigate("checkout");
                            }}
                            className="h-[52px] w-full rounded-2xl border border-solid border-border bg-background text-[15px] font-semibold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
                          >
                            {soPeloApp
                              ? "Ver o pedido antes de entrar"
                              : "Continuar como Convidado"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Coluna Direita: Resumo do Pedido (Desktop Only) */}
                  <div className="sticky top-24 hidden w-full shrink-0 space-y-5 rounded-[18px] border border-border bg-background p-6 lg:block lg:w-[380px]">
                    <div>
                      <h3 className="mb-1 text-lg font-bold tracking-tight text-foreground">
                        Resumo do Pedido
                      </h3>
                      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        {cartCount}{" "}
                        {cartCount > 1
                          ? "itens selecionados"
                          : "item selecionado"}
                      </p>
                    </div>

                    <div className="space-y-3 border-t border-border pt-4">
                      <div className="flex items-center justify-between text-[15px]">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="font-semibold text-foreground">
                          {formatCurrency(subtotal)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[15px]">
                        <span className="text-muted-foreground">Frete</span>
                        <span
                          className={cn(
                            "font-semibold",
                            retiradaEscolhida
                              ? "text-foreground"
                              : shipping === 0
                                ? "text-emerald-700 dark:text-emerald-400"
                                : shipping === null
                                  ? "text-muted-foreground"
                                  : "text-foreground",
                          )}
                        >
                          {retiradaEscolhida
                            ? "Retirada na loja"
                            : shipping === 0
                              ? "GRÁTIS"
                              : shipping === null
                                ? "A calcular"
                                : formatCurrency(shipping)}
                        </span>
                      </div>

                      {shipping === 0 && !retiradaEscolhida && (
                        <div className="flex items-center justify-between text-[15px]">
                          <span className="text-muted-foreground">Bônus</span>
                          <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                            <Sparkles className="size-3.5" />
                            Frete Grátis
                          </span>
                        </div>
                      )}

                      {amountToFree > 0 &&
                        !retiradaEscolhida &&
                        !freteIndefinido && (
                          <p className="flex items-start gap-2 rounded-[14px] border border-border p-3 text-[13px] leading-snug text-foreground">
                            <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>
                              Adicione mais{" "}
                              <span className="font-bold">
                                {formatCurrency(amountToFree)}
                              </span>{" "}
                              para garantir{" "}
                              <span className="font-bold">Frete Grátis</span>!
                            </span>
                          </p>
                        )}
                    </div>

                    <div className="flex items-end justify-between gap-3 border-t border-border pt-4">
                      <div>
                        <span className="mb-1 block font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          Total
                        </span>
                        <span className="text-2xl font-bold tracking-tight text-foreground">
                          {formatCurrency(total)}
                        </span>
                      </div>
                      {shipping === 0 && !retiradaEscolhida && (
                        /* REVISÃO A3 (frete v2, 03/09): o selo dizia
                           "Economizou R$ X" contra `config.shippingFee` —
                           preço morto da taxa fixa. Sem cotação alternativa
                           em mãos não há número honesto: só o fato. */
                        <span className="flex items-center gap-1.5 pb-1 text-[13px] font-medium text-emerald-700 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500" />
                          Frete grátis aplicado
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        haptic.medium();
                        onNavigate("checkout");
                      }}
                      className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl bg-foreground text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-[0.98]"
                    >
                      Finalizar Compra
                      <ArrowRight className="size-5" />
                    </button>

                    {/*
                      SÓ ENTRA AQUI O QUE A LOJA CUMPRE.

                      Havia mais dois selos até 18/08/2026, e os dois descreviam
                      recurso inexistente: "Envio expresso e código de rastreio
                      automático" (não há envio expresso, e o rastreio é digitado
                      à mão pela lojista no painel) e "Garantia de devolução fácil
                      em até 7 dias" (não existe fluxo de devolução — os status
                      são a #108, a política é a #46, ambas abertas).

                      Selo de confiança que promete o que não existe não gera
                      reclamação: gera cliente que paga, espera, não recebe e some.
                      Antes de acrescentar um selo novo aqui, exija o caminho que
                      o cumpre — a trava está em
                      tests/front/cart-view-promessas-que-a-loja-nao-cumpre.test.tsx.
                    */}
                    <div className="space-y-3 border-t border-border pt-4">
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <ShieldCheck className="size-4 flex-shrink-0" />
                        <span className="text-[13px] leading-tight">
                          Ambiente de pagamento 100% seguro
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="orders-content"
              id="painel-orders"
              tabIndex={-1}
              role="tabpanel"
              aria-labelledby="tab-orders"
              custom={tabDirection}
              variants={tabVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { ease: [0.16, 1, 0.3, 1], duration: 0.38 },
                opacity: { duration: 0.2 },
              }}
              className="flex w-full flex-1 flex-col px-4 pb-6 pt-0 focus:outline-none min-[380px]:px-5"
            >
              {orderViewMode === "guest" && (
                <OrderSearch
                  onNavigate={onNavigate}
                  whatsappDaLoja={config.whatsappNumber}
                  onOrdersFound={(foundOrders) => {
                    setPedidosConvidado(foundOrders);
                  }}
                />
              )}

              {orders.length > 0 && !isLoadingOrders && (
                <div className="mb-4 flex flex-wrap gap-2">
                  <button
                    aria-pressed={ordersTab === "active"}
                    onClick={() => {
                      haptic.light();
                      setOrdersTab("active");
                    }}
                    className={cn(
                      "h-11 rounded-xl border border-solid px-4 text-[15px] font-semibold transition-colors",
                      ordersTab === "active"
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-foreground/80 hover:bg-muted",
                    )}
                  >
                    Em andamento ({activeOrdersCount})
                  </button>

                  <button
                    aria-pressed={ordersTab === "history"}
                    onClick={() => {
                      haptic.light();
                      setOrdersTab("history");
                    }}
                    className={cn(
                      "h-11 rounded-xl border border-solid px-4 text-[15px] font-semibold transition-colors",
                      ordersTab === "history"
                        ? "border-foreground bg-foreground text-background"
                        : "border-border text-foreground/80 hover:bg-muted",
                    )}
                  >
                    Histórico ({historyOrdersCount})
                  </button>
                </div>
              )}

              <div className="relative flex w-full flex-1 flex-col overflow-hidden">
                <AnimatePresence
                  mode="wait"
                  initial={false}
                  custom={ordersTabDirection}
                >
                  <motion.div
                    key={ordersTab}
                    custom={ordersTabDirection}
                    variants={tabVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: "spring", stiffness: 350, damping: 35 },
                      opacity: { duration: 0.18 },
                    }}
                    className="flex w-full flex-1 flex-col"
                  >
                    {/* Convidado sem pedidos: quem já avisa e oferece "Entrar"
                        é o bloco de cima (OrderSearch). O "Histórico
                        Protegido ... Acesse" da lista repetia o aviso sem
                        botão nenhum. */}
                    {(user || orders.length > 0) && (
                      <OrderList
                        orders={filteredOrders}
                        isLoadingOrders={
                          isLoadingOrders || carregandoPrimeiraVez
                        }
                        onNavigate={onNavigate}
                        isGuest={!user}
                        loadError={user ? (erroDosPedidos ?? null) : null}
                        onRetry={tentarCarregarPedidosDeNovo}
                        hasAnyOrders={orders.length > 0}
                        emptyTitle={
                          orders.length > 0
                            ? ordersTab === "active"
                              ? "Nenhum pedido em andamento"
                              : "Nenhum pedido no histórico"
                            : undefined
                        }
                        emptyDescription={
                          orders.length > 0
                            ? ordersTab === "active"
                              ? "Quando você comprar, o andamento do pedido aparece aqui."
                              : "Quando um pedido for concluído ou cancelado, ele aparece aqui."
                            : undefined
                        }
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AlertDialog
        open={confirmandoEsvaziar}
        onOpenChange={setConfirmandoEsvaziar}
      >
        <AlertDialogContent
          overlayClassName="z-[130]"
          className="z-[130] sm:max-w-sm"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Esvaziar o carrinho?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os produtos saem do carrinho. Você pode adicioná-los de novo
              quando quiser.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Manter</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" onClick={() => clearCart()}>
              Esvaziar carrinho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AnimatePresence>
        {isActive &&
          isPresent &&
          activeTab === "cart" &&
          cart.length > 0 &&
          isSummaryReady && (
            <CartFooterSummary
              cartCount={cartCount}
              shipping={shipping}
              retiradaNaLoja={retiradaEscolhida}
              total={total}
              onNavigate={onNavigate}
            />
          )}
      </AnimatePresence>
    </div>
  );
}

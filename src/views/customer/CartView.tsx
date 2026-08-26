import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/hooks/useCart";
import { useOrders } from "@/hooks/useOrders";
import { useProducts } from "@/hooks/useProducts";
import { cn, formatCurrency } from "@/lib/utils";
import type { CartItem, Order, Product, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion, usePresence } from "framer-motion";
import {
  ArrowRight,
  Package,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CartFooterSummary } from "@/components/ui/custom/CartFooterSummary";
// Sub-components
import { CartItemsList } from "@/components/ui/custom/CartItemsList";
import { EmptyCart } from "@/components/ui/custom/EmptyCart";
import { OrderList } from "@/components/ui/custom/OrderList";
import { OrderSearch } from "@/components/ui/custom/OrderSearch";
import { ShippingCalculator } from "@/components/ui/custom/ShippingCalculator";
import { ShippingProgress } from "@/components/ui/custom/ShippingProgress";
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
  const { getFreeShippingEligibleProducts } = useProducts();
  const {
    cart: ctxCart,
    shippingFee: ctxShippingFee,
    updateQuantity,
    removeFromCart,
    clearCart,
    selectedShippingOption,
    setSelectedShippingOption,
    setShippingCep,
  } = useCart();

  const cart = propCart ?? ctxCart;
  const onUpdateQuantity = propOnUpdateQuantity ?? updateQuantity;
  const onRemove = propOnRemove ?? removeFromCart;
  const { fetchUserOrders } = useOrders(true, false);
  const { user } = useAuth();
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

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
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
        fetchUserOrders().then((data) => {
          setOrders(data || []);
          setIsLoadingOrders(false);
          setOrderViewMode("user");
        });
      } else {
        setOrderViewMode("guest");
        try {
          const cached = sessionStorage.getItem("guest_tracked_orders");
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setOrders(parsed);
            }
          }
        } catch (e) {
          console.error("Error loading guest orders from sessionStorage:", e);
        }
      }
    }
  }, [user, fetchUserOrders, activeTab, isReady]);

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
        const price = item.variantId
          ? item.product.variants?.find((v) => v.id === item.variantId)
              ?.priceOverride || item.product.price
          : item.product.price;
        return sum + price * (item.quantity || 0);
      }, 0),
    [cart],
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [cart],
  );

  const hasFreeShippingItem = useMemo(
    () => cart.some((item) => item?.product?.freeShipping),
    [cart],
  );

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

    if (hasFreeShippingItem) {
      return {
        progressPercent: 100,
        amountToFree: 0,
        shipping: 0,
        total: subtotal,
        savings: config.shippingFee || 0,
        isNearlyThere: false,
      };
    }

    const isRuleActive = (config.freeShippingMin || 0) > 0 && !!user;
    const progress = isRuleActive
      ? Math.min((subtotal / config.freeShippingMin) * 100, 100)
      : 0;
    const diff = isRuleActive
      ? Math.max(0, config.freeShippingMin - subtotal)
      : 0;
    const ship = ctxShippingFee;
    const tot = subtotal + ship;
    const save = ship === 0 ? config.shippingFee || 0 : 0;
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
    config.shippingFee,
    config.freeShippingMin,
    hasFreeShippingItem,
    cart.length,
    ctxShippingFee,
    user,
  ]);

  const freeShippingProducts = useMemo(() => {
    return getFreeShippingEligibleProducts(
      cart.filter((i) => i?.product?.id).map((i) => i.product.id),
    );
  }, [cart, getFreeShippingEligibleProducts]);

  const handleClearCart = () => {
    if (globalThis.confirm("Deseja realmente limpar todo o carrinho?")) {
      clearCart();
    }
  };

  const handleRemove = useCallback(
    (productId: string, variantId?: string) => {
      const key = `${productId}-${variantId || "default"}`;
      setRemovingId(key);
      setTimeout(() => {
        onRemove(productId, variantId);
        setRemovingId(null);
      }, 300);
    },
    [onRemove],
  );
  return (
    <div className="pb-customer-summary flex min-h-full flex-col bg-zinc-50/30 transition-all duration-300">
      {/* Tab Switcher Premium */}
      <div className="sticky top-[-2px] z-50 flex flex-col gap-2 border-b border-zinc-100 bg-white/80 px-4 py-2 backdrop-blur-md xs:gap-4 xs:px-6 xs:pb-2.5 xs:pt-3">
        <div className="relative flex overflow-hidden rounded-2xl bg-zinc-100/50 p-1">
          <motion.div
            className="absolute inset-y-1 rounded-xl border border-zinc-200/50 bg-white shadow-sm"
            initial={false}
            animate={{
              left: activeTab === "cart" ? "4px" : "50%",
              width: "calc(50% - 4px)",
            }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
          />

          <button
            onClick={() => {
              haptic.light();
              setActiveTab("cart");
              onNavigate("cart");
            }}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
              activeTab === "cart" ? "text-zinc-950" : "text-zinc-400",
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <ShoppingCart className="size-4" />
              Carrinho ({cartCount})
            </div>
          </button>

          <button
            onClick={() => {
              haptic.light();
              setActiveTab("orders");
              onNavigate("orders");
            }}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
              activeTab === "orders" ? "text-zinc-950" : "text-zinc-400",
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <Package className="size-4" />
              Meus Pedidos
            </div>
          </button>
        </div>
      </div>

      <div className="relative flex w-full flex-1 flex-col overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={tabDirection}>
          {activeTab === "cart" ? (
            <motion.div
              key="cart-content"
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
                  <EmptyCart onNavigate={onNavigate} />
                </div>
              ) : (
                <div className="mx-auto flex w-full max-w-7xl flex-col items-stretch gap-8 px-4 pb-6 pt-2 xs:px-6 lg:flex-row lg:items-start lg:px-8 lg:py-6">
                  {/* Coluna Esquerda: Itens, Frete Grátis e Checkout Convidado */}
                  <div className="w-full min-w-0 flex-1 space-y-6">
                    <CartItemsList
                      cart={cart}
                      removingId={removingId}
                      onUpdateQuantity={onUpdateQuantity}
                      onRemove={handleRemove}
                      handleClearCart={handleClearCart}
                    />

                    {cart.length > 0 && !hasFreeShippingItem && (
                      <div className="mt-3">
                        <ShippingCalculator
                          cart={cart}
                          subtotal={subtotal}
                          freeShippingMin={config.freeShippingMin || 0}
                          selectedOption={selectedShippingOption}
                          onSelectOption={setSelectedShippingOption}
                          onCepValidated={setShippingCep}
                        />
                      </div>
                    )}

                    {user && cart.length > 0 && (
                      <ShippingProgress
                        shipping={shipping}
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

                    {!user && cart.length > 0 && (
                      <div className="group relative overflow-hidden rounded-[2.5rem] border border-zinc-100 bg-zinc-50 p-6 shadow-lg shadow-black/10 sm:p-8">
                        <div className="relative z-10">
                          {/* Header */}
                          <div className="mb-6 flex items-center gap-3">
                            <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
                              <Sparkles className="size-5" />
                            </div>
                            <div>
                              <h3 className="text-sm font-black uppercase tracking-tight text-slate-800">
                                Opções de Compra
                              </h3>
                              <p className="text-[10px] font-black uppercase tracking-widest text-primary">
                                Rápido e Seguro
                              </p>
                            </div>
                          </div>

                          {/* Options/Benefits List */}
                          <div className="mb-6 space-y-4 border-t border-zinc-100 pt-5">
                            <div className="flex gap-3">
                              <div className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-white/80">
                                <Truck className="size-3.5 text-emerald-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-800">
                                  Identificar-se (Entrar)
                                </p>
                                <p className="mt-0.5 text-[9px] font-medium leading-relaxed text-slate-500">
                                  {/* "Acumular pontos" nunca existiu no app,
                                      e frete grátis por valor é regra que a
                                      loja LIGA (freeShippingMin > 0 — ver
                                      regra-de-frete.ts): prometer o que a
                                      loja não oferece é o mesmo defeito que
                                      os selos do rodapé já corrigiram. A
                                      promessa só aparece com a regra ligada,
                                      como FreeShippingBlock e
                                      ShippingProgress já fazem. */}
                                  Faça login para salvar seus itens
                                  {config.freeShippingMin > 0 && (
                                    <>
                                      {" "}
                                      e ativar o frete grátis (acima de{" "}
                                      {formatCurrency(config.freeShippingMin)})
                                    </>
                                  )}
                                  .
                                </p>
                              </div>
                            </div>

                            <div className="flex gap-3">
                              <div className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-white/80">
                                <Sparkles className="size-3.5 text-amber-500" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-black uppercase tracking-wider text-slate-800">
                                  Comprar como Convidado
                                </p>
                                <p className="mt-0.5 text-[9px] font-medium leading-relaxed text-slate-500">
                                  Finalize sua compra instantaneamente sem
                                  precisar criar senha ou cadastro.
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
                              className="flex w-full items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 py-3.5 text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/10 transition-colors hover:from-emerald-400 hover:to-emerald-500 active:scale-95"
                            >
                              Identificar-se e Entrar
                              <ArrowRight className="size-3.5" />
                            </button>

                            <div className="flex items-center justify-center gap-2 py-1">
                              <div className="h-px flex-1 bg-zinc-100" />
                              <span className="text-[8px] font-black uppercase tracking-widest text-primary">
                                ou se preferir
                              </span>
                              <div className="h-px flex-1 bg-zinc-100" />
                            </div>

                            <button
                              onClick={() => {
                                haptic.light();
                                onNavigate("checkout");
                              }}
                              className="w-full rounded-2xl border border-zinc-100/50 py-3.5 text-[10px] font-black uppercase tracking-widest text-primary transition-colors hover:border-zinc-200 active:scale-95"
                            >
                              Continuar como Convidado
                            </button>
                          </div>
                        </div>

                        {/* Premium Subtle Glow Background */}
                        <div className="pointer-events-none absolute right-0 top-0 -mr-32 -mt-32 size-64 rounded-full bg-emerald-500/5 blur-3xl" />
                        <div className="pointer-events-none absolute bottom-0 left-0 -mb-16 -ml-16 size-32 rounded-full bg-secondary/10 blur-2xl" />
                      </div>
                    )}
                  </div>

                  {/* Coluna Direita: Resumo do Pedido (Desktop Only) */}
                  <div className="sticky top-24 hidden w-full shrink-0 space-y-6 rounded-[2.5rem] border border-zinc-100 bg-white p-6 shadow-[0_10px_40px_rgba(0,0,0,0.02)] lg:block lg:w-[380px]">
                    <div>
                      <h3 className="mb-1 text-lg font-black uppercase tracking-tight text-zinc-950">
                        Resumo do Pedido
                      </h3>
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                        {cartCount}{" "}
                        {cartCount > 1
                          ? "itens selecionados"
                          : "item selecionado"}
                      </p>
                    </div>

                    <div className="space-y-4 border-t border-zinc-50 pt-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold uppercase tracking-wider text-zinc-400">
                          Subtotal
                        </span>
                        <span className="font-black text-zinc-950">
                          {formatCurrency(subtotal)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold uppercase tracking-wider text-zinc-400">
                          Frete
                        </span>
                        <span
                          className={cn(
                            "font-black tracking-tight",
                            shipping === 0
                              ? "text-emerald-500"
                              : "text-zinc-950",
                          )}
                        >
                          {shipping === 0 ? "GRÁTIS" : formatCurrency(shipping)}
                        </span>
                      </div>

                      {shipping === 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold uppercase tracking-wider text-zinc-400">
                            Bônus
                          </span>
                          <span className="flex items-center gap-1 font-black uppercase tracking-tighter text-emerald-500">
                            <Sparkles className="size-3 fill-emerald-500/20" />
                            Frete Grátis
                          </span>
                        </div>
                      )}

                      {amountToFree > 0 && (
                        <div className="rounded-2xl border border-amber-100/50 bg-amber-50/50 p-3 text-[10px] font-medium leading-relaxed text-amber-800">
                          Adicione mais{" "}
                          <span className="font-black">
                            {formatCurrency(amountToFree)}
                          </span>{" "}
                          para garantir{" "}
                          <span className="font-black">Frete Grátis</span>!
                        </div>
                      )}
                    </div>

                    <div className="flex items-end justify-between border-t border-zinc-100 pt-4">
                      <div>
                        <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-zinc-400">
                          Total
                        </span>
                        <span className="text-2xl font-black tracking-tighter text-zinc-950">
                          {formatCurrency(total)}
                        </span>
                      </div>
                      {shipping === 0 && (
                        <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-emerald-700">
                          Economizou {formatCurrency(savings)}
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => {
                        haptic.medium();
                        onNavigate("checkout");
                      }}
                      className="group relative flex h-14 w-full items-center justify-between overflow-hidden rounded-2xl bg-primary px-6 text-white shadow-xl shadow-black/10 transition-all hover:bg-primary/90 active:scale-[0.98]"
                    >
                      <span className="relative z-10 text-[11px] font-black uppercase tracking-widest">
                        Finalizar Compra
                      </span>
                      <div className="relative z-10 flex size-8 items-center justify-center rounded-xl bg-white/10 transition-colors group-hover:bg-white/20">
                        <ArrowRight className="size-4 text-white transition-transform group-hover:translate-x-0.5" />
                      </div>
                      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/5 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
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
                    <div className="space-y-3 border-t border-zinc-50 pt-4">
                      <div className="flex items-center gap-3 text-zinc-500">
                        <ShieldCheck className="size-4 flex-shrink-0 text-emerald-500" />
                        <span className="text-[10px] font-semibold leading-tight tracking-tight">
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
              custom={tabDirection}
              variants={tabVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { ease: [0.16, 1, 0.3, 1], duration: 0.38 },
                opacity: { duration: 0.2 },
              }}
              className="flex w-full flex-1 flex-col px-6 pb-6 pt-0"
            >
              {orderViewMode === "guest" && (
                <OrderSearch
                  onNavigate={onNavigate}
                  onOrdersFound={(foundOrders) => {
                    setOrders(foundOrders);
                  }}
                />
              )}

              {orders.length > 0 && !isLoadingOrders && (
                <div className="relative mx-auto mb-6 flex w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200/20 bg-zinc-100/50 p-1">
                  <motion.div
                    className="absolute inset-y-1 rounded-xl border border-zinc-200/50 bg-white shadow-sm"
                    initial={false}
                    animate={{
                      left: ordersTab === "active" ? "4px" : "50%",
                      width: "calc(50% - 4px)",
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />

                  <button
                    onClick={() => {
                      haptic.light();
                      setOrdersTab("active");
                    }}
                    className={cn(
                      "flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
                      ordersTab === "active"
                        ? "text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-600",
                    )}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full transition-colors duration-300",
                          ordersTab === "active"
                            ? "bg-amber-500 animate-pulse"
                            : "bg-amber-400/60",
                        )}
                      />
                      Em Andamento ({activeOrdersCount})
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      haptic.light();
                      setOrdersTab("history");
                    }}
                    className={cn(
                      "flex-1 py-2.5 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
                      ordersTab === "history"
                        ? "text-zinc-950"
                        : "text-zinc-400 hover:text-zinc-600",
                    )}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full transition-colors duration-300",
                          ordersTab === "history"
                            ? "bg-emerald-500"
                            : "bg-zinc-300",
                        )}
                      />
                      Histórico ({historyOrdersCount})
                    </div>
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
                    <OrderList
                      orders={filteredOrders}
                      isLoadingOrders={isLoadingOrders}
                      onNavigate={onNavigate}
                      isGuest={!user}
                      emptyTitle={
                        orders.length > 0
                          ? ordersTab === "active"
                            ? "Sem pedidos ativos"
                            : "Histórico vazio"
                          : undefined
                      }
                      emptyDescription={
                        orders.length > 0
                          ? ordersTab === "active"
                            ? "Você não tem nenhum pedido em andamento no momento."
                            : "Você ainda não possui pedidos finalizados ou cancelados."
                          : undefined
                      }
                    />
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Spacer to prevent overlap by the sticky bottom actions */}
              <div
                style={{
                  height: "calc(80px + var(--safe-area-bottom, 0px))",
                }}
                aria-hidden="true"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {isActive &&
          isPresent &&
          activeTab === "cart" &&
          cart.length > 0 &&
          isSummaryReady && (
            <CartFooterSummary
              cartCount={cartCount}
              shipping={shipping}
              total={total}
              onNavigate={onNavigate}
            />
          )}
      </AnimatePresence>
    </div>
  );
}

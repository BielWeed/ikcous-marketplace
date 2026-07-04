import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, formatCurrency } from '@/lib/utils';
import { ShoppingCart, Package, Sparkles, ShieldCheck, Truck, RotateCcw, ArrowRight } from 'lucide-react';
import type { CartItem, View, Product, Order } from '@/types';
import { useStore } from '@/contexts/StoreContext';
import { useProducts } from '@/hooks/useProducts';
import { useOrders } from '@/hooks/useOrders';
import { useAuth } from '@/hooks/useAuth';
import { haptic } from '@/utils/haptic';

// Sub-components
import { CartItemsList } from '@/components/ui/custom/CartItemsList';
import { OrderSearch } from '@/components/ui/custom/OrderSearch';
import { OrderList } from '@/components/ui/custom/OrderList';
import { ShippingProgress } from '@/components/ui/custom/ShippingProgress';
import { CartFooterSummary } from '@/components/ui/custom/CartFooterSummary';
import { EmptyCart } from '@/components/ui/custom/EmptyCart';
import { useDeferredRender } from '@/hooks/useDeferredRender';

interface CartViewProps {
  cart: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onNavigate: (view: View, id?: string) => void;
  initialTab?: 'cart' | 'orders';
}

export function CartView({ cart, onUpdateQuantity, onRemove, onNavigate, onAddToCart, initialTab = 'cart' }: CartViewProps & { onAddToCart?: (product: Product, quantity?: number) => void }) {
  const { config } = useStore();
  const { getFreeShippingEligibleProducts } = useProducts();
  const { fetchUserOrders } = useOrders(true, false);
  const { user } = useAuth();
  const isReady = useDeferredRender(80);

  const [activeTab, setActiveTab] = useState<'cart' | 'orders'>(initialTab);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [orderViewMode, setOrderViewMode] = useState<'user' | 'guest'>(user ? 'user' : 'guest');

  useEffect(() => {
    if (!isReady) return;
    if (activeTab === 'orders') {
      if (user) {
        setIsLoadingOrders(true);
        fetchUserOrders().then(data => {
          setOrders(data || []);
          setIsLoadingOrders(false);
          setOrderViewMode('user');
        });
      } else {
        setOrderViewMode('guest');
        try {
          const cached = sessionStorage.getItem('guest_tracked_orders');
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setOrders(parsed);
            }
          }
        } catch (e) {
          console.error('Error loading guest orders from sessionStorage:', e);
        }
      }
    }
  }, [user, fetchUserOrders, activeTab, isReady]);

  useEffect(() => {
    const getScrollElement = () => document.querySelector('main');
    
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


  const subtotal = useMemo(() => cart.reduce((sum, item) => {
    if (!item?.product?.price) return sum;
    const price = item.variantId
        ? item.product.variants?.find(v => v.id === item.variantId)?.priceOverride || item.product.price
        : item.product.price;
    return sum + (price * (item.quantity || 0));
  }, 0), [cart]);

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + (item.quantity || 0), 0), [cart]);

  const hasFreeShippingItem = useMemo(() => cart.some(item => item?.product?.freeShipping), [cart]);

  const { progressPercent, amountToFree, shipping, total, savings, isNearlyThere } = useMemo(() => {
    if (cart.length === 0) return { progressPercent: 0, amountToFree: 0, shipping: 0, total: 0, savings: 0, isNearlyThere: false };
    
    if (hasFreeShippingItem) {
        return {
          progressPercent: 100,
          amountToFree: 0,
          shipping: 0,
          total: subtotal,
          savings: config.shippingFee || 0,
          isNearlyThere: false
        };
    }

    const isRuleActive = (config.freeShippingMin || 0) > 0;
    const progress = isRuleActive ? Math.min((subtotal / config.freeShippingMin) * 100, 100) : 0;
    const diff = isRuleActive ? Math.max(0, config.freeShippingMin - subtotal) : 0;
    const ship = (isRuleActive && subtotal >= config.freeShippingMin) ? 0 : (config.shippingFee || 0);
    const tot = subtotal + ship;
    const save = ship === 0 ? (config.shippingFee || 0) : 0;
    const nearly = Boolean(isRuleActive && progress >= 70 && progress < 100);

    return {
      progressPercent: isRuleActive ? progress : 0,
      amountToFree: diff,
      shipping: ship,
      total: tot,
      savings: save,
      isNearlyThere: nearly
    };
  }, [subtotal, config.shippingFee, config.freeShippingMin, hasFreeShippingItem, cart.length]);

  const freeShippingProducts = useMemo(() => {
    return getFreeShippingEligibleProducts(cart.filter(i => i?.product?.id).map(i => i.product.id));
  }, [cart, getFreeShippingEligibleProducts]);

  const handleClearCart = () => {
    if (globalThis.confirm('Deseja realmente limpar todo o carrinho?')) {
      onRemove('all');
      sessionStorage.clear();
      globalThis.location.reload();
    }
  };

  const handleRemove = (productId: string) => {
    setRemovingId(productId);
    setTimeout(() => {
      onRemove(productId);
      setRemovingId(null);
    }, 300);
  };
  return (
    <div className="bg-zinc-50/30 transition-all duration-300 flex flex-col min-h-full">
      {/* Tab Switcher Premium */}
      <div className="px-4 xs:px-6 pt-4 xs:pt-6 pb-3 xs:pb-4 bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-zinc-100 flex flex-col gap-2 xs:gap-4">

        <div className="flex p-1 bg-zinc-100/50 rounded-2xl relative overflow-hidden">
          <motion.div
            className="absolute top-1 bottom-1 bg-white rounded-xl shadow-sm border border-zinc-200/50"
            initial={false}
            animate={{
              left: activeTab === 'cart' ? '4px' : '50%',
              width: 'calc(50% - 4px)'
            }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
          />

          <button
            onClick={() => { haptic.light(); setActiveTab('cart'); }}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
              activeTab === 'cart' ? "text-zinc-950" : "text-zinc-400"
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <ShoppingCart className="w-4 h-4" />
              Carrinho ({cartCount})
            </div>
          </button>

          <button
            onClick={() => { haptic.light(); setActiveTab('orders'); }}
            className={cn(
              "flex-1 py-3 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest relative z-10 transition-colors duration-300",
              activeTab === 'orders' ? "text-zinc-950" : "text-zinc-400"
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <Package className="w-4 h-4" />
              Meus Pedidos
            </div>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {activeTab === 'cart' ? (
          <motion.div
            key="cart-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex-1 flex flex-col"
          >
            {cart.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyCart onNavigate={onNavigate} />
              </div>
            ) : (
              <div className="max-w-7xl mx-auto w-full px-4 xs:px-6 lg:px-8 py-6 flex flex-col lg:flex-row gap-8 items-stretch lg:items-start">
                {/* Coluna Esquerda: Itens, Frete Grátis e Checkout Convidado */}
                <div className="flex-1 w-full min-w-0 space-y-6">
                  <CartItemsList
                    cart={cart}
                    removingId={removingId}
                    onUpdateQuantity={onUpdateQuantity}
                    onRemove={handleRemove}
                    handleClearCart={handleClearCart}
                  />

                  {cart.length > 0 && (
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
                    <div className="p-8 bg-zinc-950 rounded-[3rem] shadow-2xl shadow-zinc-200 relative overflow-hidden group">
                      <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center rotate-3 group-hover:rotate-0 transition-transform">
                            <Sparkles className="w-5 h-5 text-zinc-950" />
                          </div>
                          <div>
                            <h3 className="text-white text-base font-black uppercase tracking-tight">
                              Checkout Rápido
                            </h3>
                            <p className="text-amber-400/80 text-[10px] uppercase font-black tracking-widest">
                              Como Convidado
                            </p>
                          </div>
                        </div>
                        
                        <p className="text-zinc-400 text-xs leading-relaxed font-medium mb-8 max-w-[240px]">
                          Finalize seu pedido agora mesmo sem precisar de cadastro.
                          <span className="text-zinc-100 block mt-1"> Simples, seguro e extremamente veloz.</span>
                        </p>

                        <div className="flex flex-col gap-4">
                          <button 
                            onClick={() => { haptic.medium(); onNavigate('auth' as any); }}
                            className="w-full bg-white text-zinc-950 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-zinc-100 transition-colors shadow-lg shadow-white/5 active:scale-95"
                          >
                            Entrar para Salvar Itens
                          </button>
                          <div className="flex items-center justify-center gap-2 py-1">
                            <div className="h-px flex-1 bg-zinc-800" />
                            <span className="text-zinc-600 text-[9px] uppercase font-bold tracking-widest">ou continue como</span>
                            <div className="h-px flex-1 bg-zinc-800" />
                          </div>
                          <button 
                             onClick={() => { haptic.light(); onNavigate('checkout'); }}
                             className="w-full py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest text-zinc-400 border border-zinc-800 hover:text-zinc-200 transition-colors"
                          >
                            Comprar como Convidado
                          </button>
                        </div>
                      </div>
                      
                      {/* Decorative elements */}
                      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-400/5 rounded-full blur-3xl -mr-32 -mt-32" />
                      <div className="absolute bottom-0 left-0 w-32 h-32 bg-zinc-400/5 rounded-full blur-2xl -ml-16 -mb-16" />
                    </div>
                  )}
                </div>

                {/* Coluna Direita: Resumo do Pedido (Desktop Only) */}
                <div className="hidden lg:block w-full lg:w-[380px] shrink-0 sticky top-24 bg-white border border-zinc-100 p-6 rounded-[2.5rem] shadow-[0_10px_40px_rgba(0,0,0,0.02)] space-y-6">
                  <div>
                    <h3 className="text-zinc-950 text-lg font-black uppercase tracking-tight mb-1">
                      Resumo do Pedido
                    </h3>
                    <p className="text-zinc-400 text-[10px] font-black uppercase tracking-widest">
                      {cartCount} {cartCount > 1 ? 'itens selecionados' : 'item selecionado'}
                    </p>
                  </div>

                  <div className="space-y-4 pt-2 border-t border-zinc-50">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-zinc-400 uppercase tracking-wider">Subtotal</span>
                      <span className="font-black text-zinc-950">{formatCurrency(subtotal)}</span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-zinc-400 uppercase tracking-wider">Frete</span>
                      <span className={cn(
                        "font-black tracking-tight",
                        shipping === 0 ? "text-emerald-500" : "text-zinc-950"
                      )}>
                        {shipping === 0 ? 'GRÁTIS' : formatCurrency(shipping)}
                      </span>
                    </div>

                    {shipping === 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-zinc-400 uppercase tracking-wider">Bônus</span>
                        <span className="font-black text-emerald-500 uppercase tracking-tighter flex items-center gap-1">
                          <Sparkles className="w-3 h-3 fill-emerald-500/20" />
                          Frete Grátis
                        </span>
                      </div>
                    )}

                    {amountToFree > 0 && (
                      <div className="p-3 bg-amber-50/50 border border-amber-100/50 rounded-2xl text-[10px] font-medium text-amber-800 leading-relaxed">
                        Adicione mais <span className="font-black">{formatCurrency(amountToFree)}</span> para garantir <span className="font-black">Frete Grátis</span>!
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-zinc-100 flex justify-between items-end">
                    <div>
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest block mb-1">Total</span>
                      <span className="text-2xl font-black tracking-tighter text-zinc-950">
                        {formatCurrency(total)}
                      </span>
                    </div>
                    {shipping === 0 && (
                      <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 border border-emerald-100 px-2 py-1 rounded-lg uppercase tracking-wider">
                        Economizou {formatCurrency(savings)}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => { haptic.medium(); onNavigate('checkout'); }}
                    className="w-full h-14 bg-zinc-950 hover:bg-zinc-800 text-white rounded-2xl flex items-center justify-between px-6 transition-all active:scale-[0.98] shadow-xl shadow-zinc-200 group relative overflow-hidden"
                  >
                    <span className="text-[11px] font-black uppercase tracking-widest relative z-10">Finalizar Compra</span>
                    <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center group-hover:bg-white/20 transition-colors relative z-10">
                      <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-0.5 transition-transform" />
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                  </button>

                  <div className="pt-4 border-t border-zinc-50 space-y-3">
                    <div className="flex items-center gap-3 text-zinc-500">
                      <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-[10px] font-semibold tracking-tight leading-tight">
                        Ambiente de pagamento 100% seguro
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500">
                      <Truck className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      <span className="text-[10px] font-semibold tracking-tight leading-tight">
                        Envio expresso e código de rastreio automático
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-zinc-500">
                      <RotateCcw className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                      <span className="text-[10px] font-semibold tracking-tight leading-tight">
                        Garantia de devolução fácil em até 7 dias
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Spacer to prevent overlap by the sticky bottom actions */}
            <div 
              className="lg:hidden"
              style={{
                height: cart.length > 0 
                  ? 'calc(180px + var(--safe-area-bottom, 0px))' 
                  : 'calc(80px + var(--safe-area-bottom, 0px))'
              }} 
              aria-hidden="true" 
            />
          </motion.div>
        ) : (
          <motion.div
            key="orders-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="pt-0 px-6 pb-6 flex-1 flex flex-col"
          >
            {orderViewMode === 'guest' && (
              <OrderSearch
                onNavigate={onNavigate}
                onOrdersFound={(foundOrders) => {
                  setOrders(foundOrders);
                }}
              />
            )}

            <OrderList
              orders={orders}
              isLoadingOrders={isLoadingOrders}
              onNavigate={onNavigate}
              isGuest={!user}
            />

            {/* Spacer to prevent overlap by the sticky bottom actions */}
            <div 
              style={{
                height: 'calc(80px + var(--safe-area-bottom, 0px))'
              }} 
              aria-hidden="true" 
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeTab === 'cart' && cart.length > 0 && isReady && (
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

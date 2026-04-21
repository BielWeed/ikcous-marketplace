import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ShoppingCart, Package, Sparkles } from 'lucide-react';
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

  const [activeTab, setActiveTab] = useState<'cart' | 'orders'>(initialTab);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [orderViewMode, setOrderViewMode] = useState<'user' | 'guest'>(user ? 'user' : 'guest');

  useEffect(() => {
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
      }
    }
  }, [user, fetchUserOrders, activeTab]);


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

  const freeShippingProducts = getFreeShippingEligibleProducts(cart.filter(i => i?.product?.id).map(i => i.product.id));

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
    <div className={cn(
      "bg-zinc-50/30 overflow-hidden transition-all duration-300 flex flex-col min-h-[calc(100dvh-140px)]",
      activeTab === 'cart' && cart.length > 0 ? "pb-[152px]" : "pb-20"
    )}>
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

      <AnimatePresence mode="wait">
        {activeTab === 'cart' ? (
          <motion.div
            key="cart-content"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex flex-col"
          >
            {!user && cart.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyCart onNavigate={onNavigate} />
              </div>
            ) : (
              <>
                <CartItemsList
                  cart={cart}
                  removingId={removingId}
                  onUpdateQuantity={onUpdateQuantity}
                  onRemove={handleRemove}
                  handleClearCart={handleClearCart}
                />

                {!user && cart.length > 0 && (
                  <div className="px-4 xs:px-6 pb-6">
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
                             onClick={() => { haptic.light(); }}
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
                  </div>
                )}

                {cart.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <EmptyCart onNavigate={onNavigate} />
                  </div>
                )}
              </>
            )}

            {cart.length > 0 && (
              <>
                {user && (
                  <ShippingProgress
                    shipping={shipping}
                    savings={savings}
                    progressPercent={progressPercent}
                    amountToFree={amountToFree}
                    isNearlyThere={isNearlyThere}
                    freeShippingProducts={freeShippingProducts}
                    onAddToCart={onAddToCart}
                  />
                )}

              </>
            )}
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
              />
            )}

            <OrderList
              orders={orders}
              isLoadingOrders={isLoadingOrders}
              onNavigate={onNavigate}
              isGuest={!user}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeTab === 'cart' && cart.length > 0 && (
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

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { haptic } from '@/utils/haptic';
import { QuantitySelector } from '@/components/ui/custom/QuantitySelector';
import { useStore } from '@/contexts/StoreContext';
import type { CartItem } from '@/types';

interface CartItemCardProps {
    item: CartItem;
    removingId: string | null;
    onUpdateQuantity: (productId: string, quantity: number) => void;
    onRemove: (productId: string) => void;
}

function CartItemCard({ item, removingId, onUpdateQuantity, onRemove }: Readonly<CartItemCardProps>) {
    // Removed unused config destructuring
    useStore();
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchOffset, setTouchOffset] = useState(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        setTouchStart(e.targetTouches[0].clientX);
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (touchStart === null) return;
        const currentTouch = e.targetTouches[0].clientX;
        const diff = touchStart - currentTouch;
        if (diff > 0) {
            setTouchOffset(Math.min(diff, 100));
        } else {
            setTouchOffset(0);
        }
    };

    const handleTouchEnd = () => {
        if (touchOffset > 80) {
            onRemove(item.product.id);
        }
        setTouchOffset(0);
        setTouchStart(null);
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="relative group overflow-hidden rounded-[2.5rem]"
        >
            <div className="absolute inset-0 bg-red-500 flex items-center justify-end px-8 text-white rounded-[2.5rem]">
                <div className="flex flex-col items-center gap-1 animate-pulse">
                    <Trash2 className="w-6 h-6" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Remover</span>
                </div>
            </div>

            <motion.div
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                animate={{ x: -touchOffset }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className={cn(
                    "flex gap-6 bg-white p-5 rounded-[2.5rem] border border-zinc-100/50 shadow-sm relative z-10",
                    removingId === item.product.id && "opacity-50"
                )}
            >
                <div className="w-28 h-28 flex-shrink-0 bg-zinc-50 rounded-[2rem] overflow-hidden border border-zinc-100/50 relative">
                    <img
                        src={item.product.images?.[0] || 'https://placehold.co/600x400?text=Sem+Imagem'}
                        alt={item.product.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                    />
                    {item.product.stock <= 3 && item.product.stock > 0 && (
                        <div className="absolute top-2 left-2 right-2">
                            <div className="bg-amber-500 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full flex items-center justify-center gap-1 shadow-lg shadow-amber-200/20 uppercase tracking-tighter">
                                Últimas {item.product.stock}
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                    <div>
                        <div className="flex items-start justify-between gap-2">
                            <div className="space-y-0.5">
                                <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">
                            {item.product.category}
                                </h3>
                                <h2 className="text-sm font-black text-zinc-900 line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                                    {item.product.name}
                                    {item.variantId && item.product.variants && (
                                        <span className="block text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
                                            Variação: {item.product.variants.find(v => v.id === item.variantId)?.name}
                                        </span>
                                    )}
                                </h2>
                            </div>
                            <button
                                onClick={() => { haptic.medium(); onRemove(item.product.id); }}
                                className="w-9 h-9 flex-shrink-0 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all active:scale-90"
                                aria-label="Remover item"
                            >
                                <Trash2 className="w-4.5 h-4.5" />
                            </button>
                        </div>


                    </div>

                    <div className="flex items-center justify-between mt-3">
                        <div className="flex flex-col">
                            <p className="text-xl font-black text-zinc-900 tracking-tighter leading-none">
{(() => {
    const variant = item.variantId ? item.product.variants?.find(v => v.id === item.variantId) : null;
    const price = variant?.priceOverride || item.product.price;
    return `R$ ${price.toFixed(2).replace('.', ',')}`;
})()}
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <QuantitySelector
                                quantity={item.quantity}
                                maxQuantity={item.product.stock}
                                onChange={(qty) => onUpdateQuantity(item.product.id, qty)}
                                size="sm"
                            />
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

interface CartItemsListProps {
    cart: CartItem[];
    removingId: string | null;
    onUpdateQuantity: (productId: string, quantity: number) => void;
    onRemove: (productId: string) => void;
    handleClearCart: () => void;
}

export function CartItemsList({ cart, removingId, onUpdateQuantity, onRemove, handleClearCart }: Readonly<CartItemsListProps>) {
    const cartCount = cart.reduce((sum, item) => sum + (item.quantity || 0), 0);

    return (
        <div className="pt-4">
            <div className="px-6 py-4 flex flex-col mb-2">
                <div className="flex items-center gap-3">
                    <div className="h-1 w-12 bg-zinc-900 rounded-full" />
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">
                        {cartCount} {cartCount === 1 ? 'Item Adicionado' : 'Itens Adicionados'}
                    </p>
                </div>
            </div>

            {cart.length > 50 && (
                <div className="mx-6 mb-6 p-4 bg-red-50 border border-red-200 rounded-[2rem] flex items-center justify-between">
                    <div>
                        <p className="text-red-800 font-bold text-sm">Instabilidade detectada</p>
                        <p className="text-red-600 text-[10px] uppercase font-black tracking-widest">O carrinho excedeu o limite seguro.</p>
                    </div>
                    <button
                        onClick={handleClearCart}
                        className="bg-black text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-colors"
                    >
                        Limpar Tudo
                    </button>
                </div>
            )}

            <div className="px-4 py-4 space-y-6 pb-6">
                <AnimatePresence mode="popLayout">
                    {cart.filter(item => item?.product?.id).map((item) => (
                        <CartItemCard
                            key={item.product.id}
                            item={item}
                            removingId={removingId}
                            onUpdateQuantity={onUpdateQuantity}
                            onRemove={onRemove}
                        />
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}

import { useCallback, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useCart } from '@/hooks/useCart';
import type { Order, Product, View } from '@/types';

export function useReorder() {
    const { addToCart } = useCart();
    const [isReordering, setIsReordering] = useState(false);

    const handleReorder = useCallback(async (order: Order, onNavigate: (path: View) => void) => {
        if (isReordering) return;

        try {
            setIsReordering(true);
            const productIds = order.items.map(item => item.productId).filter(Boolean);
            if (productIds.length === 0) return;

            // Security: limit exposed fields in select to avoid leaking internal data and validate active logic
            const { data: productsData, error } = await supabase
                .from('vw_produtos_public')
                .select('id, nome, descricao, preco_venda, imagem_url, categoria, estoque, ativo, data_cadastro, tags')
                .in('id', productIds);

            if (error) throw error;

            if (productsData) {
                let itemsAdded = 0;
                let itemsUnavailable = 0;

                order.items.forEach(item => {
                    const dbProduct = productsData.find(p => p.id === item.productId);

                    // Solo-Ninja Validation: product must exist, be ACTIVE, and have suffient STOCK
                    if (dbProduct && dbProduct.ativo && (dbProduct.estoque || 0) >= item.quantity) {
                        const mappedProduct: Product = {
                            id: dbProduct.id as string,
                            name: dbProduct.nome as string,
                            description: dbProduct.descricao || '',
                            price: (dbProduct.preco_venda || 0) as number,
                            images: dbProduct.imagem_url ? [dbProduct.imagem_url] : [],
                            category: dbProduct.categoria || '',
                            stock: (dbProduct.estoque || 0) as number,
                            sold: 0,
                            isActive: dbProduct.ativo || false,
                            isBestseller: false,
                            freeShipping: false,
                            createdAt: (dbProduct.data_cadastro || new Date().toISOString()) as string,
                            tags: dbProduct.tags || []
                        };
                        addToCart(mappedProduct, item.quantity, item.variantId);
                        itemsAdded++;
                    } else {
                        itemsUnavailable++;
                    }
                });

                if (itemsAdded > 0) {
                    if (itemsUnavailable > 0) {
                        toast.warning(`${itemsAdded} iten(s) readicionados. ${itemsUnavailable} indisponível/esgotado.`);
                    } else {
                        toast.success('Itens adicionados ao carrinho');
                    }
                    onNavigate('cart');
                } else {
                    toast.error('Nenhum item deste pedido está disponível no momento.');
                }
            }
        } catch (error) {
            console.error('Reorder error:', error);
            toast.error('Erro ao processar repetição do pedido');
        } finally {
            setIsReordering(false);
        }
    }, [addToCart, isReordering]);

    return { handleReorder, isReordering };
}

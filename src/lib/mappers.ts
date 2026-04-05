import type { Database } from '@/types/database.types';
import type { Product, ProductVariant, Order, OrderStatus, PaymentMethod, Address } from '@/types';

// ProductRow removed as it was unused following view-aware refactor
type VariantRow = Database['public']['Tables']['product_variants']['Row'];
type OrderRow = Database['public']['Tables']['marketplace_orders']['Row'];
type OrderItemRow = Database['public']['Tables']['marketplace_order_items']['Row'];

/**
 * Maps a database product row to the application Product interface
 */
export function mapProductFromDB(
    row: any // Accepts both raw DB row and View row
): Product {
    try {
        if (!row) throw new Error('Product row is null');

        // Support both Table (nome, preco_venda, etc) and View (name, price, etc)
        const name = row.nome || row.name || 'Produto sem nome';
        const price = Number(row.preco_venda || row.price) || 0;
        const description = row.descricao || row.description || '';
        const costPrice = Number(row.custo || row.cost_price) || 0;
        const stock = row.estoque !== undefined ? Number(row.estoque) : (row.stock !== undefined ? Number(row.stock) : 0);
        const images = row.imagem_urls || row.images || (row.imagem_url ? [row.imagem_url] : []);
        const category = row.categoria || row.category || 'Geral';
        const isActive = row.ativo ?? row.is_active ?? true;
        const freeShipping = !!(row.frete_gratis ?? row.free_shipping);
        const isBestseller = !!(row.is_bestseller ?? row.is_bestseller); // Same name usually

        return {
            id: row.id,
            name: (name === 'boobie goods' || name === 'Boobie Goods') ? 'Bobbie Goods' : name,
            description,
            price,
            costPrice,
            originalPrice: row.preco_original ? Number(row.preco_original) : undefined,
            images: (name?.includes('Aliança Luxo'))
                ? ['https://m.media-amazon.com/images/I/51-mYyA-zXL._AC_SL1000_.jpg']
                : (images && images.length > 0
                    ? images
                    : ['https://placehold.co/600x400?text=Sem+Imagem']),
            category,
            stock: (Array.isArray(row.product_variants) && row.product_variants.some((v: any) => v.active))
                ? row.product_variants.reduce((acc: number, v: any) => acc + (v.active ? (Number(v.stock_increment) || 0) : 0), 0)
                : stock,
            sold: Number(row.sold) || 0,
            isActive,
            isBestseller,
            freeShipping,
            createdAt: row.data_cadastro || row.created_at || '1970-01-01T00:00:00.000Z',
            rating: row.rating ? Number(row.rating) : 5,
            reviewCount: row.review_count ? Number(row.review_count) : 0,
            tags: Array.isArray(row.tags) ? row.tags : [],
            metaTitle: row.meta_title || undefined,
            metaDescription: row.meta_description || undefined,
            variants: Array.isArray(row.product_variants) ? row.product_variants.map(mapVariantFromDB) : []
        };
    } catch (err) {
        console.error('[Mapper] Critical error mapping product:', err, row);
        return {
            id: row?.id || 'error-' + Date.now(),
            name: 'Erro ao carregar',
            description: '',
            price: 0,
            costPrice: 0,
            images: ['https://placehold.co/600x400?text=Erro+de+Dados'],
            category: 'Erro',
            stock: 0,
            sold: 0,
            isActive: false,
            isBestseller: false,
            freeShipping: false,
            createdAt: '1970-01-01T00:00:00.000Z',
            rating: 0,
            reviewCount: 0,
            tags: [],
            variants: []
        };
    }
}

/**
 * Maps a database variant row to the application ProductVariant interface
 */
export function mapVariantFromDB(row: VariantRow): ProductVariant {
    return {
        id: row.id,
        productId: row.product_id,
        sku: row.sku || undefined,
        name: row.name || 'Padrão',
        value: row.value || '',
        stockIncrement: Number(row.stock_increment) || 0,
        priceOverride: row.price_override ? Number(row.price_override) : undefined,
        active: row.active ?? true
    };
}

/**
 * Maps a database order row to the application Order interface
 */
export function mapOrderFromDB(
    row: OrderRow & { items?: OrderItemRow[], address?: Address }
): Order {
    const customerData = (row.customer_data as any) || {};

    // Prioritize direct joined address, then snapshotted address, then root fields
    const addressSource = row.address || customerData.address || {};

    return {
        id: row.id,
        userId: row.user_id || undefined,
        customer: {
            ...customerData,
            name: row.customer_name || customerData?.name || 'Cliente',
            whatsapp: customerData?.whatsapp || '',
            address: addressSource.street || customerData.address_text || customerData.address || '',
            number: addressSource.number || customerData.number || '',
            neighborhood: addressSource.neighborhood || customerData.neighborhood || '',
            reference: addressSource.reference || customerData.reference || ''
        },
        items: row.items?.map(item => ({
            productId: item.product_id || '',
            variantId: (item as any).variant_id || item.variant_id || undefined,
            name: item.product_name || '',
            price: Number(item.price || 0),
            quantity: Number(item.quantity || 1),
            image: item.image_url || ''
        })) || [],
        total: Number(row.total ?? (row as any).total_amount ?? 0),
        subtotal: Number(row.subtotal || 0),
        shipping: Number(row.shipping || 0),
        discount: Number(row.discount || 0),
        paymentMethod: (row.payment_method as PaymentMethod) || 'cash',
        status: (row.status as OrderStatus) || 'pending',
        notes: row.notes || undefined,
        couponCode: row.coupon_code || undefined,
        trackingCode: row.tracking_code || undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

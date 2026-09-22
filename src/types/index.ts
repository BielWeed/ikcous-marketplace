// Tipos do IKCOUS Marketplace - V2
import type { BrandingAssets } from "@/lib/storeIdentity";

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  /**
   * Preco de custo. `null` e' a lojista limpando o campo de proposito
   * (ADMIN-050, #96) -- distinto de `undefined`, que significa "nao mexi".
   */
  costPrice?: number | null;
  originalPrice?: number | null;
  images: string[];
  category: string;
  stock: number;
  /**
   * Limiar de "estoque baixo" deste produto. Nulo significa "use o padrao do
   * projeto" (5), a mesma regra do KPI Estoque Baixo do painel. ZERO e' uma
   * escolha valida do lojista, nao ausencia — por isso `number | null`, e por
   * isso quem le usa `??`, nunca `||`.
   */
  estoqueMinimo?: number | null;
  sold: number;
  isActive: boolean;
  isBestseller: boolean;
  freeShipping: boolean;
  createdAt: string;
  updatedAt?: string;
  createdTime?: number;
  rating?: number;
  reviewCount?: number;
  tags?: string[];
  variants?: ProductVariant[];
  metaTitle?: string;
  metaDescription?: string;
  /** `null` = limpar o codigo; `undefined` = nao mexer. Ver [ADMIN-050, #96]. */
  sku?: string | null;
  /** Mesma convencao do sku acima: `null` = limpar o codigo de barras; `undefined` = nao mexer. */
  codigoBarras?: string | null;
  weightKg?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  lengthCm?: number | null;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku?: string;
  codigoBarras?: string;
  name: string;
  value: string;
  stockIncrement: number;
  stock?: number;
  priceOverride?: number;
  active: boolean;
  imageUrl?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  variantId?: string;
  variantNames?: string;
  /** Epoch ms of the last local mutation — used for offline merge conflict resolution */
  lastModifiedAt?: number;
}

export interface Customer {
  id?: string;
  name: string;
  whatsapp: string;
  cpf?: string;
  email?: string;
  address?: string; // Legacy support or single address string
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  reference?: string | null;
  total_spent?: number;
  order_count?: number;
  last_order?: string;
}

export interface UserProfile {
  name: string;
  whatsapp: string;
  email?: string;
  addresses: Address[];
  favoriteProducts: string[];
  orderHistory: string[];
  createdAt: string;
  role?: "admin" | "customer";
}

export interface Address {
  id: string;
  user_id: string;
  name: string; // Apelido do endereço
  recipient_name: string;
  cep: string;
  street: string;
  number: string;
  complement?: string | null;
  neighborhood: string;
  city: string;
  state: string;
  reference?: string | null;
  is_default: boolean | null;
}

export type OrderStatus =
  | "pending"
  | "processing"
  | "shipping"
  | "delivered"
  | "cancelled";
export type PaymentMethod = "pix" | "card" | "cash" | "online";

/**
 * Espelha a CHECK constraint marketplace_orders_payment_status_check, criada
 * na migration 20260807000000. Mudar aqui sem mudar lá (ou o contrário) é como
 * o pedido fica com estado que o banco recusa.
 */
export type PaymentStatus =
  | "aguardando"
  | "pago"
  | "recusado"
  | "expirado"
  | "estornado"
  | "pago_apos_expirar"
  | "recebido_na_entrega";

/**
 * De onde a venda veio. `online` é a loja (checkout); `presencial` é o balcão
 * (PDV). A coluna é `marketplace_orders.canal`, NOT NULL DEFAULT 'online'
 * (migration 20261160000000) — pedido antigo nenhum fica sem canal.
 */
export type CanalDaVenda = "online" | "presencial";

export interface OrderItem {
  productId: string;
  variantId?: string;
  name: string;
  price: number;
  quantity: number;
  image: string;
}

export interface Order {
  id: string;
  userId?: string;
  customer: Customer;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  status: OrderStatus;
  /**
   * Estado da cobrança online (webhook do Mercado Pago). Os 64 pedidos
   * históricos têm `NULL` na coluna, e o mapper é fiel a isso — `null`
   * significa "sem cobrança online", não é traduzido aqui. Ver
   * PaymentStatusBadge para a tradução de exibição.
   */
  paymentStatus?: PaymentStatus | null;
  notes?: string;
  couponCode?: string;
  createdAt: string;
  updatedAt: string;
  trackingCode?: string;
  /** true quando o pedido já estava enviado no momento do cancelamento. */
  cancelledAfterShipping: boolean;
  /** quando o lojista confirmou que o produto voltou. null = ainda não voltou. */
  returnedToSellerAt?: string | null;
  /** Quando a loja confirmou que recebeu o pagamento na entrega. NULL = não confirmado. */
  pagamentoRecebidoEm?: string | null;
  /** Qual admin confirmou o recebimento. */
  pagamentoRecebidoPor?: string | null;
  /**
   * De onde a venda veio. Opcional porque existe `Order` sem a chave em
   * RUNTIME: o cache de pedidos do cliente em localStorage gravado por versão
   * anterior do app é hidratado sem passar pelo mapper (useOrders). Regra para
   * todo consumidor: ramifique por `canal === "presencial"`, nunca por
   * `=== "online"` — ausente é online.
   */
  canal?: CanalDaVenda;
  /** Qual admin registrou a venda no balcão. NULL em venda online. */
  vendedorId?: string | null;
  /**
   * Retirada na loja (release 1.5.3): a cliente busca o pedido no endereço
   * físico da loja. Derivado do retrato `customer_data.pickup_address` que a
   * RPC v23/v24 grava SÓ para `store-pickup` — opcional pelo mesmo motivo do
   * `canal` (cache antigo hidratado sem o mapper): ausente = entrega.
   */
  retiradaNaLoja?: boolean;
  /** O endereço da loja no momento da compra (retrato, aparado). */
  enderecoDeRetirada?: string | null;
}

export interface Review {
  id: string;
  productId: string;
  userId?: string;
  customerName: string;
  customerAvatar?: string;
  rating: number;
  comment: string;
  images?: string[];
  verified: boolean;
  // Item 8 do laudo de 29/08: moderação REAL. Ausente = 'publicada'
  // (avaliações antigas e dublês de teste); 'pendente' só é visível ao
  // autor e ao admin (policy da 20261031000000).
  status?: "publicada" | "pendente";
  helpful: number;
  merchantReply?: string;
  createdAt: string;
}

export interface Coupon {
  id: string;
  code: string;
  type: "percentage" | "fixed";
  value: number;
  minPurchase?: number;
  usageLimit?: number;
  usageCount: number | null;
  validUntil?: string;
  active: boolean;
}

export interface Banner {
  id: string;
  imageUrl: string;
  title: string | null;
  link?: string;
  position: "home_top" | "home_middle" | "home_bottom";
  active: boolean;
  order: number | null;
  subtitle?: string;
  titleColor?: string;
  subtitleColor?: string;
  buttonText?: string;
  buttonBgColor?: string;
  buttonTextColor?: string;
  fontFamily?: string;
  overlayColor?: string;
  overlayOpacity?: number;
  badgeText?: string;
  templateType?: string;
  productId?: string;
  startDate?: string | null;
  endDate?: string | null;
  showTextOverlay?: boolean;
}

export interface StoreConfig {
  freeShippingMin: number;
  shippingFee: number;
  /** WhatsApp da loja. Vazio/`null` = a loja não configurou — o botão de contato some, nunca aponta para número inventado (20261033000000). */
  whatsappNumber: string | null;
  shareText: string;
  /** Expediente exibido na vitrine. Vazio/`null` = a loja não disse — o app omite, nunca inventa (laudo caça-bugs 30/08 + migration 20261033000000). */
  businessHours?: string | null;
  enableReviews: boolean;
  enableCoupons: boolean;
  logoUrl?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
  brandingAssets?: BrandingAssets | null;
  primaryColor?: string;
  themeMode?: "light" | "dark" | "glass";
  realTimeSalesAlerts?: boolean;
  pushMarketingEnabled?: boolean;
  minAppVersion?: string;
  /** Nome da loja exibido ao cliente. Ausente ou `null` = a loja não configurou. */
  storeName?: string | null;
  /** Cidade de onde a loja opera. Ausente ou `null` = não configurado; a tela omite o trecho. */
  storeCity?: string | null;
  /** UF de onde a loja opera. Ausente ou `null` = não configurado. */
  storeState?: string | null;
  /**
   * Endereço de texto que alimenta o mapa da página Sobre a Loja (20261167).
   * Ausente/`null` = a loja não disse — o mapa cai para o CEP de frete e
   * depois para cidade/UF, como antes da coluna existir.
   */
  storeAddress?: string | null;
  /**
   * Texto "Sobre a loja" exibido na página Sobre a Loja (peça 24), gravado
   * como HTML simples (parágrafos) pela tela do painel desde a migration
   * 20261167000000. A página pública sanitiza com DOMPurify no render;
   * ausente/`null` = o bloco não existe na tela — a tela omite, nunca
   * inventa.
   */
  storeDescription?: string | null;
  originCep?: string;
  shippingProvider?: "flat_fee" | "melhor_envio" | "frenet" | "superfrete";
  enabledShippingMethods?: string[];
  shippingCoverage?: "local" | "national";
  localDeliveryFee?: number;
  localCepRange?: string;
  homeSections?: {
    id: string;
    title: string;
    active: boolean;
    type?: "new_arrivals" | "offers" | "bestsellers" | "custom";
    maxItems?: number;
    productIds?: string[];
    isCustom?: boolean;
  }[];
}

export interface ShippingOption {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
  /**
   * Só na retirada na loja (id `store-pickup`, release 1.5.3): o endereço
   * físico REAL da loja (`store_config.store_address`, aparado) que a edge
   * calculate-shipping manda junto. A tela mostra "Retire em: …" com ele.
   */
  pickupAddress?: string;
}

export interface WaitlistItem {
  id: string;
  productId: string;
  customerName: string;
  whatsapp: string;
  notified: boolean;
  createdAt: string;
}

export type View =
  | "home"
  | "search"
  | "product"
  | "cart"
  | "checkout"
  | "favorites"
  | "profile"
  | "orders"
  | "order-details"
  | "recently-viewed"
  | "login"
  | "admin-login"
  | "auth"
  | "admin-dashboard"
  | "admin-products"
  | "admin-product-form"
  | "admin-orders"
  | "admin-pdv"
  | "admin-coupons"
  | "admin-coupon-form"
  | "admin-banners"
  | "admin-carousels"
  | "admin-shipping"
  | "admin-settings"
  | "admin-reviews"
  | "admin-qa"
  | "admin-customers"
  | "admin-user-detail"
  | "admin-push"
  | "admin-notifications"
  | "admin-whatsapp-config"
  | "admin-about-store"
  | "admin-sros"
  | "referral"
  | "account-settings"
  | "notifications"
  | "order-success"
  | "admin"
  | "product-detail"
  | "address-form"
  | "user-profile"
  | "about-store";

export type SortOption = "default" | "price-asc" | "price-desc" | "sold";

export interface DashboardSummary {
  today: {
    revenue: number;
    count: number;
    pending: number;
    revenueTrend?: number;
    countTrend?: number;
  };
  month: {
    revenue: number;
    count: number;
    pending?: number;
    revenueTrend?: number;
    countTrend?: number;
  };
  executive?: {
    revenue30d: number;
    orders30d: number;
    revenueTrend: number;
    ordersTrend: number;
    avgTicket: number;
    avgTicketTrend: number;
    activeCustomers: number;
    activeCustomersTrend: number;
  };
  averageTicket: number;
  revenueHistory: {
    date: string;
    full_date: string;
    revenue: number;
    orders?: number;
    profit?: number;
    cost_sold?: number;
  }[];
  topProducts: {
    product_id: string;
    name: string;
    quantity: number;
    total: number;
    image: string;
  }[];
  inventoryAlerts: number;
  inventory?: {
    totalCost: number;
    totalValue: number;
  };
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "order" | "system" | "promotion" | "delivery" | "aviso" | "sucesso";
  read: boolean;
  created_at: string;
  action_url?: string;
  order_id?: string;
}

export interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

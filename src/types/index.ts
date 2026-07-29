// Tipos do IKCOUS Marketplace - V2

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  costPrice?: number;
  originalPrice?: number | null;
  images: string[];
  category: string;
  stock: number;
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
  sku?: string;
  weightKg?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  lengthCm?: number | null;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku?: string;
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
export type PaymentMethod = "pix" | "card" | "cash";

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
  notes?: string;
  couponCode?: string;
  createdAt: string;
  updatedAt: string;
  trackingCode?: string;
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
  whatsappNumber: string;
  shareText: string;
  businessHours: string;
  enableReviews: boolean;
  enableCoupons: boolean;
  logoUrl?: string;
  primaryColor?: string;
  themeMode?: "light" | "dark" | "glass";
  realTimeSalesAlerts?: boolean;
  pushMarketingEnabled?: boolean;
  minAppVersion?: string;
  originCep?: string;
  shippingProvider?: "flat_fee" | "melhor_envio" | "frenet";
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
  | "compare"
  | "recently-viewed"
  | "login"
  | "admin-login"
  | "auth"
  | "admin-dashboard"
  | "admin-products"
  | "admin-product-form"
  | "admin-orders"
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
  | "admin-whatsapp-config"
  | "admin-sros"
  | "referral"
  | "account-settings"
  | "notifications"
  | "order-success"
  | "admin"
  | "product-detail"
  | "address-form"
  | "user-profile";

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

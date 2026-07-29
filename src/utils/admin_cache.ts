import { DataVault } from "@/lib/dataVault";
import { supabase } from "@/lib/supabase";

export interface Customer {
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  role: string;
  created_at: string;
  orders_count?: number;
  total_spent?: number;
  last_order_date?: string;
  avatar_url?: string;
  is_push_subscribed?: boolean;
}

export let cachedCustomersData: {
  customers: Customer[];
  total: number;
  stats: {
    total_customers: number;
    global_ltv: number;
    global_orders: number;
    new_customers_30d: number;
  };
} | null = null;

export function setCachedCustomersData(data: typeof cachedCustomersData) {
  cachedCustomersData = data;
}

export async function prefetchCustomersData() {
  if (cachedCustomersData && cachedCustomersData.customers.length > 0) {
    return;
  }
  try {
    const { data, error } = await (supabase.rpc as any)(
      "get_admin_customers_paged",
      {
        p_search: "",
        p_sort_field: "total_spent",
        p_sort_direction: "desc",
        p_page: 0,
        p_page_size: 10,
      },
    );
    if (!error && data) {
      cachedCustomersData = {
        customers: data.data || [],
        total: data.total_count || 0,
        stats: data.stats,
      };
    }
  } catch (e) {
    console.error("Prefetch customers failed:", e);
  }
}

// Memory caches for admin sub-sections (SWR support)
export let cachedCouponsData: any[] | null = null;
export let cachedReviewsData: any[] | null = null;
export let cachedReviewsStats: any = null;
export let cachedQuestionsData: any[] | null = null;
export let cachedQuestionsTotal = 0;
let bannersPrefetched = false;

export function setCachedCouponsData(data: any[] | null) {
  cachedCouponsData = data;
}

export function setCachedReviewsData(data: any[] | null, stats?: any) {
  cachedReviewsData = data;
  if (stats) cachedReviewsStats = stats;
}

export function setCachedQuestionsData(data: any[] | null, total = 0) {
  cachedQuestionsData = data;
  cachedQuestionsTotal = total;
}

// Prefetch for coupons
export async function prefetchCouponsData() {
  if (cachedCouponsData && cachedCouponsData.length > 0) {
    return;
  }
  try {
    const { data, error } = await supabase
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) {
      cachedCouponsData = data.map((c) => ({
        id: c.id,
        code: c.code,
        type: c.type,
        value: c.value,
        minPurchase: c.min_purchase ?? undefined,
        usageLimit: c.usage_limit ?? undefined,
        usageCount: c.usage_count || 0,
        validUntil: c.valid_until ?? undefined,
        active: c.active ?? true,
      }));
    }
  } catch (e) {
    console.error("Prefetch coupons failed:", e);
  }
}

// Prefetch for banners (integrating with DataVault offline storage)
export async function prefetchBannersData() {
  if (bannersPrefetched) {
    return;
  }
  try {
    const { data, error } = await supabase
      .from("banners")
      .select("*")
      .order("order", { ascending: true });

    if (!error && data) {
      bannersPrefetched = true;
      const mappedBanners = data
        .filter((b: any) => b.image_url || b.imagem_url)
        .map((b: any) => ({
          id: b.id,
          imageUrl: b.image_url || b.imagem_url,
          title: b.title || "",
          link: b.link || undefined,
          position: b.position,
          active: b.active ?? b.ativo ?? true,
          order: b.order || 0,
        }));

      const vault = await DataVault.init();
      await vault.replaceAll("banners", mappedBanners);
      await vault.setLastSync("banners");
    }
  } catch (e) {
    console.error("Prefetch banners failed:", e);
  }
}

// Prefetch for reviews
export async function prefetchReviewsData() {
  if (cachedReviewsData && cachedReviewsData.length > 0) {
    return;
  }
  try {
    // Fetch first page of reviews via standard pagination RPC
    const { data, error } = await (supabase.rpc as any)(
      "get_admin_reviews_paged",
      {
        p_search: "",
        p_rating: "all",
        p_page: 0,
        p_page_size: 20,
      },
    );

    if (!error && data) {
      const reviewsList = data.data || [];
      const totalCount = data.total_count || 0;
      const averageRating = Number(data.average_rating) || 0;
      const globalVerifiedCount = Number(data.total_verified) || 0;
      const globalRepliedCount = Number(data.total_replied) || 0;

      const formatted = reviewsList.map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        userId: item.user_id,
        customerName: item.user?.full_name || "Anônimo",
        productName: item.product?.nome || "Produto removido",
        rating: item.rating,
        comment: item.comment || "",
        verified: item.verified ?? false,
        helpful: item.helpful ?? 0,
        createdAt: item.created_at,
        merchantReply: item.merchant_reply,
      }));

      cachedReviewsData = formatted;
      cachedReviewsStats = {
        total: totalCount,
        averageRating,
        globalVerifiedCount,
        globalRepliedCount,
      };
    }
  } catch (e) {
    console.error("Prefetch reviews failed:", e);
  }
}

// Prefetch for Q&A questions
export async function prefetchQAData() {
  if (cachedQuestionsData && cachedQuestionsData.length > 0) {
    return;
  }
  try {
    // Fetch first page of pending questions via standard select
    const { data, error } = await supabase
      .from("questions" as any)
      .select(`
                *,
                user:public_profiles(full_name),
                product:produtos(nome, imagem_url),
                answers:answers(*)
            `)
      .order("created_at", { ascending: false })
      .range(0, 9); // Page 0, PageSize 10

    if (!error && data) {
      const formatted = data.map((item: any) => ({
        id: item.id,
        userId: item.user_id,
        productId: item.product_id,
        productName: item.product?.nome || "Produto Indisponível",
        productImage: item.product?.imagem_url || undefined,
        customerName: item.user?.full_name || "Usuário Anônimo",
        question: item.question,
        createdAt: item.created_at,
        isVerified: item.is_verified ?? false,
        answers: (item.answers || []).map((ans: any) => ({
          id: ans.id,
          questionId: ans.question_id,
          answer: ans.answer,
          createdAt: ans.created_at,
          role: ans.role || "user",
        })),
      }));

      cachedQuestionsData = formatted;

      // Get total count
      const { count } = await supabase
        .from("questions")
        .select("*", { count: "exact", head: true });

      cachedQuestionsTotal = count || 0;
    }
  } catch (e) {
    console.error("Prefetch Q&A failed:", e);
  }
}

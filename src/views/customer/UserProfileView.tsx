import { StarRating } from "@/components/ui/custom/StarRating";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase";
import type { View } from "@/types";
import { getPredefinedCoverSvg } from "@/utils/covers";
import { haptic } from "@/utils/haptic";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  Check,
  HelpCircle,
  Star,
  User,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

interface PublicProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string | null;
  cover_url: string | null;
}

interface ProductInfo {
  id: string;
  nome: string;
  imagem_url: string[] | string;
}

interface UserReview {
  id: string;
  product_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  verified: boolean | null;
  helpful: number | null;
  merchant_reply: string | null;
  product: ProductInfo | null;
}

interface UserQuestion {
  id: string;
  product_id: string;
  question: string;
  created_at: string;
  product: ProductInfo | null;
  answers: Array<{
    id: string;
    answer: string;
    created_at: string;
  }>;
}

interface UserProfileViewProps {
  userId: string;
  onNavigate: (view: View, id?: string) => void;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
    },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 15 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 260,
      damping: 24,
    },
  },
} as const;

export function UserProfileView({ userId, onNavigate }: UserProfileViewProps) {
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"reviews" | "questions">(
    "reviews",
  );

  const defaultCover = useMemo(
    () => getPredefinedCoverSvg("#4F46E5", "#06B6D4", "waves"),
    [],
  );

  useEffect(() => {
    if (!userId) return;

    const loadPublicProfileData = async () => {
      setLoading(true);
      try {
        // 1. Fetch public profile details
        const { data: profileData, error: profileError } = await supabase
          .from("public_profiles")
          .select("*")
          .eq("id", userId)
          .single();

        if (profileError) throw profileError;
        setProfile(profileData as PublicProfile);

        // 2. Fetch public reviews with product details
        const { data: reviewsData, error: reviewsError } = await supabase
          .from("reviews")
          .select("*, product:vw_produtos_public(id, nome, imagem_url)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (reviewsError) throw reviewsError;
        setReviews((reviewsData || []) as UserReview[]);

        // 3. Fetch public questions with product details and answers
        const { data: questionsData, error: questionsError } = await supabase
          .from("questions")
          .select(
            "*, product:vw_produtos_public(id, nome, imagem_url), answers:answers(*)",
          )
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (questionsError) throw questionsError;
        setQuestions((questionsData || []) as UserQuestion[]);
      } catch (err) {
        console.error("Error loading public profile data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadPublicProfileData();
  }, [userId]);

  const handleProductClick = (productId: string) => {
    haptic.light();
    onNavigate("product-detail", productId);
  };

  const formattedMemberSince = useMemo(() => {
    if (!profile?.created_at) return "";
    try {
      const date = new Date(profile.created_at);
      return `Membro desde ${format(date, "MMMM 'de' yyyy", { locale: ptBR })}`;
    } catch {
      return "";
    }
  }, [profile]);

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (
      parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  };

  const getProductImage = (product: ProductInfo | null) => {
    if (!product) return "https://placehold.co/600x400?text=Sem+Imagem";
    if (Array.isArray(product.imagem_url)) {
      return (
        product.imagem_url[0] || "https://placehold.co/600x400?text=Sem+Imagem"
      );
    }
    return product.imagem_url || "https://placehold.co/600x400?text=Sem+Imagem";
  };

  if (loading) {
    return (
      <div className="min-h-full bg-gradient-to-b from-white to-zinc-50/50 pb-customer">
        {/* Banner Skeleton */}
        <div className="relative h-44 w-full animate-pulse bg-zinc-100" />

        <div className="relative z-10 mx-auto -mt-12 max-w-md space-y-6 px-4">
          {/* Header Skeleton */}
          <div className="flex flex-col items-center">
            <Skeleton className="size-24 rounded-[28px] border-[6px] border-white bg-zinc-200 shadow-premium" />
            <Skeleton className="mt-4 h-7 w-48 rounded-lg" />
            <Skeleton className="mt-2 h-4 w-36 rounded-lg" />
          </div>

          {/* Stats Skeleton */}
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-16 rounded-2xl bg-zinc-100" />
            <Skeleton className="h-16 rounded-2xl bg-zinc-100" />
          </div>

          {/* Tabs Skeleton */}
          <div className="flex border-b border-zinc-100">
            <Skeleton className="h-10 w-1/2 rounded-t-lg" />
            <Skeleton className="h-10 w-1/2 rounded-t-lg" />
          </div>

          {/* Content List Skeleton */}
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <Skeleton
                key={i}
                className="h-32 w-full rounded-3xl bg-zinc-100"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center p-6 pb-customer text-center">
        <div className="mb-4 flex size-16 items-center justify-center rounded-3xl bg-red-50 text-red-500">
          <User className="size-8" />
        </div>
        <h3 className="text-lg font-bold text-zinc-900">
          Usuário não encontrado
        </h3>
        <p className="mt-1 max-w-xs text-sm leading-relaxed text-zinc-500">
          O perfil público solicitado não está disponível ou o usuário foi
          removido.
        </p>
        <button
          onClick={() => {
            haptic.light();
            onNavigate("home");
          }}
          className="mt-6 flex items-center gap-2 rounded-full border border-zinc-200 px-6 py-3 text-xs font-bold uppercase tracking-wider text-zinc-900 shadow-sm transition-all hover:bg-zinc-50 active:scale-95"
        >
          <ArrowLeft className="size-4" /> Voltar para o Início
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-white to-zinc-50/50 pb-customer">
      {/* Header Cover Banner */}
      <div className="group relative h-44 w-full overflow-hidden bg-zinc-100 shadow-inner">
        <img
          src={profile.cover_url || defaultCover}
          alt="Capa de Perfil"
          className="group-hover:scale-102 size-full object-cover transition-transform duration-700"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/10" />
      </div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="mx-auto max-w-md space-y-6 px-4"
      >
        {/* Avatar and Main Info - Overlapping Cover */}
        <motion.div
          variants={itemVariants}
          className="relative z-10 -mt-12 flex flex-col items-center justify-center pb-2"
        >
          <div className="hover:scale-102 mb-3 flex size-24 items-center justify-center overflow-hidden rounded-[28px] border-[6px] border-white bg-white shadow-premium transition-transform duration-300">
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name || "Avatar"}
                className="size-full object-cover duration-300 animate-in fade-in"
              />
            ) : (
              <div className="flex size-full select-none items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-xl font-bold text-zinc-700 duration-300 animate-in fade-in">
                {getInitials(profile.full_name || "")}
              </div>
            )}
          </div>

          <h1 className="flex items-center justify-center gap-1.5 text-2xl font-black leading-none tracking-tighter text-zinc-900">
            {profile.full_name || "Usuário do App"}
          </h1>

          {formattedMemberSince && (
            <div className="mt-2 flex items-center gap-1 rounded-full border border-zinc-200/20 bg-zinc-100/60 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              <Calendar className="size-3 text-zinc-400" />
              {formattedMemberSince}
            </div>
          )}
        </motion.div>

        {/* Profile Stats Grid */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-2 gap-3.5"
        >
          <div className="group flex flex-col items-center justify-center rounded-3xl border border-zinc-100 bg-white p-4 text-center shadow-sm transition-all duration-300 hover:shadow-md">
            <span className="text-2xl font-black leading-none tracking-tight text-zinc-950 transition-transform duration-300 group-hover:scale-110">
              {reviews.length}
            </span>
            <span className="mt-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
              Avaliações
            </span>
          </div>
          <div className="group flex flex-col items-center justify-center rounded-3xl border border-zinc-100 bg-white p-4 text-center shadow-sm transition-all duration-300 hover:shadow-md">
            <span className="text-2xl font-black leading-none tracking-tight text-zinc-950 transition-transform duration-300 group-hover:scale-110">
              {questions.length}
            </span>
            <span className="mt-1 text-[9px] font-black uppercase tracking-widest text-zinc-400">
              Perguntas
            </span>
          </div>
        </motion.div>

        {/* Activity Tabs */}
        <motion.div variants={itemVariants} className="space-y-4">
          {/* Tab Navigation */}
          <div className="relative flex border-b border-zinc-100">
            <button
              onClick={() => {
                haptic.light();
                setActiveTab("reviews");
              }}
              className={`relative flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-colors ${activeTab === "reviews" ? "text-zinc-950" : "text-zinc-400"}`}
            >
              Avaliações
              {activeTab === "reviews" && (
                <motion.div
                  layoutId="publicProfileActiveTabLine"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-950"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
            <button
              onClick={() => {
                haptic.light();
                setActiveTab("questions");
              }}
              className={`relative flex-1 pb-3 text-xs font-black uppercase tracking-wider transition-colors ${activeTab === "questions" ? "text-zinc-950" : "text-zinc-400"}`}
            >
              Perguntas
              {activeTab === "questions" && (
                <motion.div
                  layoutId="publicProfileActiveTabLine"
                  className="absolute inset-x-0 bottom-0 h-[2px] bg-zinc-950"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          </div>

          {/* Tab Contents */}
          <div className="min-h-[200px]">
            <AnimatePresence mode="wait">
              {activeTab === "reviews" ? (
                <motion.div
                  key="reviews-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  {reviews.length === 0 ? (
                    <div className="flex flex-col items-center rounded-3xl border border-zinc-100 bg-white px-6 py-12 text-center shadow-sm">
                      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl border border-zinc-200/50 bg-zinc-50 text-zinc-300">
                        <Star className="size-5" />
                      </div>
                      <p className="text-sm font-bold tracking-tight text-zinc-900">
                        Nenhuma avaliação
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Este usuário ainda não avaliou nenhum produto.
                      </p>
                    </div>
                  ) : (
                    reviews.map((rev) => (
                      <div
                        key={rev.id}
                        className="space-y-3.5 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm transition-all duration-300 hover:shadow-md"
                      >
                        {/* Product Header (Clickable) */}
                        {rev.product && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleProductClick(rev.product!.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleProductClick(rev.product!.id);
                              }
                            }}
                            className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-zinc-200/30 bg-zinc-50/60 p-2 transition-colors duration-200 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-900 active:scale-[0.99]"
                          >
                            <img
                              src={getProductImage(rev.product)}
                              alt={rev.product.nome}
                              className="size-10 rounded-xl border border-zinc-200/50 bg-white object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                Avaliou o produto
                              </p>
                              <p className="truncate text-xs font-bold tracking-tight text-zinc-800">
                                {rev.product.nome}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Review Body */}
                        <div className="space-y-1.5 pl-0.5">
                          <div className="flex items-center justify-between">
                            <StarRating
                              rating={rev.rating}
                              size={11}
                              readonly
                            />
                            <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-400">
                              {formatDistanceToNow(new Date(rev.created_at), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </span>
                          </div>

                          {rev.comment && (
                            <p className="text-xs font-medium leading-relaxed text-zinc-700">
                              {rev.comment}
                            </p>
                          )}

                          {rev.verified && (
                            <div className="mt-1 flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-600">
                              <Check className="size-2.5" />
                              Compra verificada
                            </div>
                          )}
                        </div>

                        {/* Merchant Reply */}
                        {rev.merchant_reply && (
                          <div className="relative rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3.5 pl-4 text-[11px]">
                            <div className="absolute inset-y-3.5 left-0 w-1 rounded-r-full bg-zinc-950" />
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className="text-[8px] font-black uppercase tracking-wider text-zinc-900">
                                Resposta da Loja
                              </span>
                              <span className="flex size-3 select-none items-center justify-center rounded-full bg-zinc-950 text-[6px] font-bold text-white">
                                ✓
                              </span>
                            </div>
                            <p className="font-medium italic text-zinc-600">
                              "{rev.merchant_reply}"
                            </p>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="questions-tab"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-4"
                >
                  {questions.length === 0 ? (
                    <div className="flex flex-col items-center rounded-3xl border border-zinc-100 bg-white px-6 py-12 text-center shadow-sm">
                      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl border border-zinc-200/50 bg-zinc-50 text-zinc-300">
                        <HelpCircle className="size-5" />
                      </div>
                      <p className="text-sm font-bold tracking-tight text-zinc-900">
                        Nenhuma pergunta
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Este usuário ainda não fez nenhuma pergunta sobre
                        produtos.
                      </p>
                    </div>
                  ) : (
                    questions.map((q) => (
                      <div
                        key={q.id}
                        className="space-y-3.5 rounded-3xl border border-zinc-100 bg-white p-4 shadow-sm transition-all duration-300 hover:shadow-md"
                      >
                        {/* Product Header (Clickable) */}
                        {q.product && (
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => handleProductClick(q.product!.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleProductClick(q.product!.id);
                              }
                            }}
                            className="flex cursor-pointer items-center gap-2.5 rounded-2xl border border-zinc-200/30 bg-zinc-50/60 p-2 transition-colors duration-200 hover:bg-zinc-50 focus:outline-none focus:ring-1 focus:ring-zinc-900 active:scale-[0.99]"
                          >
                            <img
                              src={getProductImage(q.product)}
                              alt={q.product.nome}
                              className="size-10 rounded-xl border border-zinc-200/50 bg-white object-cover"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                                Perguntou sobre o produto
                              </p>
                              <p className="truncate text-xs font-bold tracking-tight text-zinc-800">
                                {q.product.nome}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Question Text */}
                        <div className="space-y-1 pl-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                              Dúvida enviada
                            </span>
                            <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-400">
                              {formatDistanceToNow(new Date(q.created_at), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </span>
                          </div>
                          <p className="text-xs font-bold leading-relaxed text-zinc-900 md:text-sm">
                            {q.question}
                          </p>
                        </div>

                        {/* Answer List */}
                        {q.answers && q.answers.length > 0 && (
                          <div className="space-y-2 border-t border-zinc-100 pt-2">
                            {q.answers.map((ans) => (
                              <div
                                key={ans.id}
                                className="relative rounded-2xl border border-zinc-100 bg-zinc-50/80 p-3.5 pl-4 text-[11px]"
                              >
                                <div className="absolute inset-y-3.5 left-0 w-1 rounded-r-full bg-zinc-950" />
                                <div className="mb-1 flex items-center justify-between gap-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[8px] font-black uppercase tracking-wider text-zinc-900">
                                      Resposta da Equipe
                                    </span>
                                    <span className="flex size-3 select-none items-center justify-center rounded-full bg-zinc-950 text-[6px] font-bold text-white">
                                      ✓
                                    </span>
                                  </div>
                                  <span className="text-[8px] font-medium uppercase tracking-wider text-zinc-400">
                                    {formatDistanceToNow(
                                      new Date(ans.created_at),
                                      { addSuffix: true, locale: ptBR },
                                    )}
                                  </span>
                                </div>
                                <p className="pl-0.5 font-medium italic text-zinc-700">
                                  "{ans.answer}"
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

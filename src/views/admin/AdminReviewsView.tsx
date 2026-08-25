import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useStore } from "@/contexts/StoreContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useReviews } from "@/hooks/useReviews";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { getAvatarGradient } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, type Variants, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Clock,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  MessageCircle,
  MessageSquare,
  Package,
  Search,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Star,
  ThumbsUp,
  Trash2,
  User,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminReviewsViewProps {
  readonly onNavigate: (view: View) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 15,
    },
  },
};

// Sem avaliação nenhuma a taxa é INDEFINIDA, não zero e não cem — o "—" marca isso.
// Com avaliação, zero medido continua sendo "0%" (não vira "—").
function formatRate(
  count: number,
  total: number,
): { text: string; width: number } {
  if (total <= 0) return { text: "—", width: 0 };
  const percent = Math.round((count / total) * 100);
  return { text: `${percent}%`, width: percent };
}

export const AdminReviewsView = memo(function AdminReviewsView({
  active = true,
  onSetDirty,
}: AdminReviewsViewProps) {
  const {
    adminReviews,
    loading,
    getAllReviews,
    deleteReview,
    toggleVerified,
    addMerchantReply,
    subscribeToReviews,
  } = useReviews();
  const isOffline = useOnlineStatus();
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  const handleToggleReviews = async (checked: boolean) => {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    haptic.light();
    setIsUpdatingConfig(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue
      // em frente (ADMIN-010, #94).
      const salvou = await updateConfig({ enableReviews: checked });
      if (!salvou) return;
      toast.success(
        checked
          ? "Sistema de avaliações habilitado"
          : "Sistema de avaliações desabilitado",
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const [page, setPage] = useLocalStorage<number>("admin_reviews_page", 0);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [totalReviews, setTotalReviews] = useState(0);
  const pageSize = 10;

  const { ref: viewRef } = useScrollRestoration(
    "admin-reviews",
    active ?? false,
    adminReviews.length > 0,
  );

  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    "admin_reviews_search_query",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [ratingFilter, setRatingFilter] = useLocalStorage<number | "all">(
    "admin_reviews_rating_filter",
    "all",
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [averageRating, setAverageRating] = useState("0.0");
  const [globalVerifiedCount, setGlobalVerifiedCount] = useState(0);
  const [globalRepliedCount, setGlobalRepliedCount] = useState(0);
  // Globais de verdade (achado 5 + migration 20261002000000): média e total
  // que NÃO seguem o filtro — os cartões "Global/no total" leem daqui.
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalAvgRating, setGlobalAvgRating] = useState("0.0");
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_reviews_view_mode",
    "compact",
  );

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1);

  // Removed ref tracking for filter changes in favor of direct state resets

  const firstLoadRef = useRef(true);
  const reviewsLengthRef = useRef(adminReviews.length);

  useEffect(() => {
    reviewsLengthRef.current = adminReviews.length;
  }, [adminReviews.length]);

  const loadReviews = useCallback(
    async (pageToFetch: number, silent = false) => {
      try {
        const result = await getAllReviews(pageToFetch, pageSize, {
          rating: ratingFilter,
          search: searchQuery,
          silent,
        });
        if (result) {
          setTotalReviews(result.total);
          setAverageRating(result.averageRating?.toFixed(1) || "0.0");
          setGlobalVerifiedCount(result.globalVerifiedCount || 0);
          setGlobalRepliedCount(result.globalRepliedCount || 0);
          setGlobalTotal(result.globalTotal || 0);
          setGlobalAvgRating(
            result.globalAverageRating?.toFixed(1) || "0.0",
          );

          const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (pageToFetch > maxPage) {
            setPage(maxPage);
          }
        }
      } catch (err) {
        console.error("[AdminReviewsView] Failed to load reviews:", err);
      } finally {
        firstLoadRef.current = false;
      }
    },
    [getAllReviews, pageSize, ratingFilter, searchQuery, setPage],
  );

  useEffect(() => {
    if (!active) return;
    loadReviews(page, false);

    const unsubscribe = subscribeToReviews(() => {
      loadReviews(page, true);
    });

    return () => {
      unsubscribe();
    };
  }, [
    page,
    ratingFilter,
    searchQuery,
    active,
    loadReviews,
    refreshTrigger,
    subscribeToReviews,
  ]);

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando avaliações...", {
        icon: "⚡",
      });
      loadReviews(page);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, page, loadReviews]);

  // Comunicar estado dirty para o roteador global
  useEffect(() => {
    onSetDirty?.(replyText.trim().length > 0);
  }, [replyText, onSetDirty]);

  // Reset helper modals when tab becomes inactive to prevent focus traps
  useEffect(() => {
    if (!active) {
      setShowHelpModal(false);
      setConfirmDeleteId(null);
      setReplyingTo(null);
      setReplyText("");
      setIsSubmittingReply(false);
      onSetDirty?.(false);
    }
    return () => {
      onSetDirty?.(false);
    };
  }, [active, onSetDirty]);

  const totalPages = Math.ceil(totalReviews / pageSize);
  const avgRating = averageRating;

  // Global Dynamic metrics for display
  // Denominadores GLOBAIS (achado 5): as taxas usam o total sem filtro —
  // filtro vazio nunca mais fabrica "100%" de zero.
  const verifiedRate = formatRate(globalVerifiedCount, globalTotal);
  const responseRate = formatRate(globalRepliedCount, globalTotal);

  const handleDelete = async (id: string) => {
    if (isOffline) {
      haptic.error();
      toast.error("Você está offline", {
        description:
          "Não é possível excluir avaliações sem conexão com a internet.",
      });
      return;
    }
    haptic.medium();
    await deleteReview(id);
    haptic.success();
    setConfirmDeleteId(null);
    if (adminReviews.length === 1 && page > 0) {
      setPage((p) => p - 1);
    } else {
      triggerRefresh();
    }
  };

  const handleToggleVerified = async (
    reviewId: string,
    currentVerified: boolean,
  ) => {
    if (isOffline) {
      haptic.error();
      toast.error("Você está offline", {
        description:
          "Não é possível alterar a verificação de avaliações sem conexão.",
      });
      return;
    }
    haptic.light();
    try {
      await toggleVerified(reviewId, currentVerified);
      haptic.success();
      triggerRefresh();
    } catch (err) {
      haptic.error();
      console.error("Erro ao alternar verificação:", err);
      toast.error("Erro ao alternar status de verificação.");
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  const renderStars = (rating: number) => (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`size-4 transition-all duration-300 ${i <= rating ? "fill-admin-gold text-admin-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.4)]" : "text-zinc-800"}`}
        />
      ))}
    </div>
  );

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "media",
        label: "Média Global",
        icon: Star,
        iconClass: "text-admin-gold fill-admin-gold",
        iconBg: "bg-admin-gold/10 border-admin-gold/20",
        hoverBorder:
          "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)]",
        // Global de verdade (achado 5): a média do cartão "Média Global"
        // não segue o filtro — lê o campo global da RPC (20261002000000).
        value: globalAvgRating,
        accent: "text-admin-gold",
        content: (
          <div className="mt-2 flex items-center gap-1.5 animate-in fade-in">
            {renderStars(Math.round(Number(globalAvgRating) || 0))}
          </div>
        ),
        footer: "Satisfação dos compradores",
      },
      {
        id: "total",
        label: "Total Recebido",
        icon: MessageCircle,
        iconClass: "text-emerald-400",
        iconBg: "bg-emerald-500/10 border-emerald-500/20",
        hoverBorder:
          "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
        // Global de verdade (achado 5): "Total Recebido" é o total sem
        // filtro — o filtrado continua governando o paginador.
        value: globalTotal,
        accent: "text-emerald-400",
        content: (
          <div className="mt-3 flex items-center gap-1.5 animate-in fade-in">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Moderação Ativa
            </span>
          </div>
        ),
        footer: "Depoimentos coletados",
      },
      {
        id: "resposta",
        label: "Taxa de Resposta",
        icon: MessageSquare,
        iconClass: "text-sky-400",
        iconBg: "bg-sky-500/10 border-sky-500/20",
        hoverBorder:
          "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
        value: responseRate.text,
        accent: "text-sky-400",
        content: (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 animate-in fade-in">
            <div
              className="h-full rounded-full bg-sky-500 transition-all duration-500"
              style={{ width: `${responseRate.width}%` }}
            />
          </div>
        ),
        footer: `${globalRepliedCount} respondidas no total`,
      },
      {
        id: "verificada",
        label: "Compras Verificadas",
        icon: ShieldCheck,
        iconClass: "text-purple-400",
        iconBg: "bg-purple-500/10 border-purple-500/20",
        hoverBorder:
          "hover:border-purple-500/30 hover:shadow-[0_0_30px_rgba(168,85,247,0.05)]",
        value: verifiedRate.text,
        accent: "text-purple-400",
        content: (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 animate-in fade-in">
            <div
              className="bg-purple-550 h-full rounded-full transition-all duration-500"
              style={{ width: `${verifiedRate.width}%` }}
            />
          </div>
        ),
        footer: `${globalVerifiedCount} verificadas no total`,
      },
    ],
    [
      averageRating,
      totalReviews,
      responseRate,
      globalRepliedCount,
      verifiedRate,
      globalVerifiedCount,
    ],
  );

  const renderDetailedSkeleton = () => (
    <div className="grid gap-6">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse space-y-6 rounded-[2.5rem] border border-white/[0.05] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-6 lg:p-8"
        >
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
            <div className="flex items-center gap-5">
              <Skeleton className="size-16 animate-pulse rounded-2xl bg-white/5" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32 animate-pulse bg-white/5" />
                <Skeleton className="h-3 w-48 animate-pulse bg-white/5" />
              </div>
            </div>
            <Skeleton className="h-10 w-24 animate-pulse rounded-2xl bg-white/5" />
          </div>
          <div className="space-y-2 border-l border-white/10 pl-6 lg:pl-10">
            <Skeleton className="h-4 w-full animate-pulse bg-white/5" />
            <Skeleton className="h-4 w-5/6 animate-pulse bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );

  const renderCompactSkeleton = () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div
          key={i}
          className="flex h-48 animate-pulse flex-col justify-between rounded-[2rem] border border-white/[0.05] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-5"
        >
          <div>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 animate-pulse rounded-xl bg-white/5" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-20 animate-pulse bg-white/5" />
                  <Skeleton className="h-2 w-12 animate-pulse bg-white/5" />
                </div>
              </div>
              <Skeleton className="h-6 w-10 animate-pulse rounded-lg bg-white/5" />
            </div>
            <Skeleton className="mb-4 h-3 w-24 animate-pulse rounded-full bg-white/5" />
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-full animate-pulse bg-white/5" />
              <Skeleton className="h-3 w-5/6 animate-pulse bg-white/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={viewRef}
      className="h-auto bg-[#09090b] pb-admin lg:pb-12 font-sans text-zinc-400 duration-200 animate-in fade-in selection:bg-admin-gold/30 selection:text-white"
    >
      {/* Header / Stats Overlay */}
      <div className="sticky top-0 z-50 bg-[#09090b]/80 p-2 pb-0 backdrop-blur-md sm:p-4">
        <div className="admin-glass rounded-2xl border border-white/5 p-3 shadow-2xl sm:rounded-[2rem] sm:p-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            {/* Title & Stats */}
            <div className="flex w-full items-center justify-between gap-3 lg:w-auto lg:justify-start">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-white sm:text-xl md:text-2xl">
                    <span className="flex flex-nowrap items-baseline whitespace-nowrap">
                      <span className="italic text-white">Ava</span>
                      <span className="not-italic text-admin-gold">
                        liações
                      </span>
                    </span>
                  </h1>
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                    title="Guia de Avaliações e Ajuda"
                  >
                    <HelpCircle className="size-3 text-zinc-500 hover:text-white" />
                  </button>
                </div>
              </div>

              {/* Compact Stats Badges */}
              <div className="flex items-center gap-1.5">
                <div
                  className="shrink-0 rounded-lg border border-admin-gold/20 bg-admin-gold/10 px-2 py-0.5"
                  title="Total de avaliações"
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-admin-gold sm:text-[10px]">
                    {totalReviews}
                  </p>
                </div>
                <div
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5"
                  title="Média global de estrelas"
                >
                  <Star className="size-3 fill-admin-gold text-admin-gold" />
                  <span className="text-[9px] font-black tracking-widest text-white sm:text-[10px]">
                    {avgRating}
                  </span>
                  <span className="hidden text-[8px] font-bold text-zinc-500 sm:inline">
                    MÉDIA
                  </span>
                </div>
              </div>
            </div>

            {/* Search & Main Filter */}
            <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:w-auto lg:max-w-2xl lg:flex-1 lg:justify-end">
              <div className="group relative min-w-0 flex-1">
                <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
                  {loading || isTyping ? (
                    <Loader2 className="size-3.5 animate-spin text-admin-gold" />
                  ) : (
                    <Search className="size-3.5 text-zinc-500 transition-colors group-focus-within:text-admin-gold" />
                  )}
                </div>
                <label htmlFor="reviews-search" className="sr-only">
                  Buscar avaliações
                </label>
                <DebouncedSearchInput
                  id="reviews-search"
                  name="search"
                  placeholder="Buscar por cliente ou produto..."
                  className="w-full rounded-xl border border-zinc-800 bg-black/40 py-2 pl-9 pr-3 text-xs font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:bg-zinc-950/60 focus:outline-none focus:ring-2 focus:ring-admin-gold/20"
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    setPage(0);
                  }}
                  onTyping={setIsTyping}
                  delay={300}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-black/40 p-0.5">
                  <button
                    onClick={() => {
                      setRatingFilter("all");
                      setPage(0);
                    }}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                      ratingFilter === "all"
                        ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/20"
                        : "text-zinc-500 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    Todas
                  </button>
                  {[5, 4, 3, 2, 1].map((star) => (
                    <button
                      key={star}
                      onClick={() => {
                        setRatingFilter(star);
                        setPage(0);
                      }}
                      className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                        ratingFilter === star
                          ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/20"
                          : "text-zinc-500 hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {star}{" "}
                      <Star
                        className={`size-3 ${ratingFilter === star ? "fill-black text-black" : "fill-zinc-700 text-zinc-700"}`}
                      />
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setViewMode((prev) =>
                      prev === "detailed" ? "compact" : "detailed",
                    )
                  }
                  className="group flex size-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-black/40 shadow-lg transition-all hover:border-admin-gold/50 hover:bg-zinc-900 active:scale-95 sm:size-9"
                  title={
                    viewMode === "detailed"
                      ? "Visualização Compacta"
                      : "Visualização Detalhada"
                  }
                >
                  {viewMode === "detailed" ? (
                    <LayoutGrid className="size-3.5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  ) : (
                    <List className="size-3.5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Dashboard Section */}
      <div className="mx-auto mt-6 max-w-7xl space-y-4 px-4">
        <AdminKpiCarousel
          cards={kpiCards}
          loading={loading || firstLoadRef.current}
          active={active}
          title="Métricas de Avaliações"
        />
      </div>

      <div className="mx-auto max-w-7xl p-4 lg:p-8">
        {configLoaded && (
          <div className="mb-6">
            <div
              className={`flex flex-col rounded-2xl border p-4 transition-all duration-300 ${
                config.enableReviews
                  ? "border-blue-500/20 bg-blue-500/5 shadow-[0_0_15px_rgba(59,130,246,0.05)]"
                  : "border-white/5 bg-zinc-950/40 hover:border-white/10"
              }`}
            >
              {/* Main Compact Row */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 ${
                      config.enableReviews
                        ? "border-blue-500/30 bg-blue-500/10 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.15)]"
                        : "border-white/5 bg-zinc-900/60 text-zinc-500"
                    }`}
                  >
                    <MessageSquare className="size-4.5" />
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor="enable-reviews-switch"
                        className="cursor-pointer text-[12px] font-bold text-white"
                      >
                        Avaliações dos Clientes
                      </Label>
                      <span
                        className={`inline-block size-1.5 rounded-full ${config.enableReviews ? "animate-pulse bg-emerald-500" : "bg-zinc-600"}`}
                      />
                      <span className="text-[9px] font-semibold tracking-wider text-zinc-500 uppercase">
                        {config.enableReviews ? "Ativo" : "Inativo"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <p className="text-[11px] text-zinc-400 leading-none">
                        Exibir notas e comentários nas páginas dos produtos.
                      </p>
                      <button
                        type="button"
                        onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                        className="flex items-center gap-0.5 text-[11px] font-medium text-blue-400 hover:text-blue-300 transition-colors leading-none"
                      >
                        Saiba mais
                        {isDetailsExpanded ? (
                          <ChevronUp className="size-3.5" />
                        ) : (
                          <ChevronDown className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="pl-1.5">
                  <Switch
                    id="enable-reviews-switch"
                    checked={config.enableReviews}
                    onCheckedChange={handleToggleReviews}
                    className="scale-90 data-[state=checked]:bg-blue-500"
                    disabled={isOffline || isUpdatingConfig}
                  />
                </div>
              </div>

              {/* Collapsible Humanized Explanatory Details */}
              <AnimatePresence initial={false}>
                {isDetailsExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pt-3 border-t border-white/5 text-[11px] leading-relaxed text-zinc-500 text-left space-y-1.5">
                      <p>
                        Ativando esta opção, seus clientes poderão dar notas de
                        1 a 5 estrelas e escrever depoimentos sobre os produtos
                        comprados.
                      </p>
                      <p>
                        Isso ajuda a construir{" "}
                        <strong>confiança para novos compradores</strong>, tira
                        dúvidas frequentes e pode aumentar significativamente
                        suas vendas!
                      </p>
                      <p>
                        Aqui no painel administrativo você terá total controle
                        para ler, responder e decidir quais avaliações serão
                        publicadas na sua loja.
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {(loading || firstLoadRef.current) && adminReviews.length === 0 ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-12"
            >
              {viewMode === "detailed"
                ? renderDetailedSkeleton()
                : renderCompactSkeleton()}
            </motion.div>
          ) : adminReviews.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative flex flex-col items-center justify-center overflow-hidden rounded-[3rem] border border-white/5 bg-zinc-950/40 py-24 backdrop-blur-3xl"
            >
              <div className="bg-radial-gradient pointer-events-none absolute inset-0 from-admin-gold/5 via-transparent to-transparent" />
              <div className="group relative mb-8 flex size-24 items-center justify-center rounded-3xl border border-white/5 bg-zinc-900/60">
                <Star className="size-12 text-zinc-700 transition-all duration-500 group-hover:rotate-12 group-hover:text-admin-gold" />
                <div className="absolute inset-0 rounded-full bg-admin-gold/20 opacity-50 blur-2xl" />
                <Sparkles className="absolute -right-2 -top-2 size-5 animate-bounce text-admin-gold" />
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight text-white">
                Sem Feedback Ainda
              </h3>
              <p className="mt-2 max-w-xs text-center text-sm font-medium leading-relaxed text-zinc-500">
                As avaliações e depoimentos de satisfação dos seus clientes
                aparecerão aqui assim que começarem a chegar.
              </p>
            </motion.div>
          ) : viewMode === "detailed" ? (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 gap-6"
            >
              {adminReviews.map((review) => (
                <motion.div
                  key={review.id}
                  variants={itemVariants}
                  layout
                  className="group relative"
                >
                  <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-r from-admin-gold/10 via-transparent to-emerald-500/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="content-visibility-auto relative overflow-hidden rounded-[2.5rem] border border-white/[0.05] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-6 shadow-2xl backdrop-blur-3xl transition-all duration-500 hover:border-white/10 hover:bg-white/[0.02] lg:p-8">
                    {/* Review Header */}
                    <div className="mb-8 flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
                      <div className="flex items-center gap-5">
                        <div className="relative">
                          <div
                            className={`size-16 rounded-2xl bg-gradient-to-br ${getAvatarGradient(review.customerName)} flex transform items-center justify-center border border-white/10 text-2xl font-black text-white shadow-2xl ring-4 ring-white/5 transition-transform duration-300 group-hover:scale-105`}
                          >
                            {review.customerName.charAt(0).toUpperCase()}
                          </div>
                          <div className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-lg border-2 border-zinc-950 bg-admin-gold shadow-lg shadow-admin-gold/20">
                            <User className="size-3.5 text-black" />
                          </div>
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2.5">
                            <p className="text-lg font-black uppercase tracking-tight text-white">
                              {review.customerName}
                            </p>
                            {review.verified && (
                              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.15em] text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                <ShieldCheck className="size-3.5" />
                                Compra Verificada
                              </div>
                            )}
                          </div>
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                              Produto:
                            </span>
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-zinc-900 px-3 py-1 text-xs font-black text-admin-gold transition-colors group-hover:border-admin-gold/30">
                              <Package className="size-3.5 text-admin-gold" />
                              {review.productName}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="hidden text-right sm:block">
                          <p className="text-[10px] font-black uppercase leading-none tracking-widest text-zinc-600">
                            Data da Postagem
                          </p>
                          <p className="mt-2 flex items-center justify-end gap-1.5 text-sm font-bold tracking-tighter text-zinc-400">
                            <Clock className="size-3.5 text-zinc-500" />
                            {formatDate(review.createdAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 rounded-3xl border border-white/5 bg-zinc-900/60 p-4 ring-1 ring-white/5 backdrop-blur-xl">
                          {renderStars(review.rating)}
                          {review.helpful > 0 && (
                            <>
                              <div className="h-4 w-px bg-zinc-800" />
                              <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1">
                                <ThumbsUp className="size-3 fill-emerald-400/20 text-emerald-400" />
                                <span className="text-[10px] font-bold tracking-tighter text-white">
                                  {review.helpful}
                                </span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Content Area */}
                    <div className="relative mb-8 border-l border-white/10 pl-6 transition-colors group-hover:border-admin-gold/30 lg:pl-10">
                      <div className="pointer-events-none absolute -left-3 -top-2 select-none font-serif text-6xl leading-none text-white/[0.03] transition-colors group-hover:text-admin-gold/10">
                        "
                      </div>
                      <p className="text-lg font-medium leading-relaxed tracking-tight text-zinc-200 lg:pr-12">
                        {review.comment}
                      </p>
                    </div>

                    {/* Merchant Reply Area */}
                    {review.merchantReply && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="group/reply relative mb-8 overflow-hidden rounded-[2rem] border border-admin-gold/10 bg-admin-gold/[0.02] p-6 shadow-inner lg:p-8"
                      >
                        <div className="absolute right-0 top-0 p-8 opacity-5 transition-opacity group-hover/reply:opacity-10">
                          <MessageSquare className="size-16 text-admin-gold" />
                        </div>
                        <div className="mb-4 flex items-center gap-3">
                          <div className="flex size-8 items-center justify-center rounded-xl bg-admin-gold shadow-lg shadow-admin-gold/20">
                            <MessageSquare className="size-4 text-black" />
                          </div>
                          <span className="text-[10px] font-black uppercase italic tracking-[0.2em] text-white">
                            Resposta Oficial da Loja
                          </span>
                        </div>
                        <p className="relative z-10 text-sm font-medium italic leading-relaxed text-admin-gold/80 lg:pr-12">
                          "{review.merchantReply}"
                        </p>
                      </motion.div>
                    )}

                    {/* Action Bar */}
                    <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-6">
                      <button
                        onClick={() => {
                          handleToggleVerified(review.id, review.verified);
                        }}
                        className={`flex items-center gap-2 rounded-2xl px-5 py-3 text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${
                          review.verified
                            ? "border border-white/5 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                            : "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:scale-[1.02]"
                        }`}
                      >
                        {review.verified ? (
                          <ShieldOff className="size-3.5" />
                        ) : (
                          <ShieldCheck className="size-3.5" />
                        )}
                        {review.verified
                          ? "Remover Verificação"
                          : "Verificar Compra"}
                      </button>

                      {!review.merchantReply && (
                        <button
                          disabled={isOffline}
                          onClick={() => {
                            setReplyingTo(review.id);
                            setReplyText("");
                          }}
                          className="flex items-center gap-2 rounded-2xl bg-admin-gold px-6 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl shadow-admin-gold/10 transition-all hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                        >
                          <MessageSquare className="size-3.5" /> Responder
                        </button>
                      )}

                      <div className="flex-1" />

                      {confirmDeleteId === review.id ? (
                        <div className="flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-2 duration-300 animate-in slide-in-from-right-4">
                          <span className="px-3 text-[9px] font-black uppercase tracking-widest text-red-400">
                            Confirmar exclusão?
                          </span>
                          <button
                            onClick={() => handleDelete(review.id)}
                            className="rounded-xl bg-red-600 px-5 py-2.5 font-sans text-[10px] font-black uppercase tracking-widest text-white shadow-lg shadow-red-600/20 transition-all hover:bg-red-500"
                          >
                            Sim, Apagar
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-xl bg-white/5 px-5 py-2.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:bg-white/10"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(review.id)}
                          className="flex size-12 items-center justify-center rounded-2xl border border-red-500/10 bg-red-500/10 text-red-400 transition-all duration-300 hover:bg-red-500 hover:text-white active:scale-95"
                          title="Excluir Avaliação"
                        >
                          <Trash2 className="size-5" />
                        </button>
                      )}
                    </div>

                    {/* Inline Reply Form */}
                    <AnimatePresence>
                      {replyingTo === review.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0, marginTop: 0 }}
                          animate={{
                            opacity: 1,
                            height: "auto",
                            marginTop: 24,
                          }}
                          exit={{ opacity: 0, height: 0, marginTop: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="space-y-6 rounded-[2.5rem] border border-white/5 bg-zinc-950/60 p-8 shadow-2xl ring-1 ring-white/5">
                            <div className="flex items-center gap-3">
                              <div className="flex size-8 items-center justify-center rounded-full bg-admin-gold/10">
                                <MessageSquare className="size-4 text-admin-gold" />
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white">
                                Formulário de Resposta
                              </span>
                            </div>

                            {/* Suggested Responses */}
                            <div className="space-y-2.5">
                              <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                Sugestões de Resposta Rápida:
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {[
                                  {
                                    label: "👍 Agradecer Feedback",
                                    text: "Muito obrigado pela sua avaliação! Feedbacks como o seu nos motivam a continuar oferecendo a melhor qualidade.",
                                  },
                                  {
                                    label: "🛠️ Dar Suporte",
                                    text: "Olá! Lamentamos muito que sua experiência não tenha sido ideal. Já estamos cientes do seu relato e entraremos em contato via WhatsApp para resolver isso o quanto antes.",
                                  },
                                  {
                                    label: "✨ Feedback Positivo",
                                    text: "Que excelente notícia! Ficamos muito satisfeitos em saber que o produto atendeu suas expectativas. Conte sempre conosco!",
                                  },
                                  {
                                    label: "📝 Esclarecer Produto",
                                    text: "Agradecemos o seu comentário. Gostaríamos de ressaltar que as instruções de uso estão no manual do produto. Qualquer dúvida adicional, estamos à disposição no suporte.",
                                  },
                                ].map((suggestion, idx) => (
                                  <button
                                    key={idx}
                                    type="button"
                                    onClick={() =>
                                      setReplyText(suggestion.text)
                                    }
                                    disabled={isOffline || isSubmittingReply}
                                    className="rounded-xl border border-white/5 bg-white/5 px-3.5 py-2 text-xs font-bold text-zinc-300 transition-all hover:border-admin-gold/30 hover:bg-admin-gold/15 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                                  >
                                    {suggestion.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            <textarea
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder={
                                isOffline
                                  ? "Você está offline. Não é possível responder no momento."
                                  : "Escreva uma resposta atenciosa para este cliente..."
                              }
                              className="min-h-[160px] w-full resize-none rounded-3xl border border-white/10 bg-black/40 p-6 text-base font-medium text-white transition-all placeholder:text-zinc-700 focus:border-admin-gold/30 focus:outline-none focus:ring-2 focus:ring-admin-gold/20 disabled:opacity-40"
                              disabled={isSubmittingReply || isOffline}
                            />
                            {isOffline && (
                              <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
                                <AlertCircle className="size-4 shrink-0 animate-pulse" />
                                <span className="text-[10px] font-black uppercase tracking-wider">
                                  Modo Offline Ativo
                                </span>
                              </div>
                            )}
                            <div className="flex items-center justify-end gap-4">
                              <button
                                onClick={() => setReplyingTo(null)}
                                className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 transition-colors hover:text-white"
                                disabled={isSubmittingReply}
                              >
                                Cancelar
                              </button>
                              <button
                                onClick={async () => {
                                  if (isOffline) {
                                    haptic.error();
                                    toast.error("Você está offline", {
                                      description:
                                        "Não é possível responder avaliações sem conexão.",
                                    });
                                    return;
                                  }
                                  if (!replyText.trim()) return;
                                  haptic.light();
                                  setIsSubmittingReply(true);
                                  const success = await addMerchantReply(
                                    review.id,
                                    replyText,
                                  );
                                  setIsSubmittingReply(false);
                                  if (success) {
                                    haptic.success();
                                    setReplyingTo(null);
                                    setReplyText("");
                                    getAllReviews(page, pageSize, {
                                      rating: ratingFilter,
                                      search: searchQuery,
                                    });
                                  } else {
                                    haptic.error();
                                  }
                                }}
                                className="rounded-2xl bg-admin-gold px-8 py-3 text-[10px] font-black uppercase tracking-widest text-black shadow-xl shadow-admin-gold/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:grayscale"
                                disabled={
                                  isSubmittingReply ||
                                  !replyText.trim() ||
                                  isOffline
                                }
                              >
                                {isSubmittingReply
                                  ? "Publicando..."
                                  : "Publicar Resposta"}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {adminReviews.map((review) => (
                <motion.div
                  key={review.id}
                  variants={itemVariants}
                  layout
                  className="group relative"
                >
                  <div className="absolute -inset-px rounded-[2rem] bg-gradient-to-r from-admin-gold/10 via-transparent to-emerald-500/5 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
                  <div className="content-visibility-auto relative flex h-full flex-col justify-between overflow-hidden rounded-[2rem] border border-white/[0.05] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-5 shadow-2xl backdrop-blur-3xl transition-all duration-500 hover:border-white/10 hover:bg-white/[0.02]">
                    <div>
                      {/* Header with avatar, name and star rating */}
                      <div className="mb-4 flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="relative shrink-0">
                            <div
                              className={`size-10 rounded-xl bg-gradient-to-br ${getAvatarGradient(review.customerName)} flex items-center justify-center border border-white/5 text-sm font-black text-white shadow-lg`}
                            >
                              {review.customerName.charAt(0).toUpperCase()}
                            </div>
                            <div className="border-zinc-955 absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded border bg-admin-gold">
                              <User className="size-2.5 text-black" />
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <p className="truncate text-sm font-black uppercase text-white">
                                {review.customerName}
                              </p>
                              {review.verified && (
                                <ShieldCheck className="text-emerald-450 size-3.5 shrink-0" />
                              )}
                            </div>
                            <span className="block text-[8px] font-bold uppercase tracking-tight text-zinc-550">
                              {formatDate(review.createdAt)}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/5 bg-zinc-900/80 px-2 py-1">
                          <Star className="size-3 fill-admin-gold text-admin-gold" />
                          <span className="text-[10px] font-black text-white">
                            {review.rating}
                          </span>
                        </div>
                      </div>

                      {/* Product link tag */}
                      <div className="mb-3">
                        <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-white/5 bg-zinc-900 px-2.5 py-0.5 text-[10px] font-black text-admin-gold">
                          <Package className="size-3 shrink-0 text-admin-gold" />
                          <span className="truncate">{review.productName}</span>
                        </span>
                      </div>

                      {/* Comment */}
                      <p className="mb-4 line-clamp-3 text-xs font-medium italic leading-relaxed text-zinc-400">
                        "{review.comment}"
                      </p>

                      {/* Merchant Reply Indicator */}
                      {review.merchantReply && (
                        <div className="mb-4 flex items-start gap-2 rounded-xl border border-admin-gold/10 bg-admin-gold/[0.02] p-3">
                          <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-admin-gold" />
                          <p className="line-clamp-2 text-[10px] italic text-admin-gold/80">
                            "{review.merchantReply}"
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="mt-auto flex items-center justify-between gap-2 border-t border-white/5 pt-4">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            handleToggleVerified(review.id, review.verified);
                          }}
                          className={`rounded-xl p-2 transition-all duration-300 ${
                            review.verified
                              ? "border border-white/5 bg-zinc-900 text-zinc-550 hover:bg-zinc-800"
                              : "bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:scale-105"
                          }`}
                          title={
                            review.verified
                              ? "Remover Verificação"
                              : "Verificar Compra"
                          }
                        >
                          <ShieldCheck className="size-4" />
                        </button>

                        {!review.merchantReply && (
                          <button
                            onClick={() => {
                              if (isOffline) {
                                toast.error("Você está offline", {
                                  description:
                                    "Não é possível responder avaliações sem conexão.",
                                });
                                return;
                              }
                              setReplyingTo(review.id);
                              setReplyText("");
                            }}
                            className="rounded-xl bg-admin-gold p-2 text-black shadow-md shadow-admin-gold/10 transition-all hover:scale-105"
                            title="Responder"
                          >
                            <MessageSquare className="size-4" />
                          </button>
                        )}
                      </div>

                      {confirmDeleteId === review.id ? (
                        <div className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-500/10 p-1 duration-300 animate-in slide-in-from-right-4">
                          <button
                            onClick={() => handleDelete(review.id)}
                            className="bg-red-650 hover:bg-red-550 rounded-lg px-2 py-1 text-[9px] font-black uppercase text-white transition-all"
                          >
                            Sim
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg bg-white/5 px-2 py-1 text-[9px] font-black text-zinc-400 transition-all hover:bg-white/10"
                          >
                            Não
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(review.id)}
                          className="rounded-xl border border-red-500/10 bg-red-500/10 p-2 text-red-400 transition-all duration-300 hover:bg-red-500 hover:text-white active:scale-95"
                          title="Excluir"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>

                    {/* Inline Reply Form (Compact version) */}
                    <AnimatePresence>
                      {replyingTo === review.id && (
                        <motion.div
                          initial={{ opacity: 0, height: 0, marginTop: 0 }}
                          animate={{
                            opacity: 1,
                            height: "auto",
                            marginTop: 12,
                          }}
                          exit={{ opacity: 0, height: 0, marginTop: 0 }}
                          className="absolute inset-x-0 bottom-0 z-20 overflow-hidden rounded-b-[2rem] border-t border-white/10 bg-zinc-950 p-4"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[8px] font-black uppercase tracking-widest text-white">
                                Responder
                              </span>
                              <button
                                onClick={() => {
                                  if (replyText.trim().length > 0) {
                                    if (
                                      globalThis.confirm(
                                        "Deseja realmente cancelar a resposta? O texto digitado será perdido.",
                                      )
                                    ) {
                                      setReplyingTo(null);
                                    }
                                  } else {
                                    setReplyingTo(null);
                                  }
                                }}
                                className="text-[10px] text-zinc-550 hover:text-white"
                              >
                                ✕
                              </button>
                            </div>
                            <textarea
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder={
                                isOffline
                                  ? "Você está offline. Não é possível responder."
                                  : "Resposta..."
                              }
                              className="min-h-[80px] w-full resize-none rounded-xl border border-white/10 bg-black/45 p-3 text-xs text-white transition-all placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-admin-gold/30 disabled:opacity-40"
                              disabled={isSubmittingReply || isOffline}
                            />
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={async () => {
                                  if (isOffline) {
                                    haptic.error();
                                    toast.error("Você está offline", {
                                      description:
                                        "Não é possível responder avaliações sem conexão.",
                                    });
                                    return;
                                  }
                                  if (!replyText.trim()) return;
                                  haptic.light();
                                  setIsSubmittingReply(true);
                                  const success = await addMerchantReply(
                                    review.id,
                                    replyText,
                                  );
                                  setIsSubmittingReply(false);
                                  if (success) {
                                    haptic.success();
                                    setReplyingTo(null);
                                    setReplyText("");
                                    getAllReviews(page, pageSize, {
                                      rating: ratingFilter,
                                      search: searchQuery,
                                    });
                                  } else {
                                    haptic.error();
                                  }
                                }}
                                className="rounded-lg bg-admin-gold px-4 py-1.5 text-[9px] font-black uppercase text-black transition-all hover:scale-105 disabled:opacity-50"
                                disabled={
                                  isSubmittingReply ||
                                  !replyText.trim() ||
                                  isOffline
                                }
                              >
                                {isSubmittingReply
                                  ? "Enviando..."
                                  : "Responder"}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modern Pagination */}
        {totalPages > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-16 flex items-center justify-center gap-6"
          >
            <button
              onClick={(e) => {
                setPage((prev) => Math.max(0, prev - 1));
                const mainEl =
                  e.currentTarget.closest(".admin-scroll-container") ||
                  document.querySelector(".active-scroll-container") ||
                  document.querySelector("main");
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
              }}
              disabled={page === 0}
              className="flex size-14 items-center justify-center rounded-2xl border border-white/5 bg-zinc-950/50 text-white shadow-2xl transition-all hover:bg-zinc-900 active:scale-90 disabled:opacity-20"
            >
              <ArrowLeft className="size-5 text-zinc-400" />
            </button>

            <div className="flex items-center gap-3 rounded-3xl border border-white/5 bg-zinc-950/30 p-1.5">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    setPage(i);
                    const mainEl =
                      e.currentTarget.closest(".admin-scroll-container") ||
                      document.querySelector(".active-scroll-container") ||
                      document.querySelector("main");
                    if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className={`size-11 rounded-xl text-[11px] font-black transition-all duration-300 ${
                    page === i
                      ? "scale-110 bg-admin-gold text-black shadow-xl shadow-admin-gold/20"
                      : "text-zinc-500 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>

            <button
              onClick={(e) => {
                setPage((prev) => Math.min(totalPages - 1, prev + 1));
                const mainEl =
                  e.currentTarget.closest(".admin-scroll-container") ||
                  document.querySelector(".active-scroll-container") ||
                  document.querySelector("main");
                if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
              }}
              disabled={page === totalPages - 1}
              className="flex size-14 items-center justify-center rounded-2xl border border-white/5 bg-zinc-950/50 text-white shadow-2xl transition-all hover:bg-zinc-900 active:scale-90 disabled:opacity-20"
            >
              <ArrowLeft className="size-5 rotate-180 text-zinc-400" />
            </button>
          </motion.div>
        )}
      </div>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Moderação de Avaliações"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Esta tela permite auditar e moderar o feedback dos clientes sobre as
            compras. A moderação de avaliações garante que o feed de depoimentos
            se mantenha limpo, verídico e útil para novos compradores.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Principais Recursos
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Star className="size-4 fill-admin-gold text-admin-gold" />
                  Nota por Estrelas (1-5)
                </div>
                <p className="text-xs text-zinc-400">
                  O nível de satisfação do cliente. A média global de estrelas é
                  calculada na parte superior de forma dinâmica.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <ShieldCheck className="size-4 text-emerald-400" />
                  Compra Verificada
                </div>
                <p className="text-xs text-zinc-400">
                  Indica se o cliente de fato realizou a compra desse item pela
                  plataforma. Você pode marcar ou desmarcar manualmente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <MessageSquare className="size-4 text-sky-400" />
                  Resposta Oficial da Loja
                </div>
                <p className="text-xs text-zinc-400">
                  Você pode responder diretamente ao comentário do cliente com
                  atalhos de resposta rápidas predefinidas para dar suporte.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Trash2 className="size-4 text-red-400" />
                  Exclusão Preventiva
                </div>
                <p className="text-xs text-zinc-400">
                  Avaliações com linguagem imprópria ou spam podem ser
                  permanentemente removidas do sistema clicando no ícone de
                  lixeira.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Background Decorative Elements */}
      <div className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
        <div className="animate-duration-3000 absolute left-[-10%] top-[-10%] size-2/5 animate-pulse rounded-full bg-admin-gold/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] size-2/5 rounded-full bg-white/5 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 z-[-2] size-full -translate-x-1/2 -translate-y-1/2 bg-[#09090b]" />
      </div>
    </div>
  );
});

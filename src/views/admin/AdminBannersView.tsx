import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ImageAdjuster } from "@/components/ui/custom/ImageAdjuster";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useBanners } from "@/hooks/useBanners";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { cn } from "@/lib/utils";
import type { Banner, View } from "@/types";
import { type Variants, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Edit,
  ExternalLink,
  Eye,
  HelpCircle,
  Layout,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Trash,
  Upload,
  Zap,
} from "lucide-react";
import {
  type ChangeEvent,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

interface AdminBannersViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
  onSetBackOverride?: (fn: (() => void) | null) => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 120, damping: 14 },
  },
};

export const AdminBannersView = memo(function AdminBannersView({
  active = true,
  onSetDirty,
  onSetBackOverride,
}: AdminBannersViewProps) {
  const {
    banners,
    isLoaded,
    uploadBannerImage,
    addBanner,
    updateBanner,
    deleteBanner,
    reorderBanners,
    refreshBanners,
  } = useBanners(true);
  const isOffline = useOnlineStatus();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTab, setSelectedTab] = useLocalStorage<
    "all" | "home_top" | "home_middle" | "home_bottom"
  >("admin_banners_selected_tab", "all");
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_banners_view_mode",
    "compact",
  );
  const [bannerToDelete, setBannerToDelete] = useState<{
    id: string;
    imageUrl: string;
  } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeAction, setActiveAction] = useState<{
    id: string;
    type: "up" | "down" | "toggle" | "delete";
  } | null>(null);

  const { ref: viewRef } = useScrollRestoration(
    "admin-banners",
    active ?? false,
    banners.length > 0,
  );

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando banners...", {
        icon: "⚡",
      });
      refreshBanners(false, true);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, refreshBanners]);

  // Image Adjuster integration
  const [isAdjusterOpen, setIsAdjusterOpen] = useState(false);
  const [adjustingImgUrl, setAdjustingImgUrl] = useState("");
  const [isUploadingAdjusted, setIsUploadingAdjusted] = useState(false);

  const openAdjuster = (url: string) => {
    setAdjustingImgUrl(url);
    setIsAdjusterOpen(true);
  };

  const handleAdjustConfirm = async (croppedBlob: Blob) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar a imagem ajustada.",
      });
      return;
    }
    setIsUploadingAdjusted(true);
    const file = new File([croppedBlob], `banner-image-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    const loadingToast = toast.loading("Enviando imagem recortada...");
    try {
      const url = await uploadBannerImage(file);
      setFormData((prev) => ({ ...prev, imageUrl: url }));
      toast.success("Imagem ajustada com sucesso!", { id: loadingToast });
      setIsAdjusterOpen(false);
    } catch (error) {
      console.error("Error uploading adjusted banner image:", error);
      toast.error("Erro ao salvar imagem ajustada", { id: loadingToast });
    } finally {
      setIsUploadingAdjusted(false);
    }
  };

  const [formData, setFormData] = useState<Partial<Banner>>({
    title: "",
    imageUrl: "",
    link: "",
    position: "home_top",
    active: true,
    order: 0,
  });

  // Reset modal and adjuster states when active is false to prevent focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      setIsDialogOpen(false);
      setShowHelpModal(false);
      setEditingBanner(null);
      setUploading(false);
      setIsSubmitting(false);
      setBannerToDelete(null);
      setIsAdjusterOpen(false);
      setAdjustingImgUrl("");
      setIsUploadingAdjusted(false);
    }
  }, [active]);

  // Controlar estado dirty do formulário para evitar descarte involuntário
  useEffect(() => {
    if (!onSetDirty) return;
    if (!isDialogOpen) {
      onSetDirty(false);
      return;
    }

    const defaultPosition =
      editingBanner?.position ||
      (selectedTab !== "all" ? selectedTab : "home_top");
    const defaultOrder =
      banners.filter((b) => b.position === defaultPosition).length + 1;

    const initial = editingBanner || {
      title: "",
      imageUrl: "",
      link: "",
      position: defaultPosition,
      active: true,
      order: defaultOrder,
    };

    const isDirty =
      (formData.title || "") !== (initial.title || "") ||
      (formData.imageUrl || "") !== (initial.imageUrl || "") ||
      (formData.link || "") !== (initial.link || "") ||
      formData.position !== initial.position ||
      formData.active !== initial.active ||
      Number(formData.order) !== Number(initial.order);

    onSetDirty(isDirty);
  }, [isDialogOpen, formData, editingBanner, banners, selectedTab, onSetDirty]);

  useEffect(() => {
    if (onSetBackOverride) {
      if (isDialogOpen) {
        onSetBackOverride(() => {
          setIsDialogOpen(false);
        });
      } else {
        onSetBackOverride(null);
      }
    }
    return () => {
      if (onSetBackOverride) {
        onSetBackOverride(null);
      }
    };
  }, [isDialogOpen, onSetBackOverride]);

  const handleOpenDialog = (banner?: Banner) => {
    if (banner?.id) {
      setEditingBanner(banner);
      setFormData({ ...banner });
    } else {
      setEditingBanner(null);
      const defaultPosition =
        banner?.position || (selectedTab !== "all" ? selectedTab : "home_top");
      setFormData({
        title: "",
        imageUrl: "",
        link: "",
        position: defaultPosition,
        active: true,
        order: banners.filter((b) => b.position === defaultPosition).length + 1,
      });
    }
    setIsDialogOpen(true);
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para fazer o upload de imagens.",
      });
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const loadingToast = toast.loading("Enviando imagem do banner...");
    try {
      const url = await uploadBannerImage(file);
      setFormData((prev) => ({ ...prev, imageUrl: url }));
      toast.success("Imagem enviada com sucesso", { id: loadingToast });
    } catch {
      toast.error("Erro ao enviar imagem", { id: loadingToast });
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para salvar as alterações do banner.",
      });
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (!formData.imageUrl) {
        toast.error("Imagem é obrigatória");
        setIsSubmitting(false);
        return;
      }

      let sanitizedLink = formData.link ? formData.link.trim() : "";
      if (
        sanitizedLink &&
        !sanitizedLink.startsWith("/") &&
        !sanitizedLink.startsWith("http://") &&
        !sanitizedLink.startsWith("https://")
      ) {
        sanitizedLink = `/${sanitizedLink}`;
      }

      const dataToSubmit = {
        ...formData,
        link: sanitizedLink,
      };

      if (editingBanner) {
        await updateBanner(editingBanner.id, dataToSubmit);
      } else {
        await addBanner(dataToSubmit as Required<Omit<Banner, "id">>);
      }
      await refreshBanners(false, true);
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Erro ao salvar banner:", error);
      toast.error("Erro ao salvar as configurações do banner.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string, imageUrl: string) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para excluir banners.",
      });
      return;
    }
    setBannerToDelete({ id, imageUrl });
  };

  const confirmDeleteBanner = async () => {
    if (!bannerToDelete) return;
    setIsProcessing(true);
    setActiveAction({ id: bannerToDelete.id, type: "delete" });
    try {
      await deleteBanner(bannerToDelete.id, bannerToDelete.imageUrl);
      await refreshBanners(false, true);
    } catch (error) {
      console.error("Erro ao deletar banner:", error);
      toast.error("Erro ao deletar o banner.");
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
      setBannerToDelete(null);
    }
  };

  const handleToggleActive = async (banner: Banner) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para alternar a visibilidade do banner.",
      });
      return;
    }
    setIsProcessing(true);
    setActiveAction({ id: banner.id, type: "toggle" });
    try {
      await updateBanner(banner.id, { active: !banner.active });
      await refreshBanners(false, true);
    } catch (error) {
      console.error("Erro ao alternar status do banner:", error);
    } finally {
      setIsProcessing(false);
      setActiveAction(null);
    }
  };

  const moveBanner = async (banner: Banner, direction: "up" | "down") => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description:
          "Você precisa estar online para alterar a ordem dos banners.",
      });
      return;
    }
    const bannersInPosition = banners
      .filter((b) => b.position === banner.position)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const currentIndex = bannersInPosition.findIndex((b) => b.id === banner.id);
    const targetIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;

    if (targetIndex >= 0 && targetIndex < bannersInPosition.length) {
      const targetBanner = bannersInPosition[targetIndex];
      setIsProcessing(true);
      setActiveAction({ id: banner.id, type: direction });
      try {
        await reorderBanners(banner.id, targetBanner.id);
      } catch (error) {
        console.error("Erro ao reordenar banners:", error);
        toast.error("Erro ao reordenar banners.");
      } finally {
        setIsProcessing(false);
        setActiveAction(null);
      }
    }
  };

  const positions = [
    { value: "home_top", label: "Cabeçalho Inicial (Topo)" },
    { value: "home_middle", label: "Seção Intermediária (Meio)" },
    { value: "home_bottom", label: "Rodapé da Página (Base)" },
  ];

  // Compute Metrics
  const totalBanners = banners.length;
  const activeBanners = banners.filter((b) => b.active).length;
  const topActive = banners.some((b) => b.position === "home_top" && b.active);
  const middleActive = banners.some(
    (b) => b.position === "home_middle" && b.active,
  );
  const bottomActive = banners.some(
    (b) => b.position === "home_bottom" && b.active,
  );
  const activeSectionsCount = [topActive, middleActive, bottomActive].filter(
    Boolean,
  ).length;
  const impactText =
    activeSectionsCount === 3
      ? "Máximo"
      : activeSectionsCount === 2
        ? "Alto"
        : activeSectionsCount === 1
          ? "Moderado"
          : "Nenhum";

  const visiblePositions =
    selectedTab === "all"
      ? positions
      : positions.filter((pos) => pos.value === selectedTab);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "ativos",
        label: "Banners Ativos",
        icon: Eye,
        iconClass: "text-[#FFBF00] animate-pulse",
        iconBg: "bg-amber-500/10 border-amber-500/20",
        hoverBorder:
          "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
        value: activeBanners,
        accent: "text-[#FFBF00]",
        subValue: `/ ${totalBanners} total`,
        footer: "Banners atualmente visíveis no app",
      },
      {
        id: "distribuicao",
        label: "Distribuição",
        icon: Layout,
        iconClass: "text-amber-500",
        iconBg: "bg-zinc-900 border-white/5",
        hoverBorder:
          "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
        value: `${banners.filter((b) => b.position === "home_top").length} Topo`,
        accent: "text-amber-500",
        subValue: `Meio: ${banners.filter((b) => b.position === "home_middle").length} • Base: ${banners.filter((b) => b.position === "home_bottom").length}`,
        footer: "Posicionamento na Home",
      },
      {
        id: "impacto",
        label: "Impacto Estético",
        icon: Sparkles,
        iconClass: "text-[#FFBF00]",
        iconBg: "bg-[#FFBF00]/10 border-[#FFBF00]/20",
        hoverBorder:
          "hover:border-[#FFBF00]/30 hover:shadow-[0_0_30px_rgba(255,191,0,0.05)]",
        value: impactText,
        accent: "text-[#FFBF00]",
        footer: "Preenchimento das seções",
      },
    ],
    [activeBanners, totalBanners, banners, impactText],
  );

  const renderSkeleton = () => (
    <div className="animate-pulse select-none space-y-16">
      {visiblePositions.map((pos) => (
        <div key={pos.value} className="space-y-6">
          {selectedTab === "all" && (
            <div className="flex items-center justify-between border-b border-white/5 px-2 pb-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-3.5 rounded-full bg-white/5" />
                <Skeleton className="h-4.5 w-32 rounded bg-white/5" />
              </div>
              <Skeleton className="h-3 w-16 rounded bg-white/5" />
            </div>
          )}
          <div className="grid gap-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="flex h-[230px] flex-col items-center gap-6 rounded-[2.5rem] border border-white/5 bg-zinc-950/30 p-4 sm:h-[180px] sm:p-5 lg:h-[230px] lg:flex-row xl:h-[180px]"
              >
                <Skeleton className="aspect-[21/9] w-full shrink-0 rounded-2xl bg-white/5 lg:w-[380px] xl:w-[440px]" />
                <div className="w-full flex-1 space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-1/2 rounded bg-white/5" />
                      <div className="flex gap-2">
                        <Skeleton className="h-4.5 w-16 rounded bg-white/5" />
                        <Skeleton className="h-4.5 w-16 rounded bg-white/5" />
                      </div>
                    </div>
                    <Skeleton className="h-8 w-16 rounded bg-white/5" />
                  </div>
                  <div className="h-px w-full bg-white/5" />
                  <div className="flex gap-3">
                    <Skeleton className="h-9 flex-1 rounded-xl bg-white/5" />
                    <Skeleton className="h-9 w-20 rounded-xl bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderCompactSkeleton = () => (
    <div className="animate-pulse select-none space-y-12">
      {visiblePositions.map((pos) => (
        <div key={pos.value} className="space-y-4">
          {selectedTab === "all" && (
            <div className="flex items-center justify-between border-b border-white/5 px-2 pb-2">
              <div className="flex items-center gap-2">
                <Skeleton className="size-2 rounded-full bg-white/5" />
                <Skeleton className="h-4 w-24 rounded bg-white/5" />
              </div>
              <Skeleton className="h-3 w-12 rounded bg-white/5" />
            </div>
          )}
          <div className="grid gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-zinc-950/10 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <Skeleton className="aspect-[21/9] w-24 sm:w-28 shrink-0 rounded-lg bg-white/5" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Skeleton className="h-4 w-1/3 rounded bg-white/5" />
                      <Skeleton className="h-3.5 w-8 rounded bg-white/5" />
                    </div>
                    <Skeleton className="h-3 w-1/2 rounded bg-white/5" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 sm:justify-end shrink-0 border-t border-white/5 pt-2 sm:border-t-0 sm:pt-0">
                  <div className="flex gap-1">
                    <Skeleton className="h-7 w-7 rounded bg-white/5" />
                    <Skeleton className="h-7 w-7 rounded bg-white/5" />
                  </div>
                  <Skeleton className="h-5 w-10 rounded-full bg-white/5" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-7 w-7 rounded bg-white/5" />
                    <Skeleton className="h-7 w-7 rounded bg-white/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={viewRef}
      className="relative h-auto overflow-x-hidden bg-[#09090b] pb-8 font-sans text-zinc-400 selection:bg-admin-gold/30 selection:text-white"
    >
      {/* Ambient subtle glow */}
      <div className="pointer-events-none absolute left-1/4 top-0 h-[400px] w-[400px] rounded-full bg-admin-gold/5 blur-[120px]" />
      <div className="pointer-events-none absolute right-1/4 top-1/3 h-[500px] w-[500px] rounded-full bg-amber-500/5 blur-[150px]" />

      {/* Sticky Compact Header */}
      {!isDialogOpen && (
        <>
          <div className="sticky top-0 z-40 p-4 pb-0">
        <div className="admin-glass flex flex-col gap-4 rounded-[2rem] border border-white/5 p-4 shadow-2xl sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="flex select-none items-center gap-2 text-lg font-black uppercase tracking-tight text-white">
                  <span className="bg-gradient-to-r from-[#FFBF00] to-amber-500 bg-clip-text font-extrabold italic text-transparent">
                    GERENCIADOR VISUAL
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                    title="Guia do Gerenciador de Banners"
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </h1>
              </div>
              <p className="mt-0.5 flex select-none items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.18em] text-zinc-500">
                Curadoria de Banners Premium
                <span className="size-1 animate-pulse rounded-full bg-admin-gold/70" />
                <span className="text-amber-500/80">Estética PWA</span>
              </p>
            </div>
          </div>

          {isLoaded && banners.length > 0 && (
            <button
              onClick={() => handleOpenDialog()}
              disabled={isOffline}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-[#FFBF00] px-5 py-2.5 text-[9px] font-black uppercase tracking-wider text-black shadow-lg shadow-amber-500/10 transition-all hover:scale-[1.02] hover:bg-amber-500 active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:w-auto"
            >
              <Plus className="size-3.5 stroke-[3px]" /> Novo Banner
            </button>
          )}
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl space-y-8 p-4 sm:p-6 lg:p-8">
        {/* Stats Carousel Row */}
        {isLoaded && banners.length > 0 && (
          <div className="space-y-4">
            <AdminKpiCarousel
              cards={kpiCards}
              active={active}
              title="Métricas Visuais"
            />
          </div>
        )}

        {/* Filter Tabs & Options */}
        {isLoaded && banners.length > 0 && (
          <div className="flex select-none flex-col items-start justify-between gap-4 border-b border-white/5 pb-4 sm:flex-row sm:items-center">
            <div className="relative flex flex-wrap rounded-2xl border border-white/5 bg-zinc-950 p-1">
              <button
                onClick={() => setSelectedTab("all")}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                  selectedTab === "all"
                    ? "text-black"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <span className="relative z-10">Todos</span>
                {selectedTab === "all" && (
                  <motion.div
                    layoutId="activeBannerTab"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
              <button
                onClick={() => setSelectedTab("home_top")}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                  selectedTab === "home_top"
                    ? "text-black"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <span className="relative z-10">Topo</span>
                {selectedTab === "home_top" && (
                  <motion.div
                    layoutId="activeBannerTab"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
              <button
                onClick={() => setSelectedTab("home_middle")}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                  selectedTab === "home_middle"
                    ? "text-black"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <span className="relative z-10">Meio</span>
                {selectedTab === "home_middle" && (
                  <motion.div
                    layoutId="activeBannerTab"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
              <button
                onClick={() => setSelectedTab("home_bottom")}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-300 relative",
                  selectedTab === "home_bottom"
                    ? "text-black"
                    : "text-zinc-500 hover:text-zinc-300",
                )}
              >
                <span className="relative z-10">Base</span>
                {selectedTab === "home_bottom" && (
                  <motion.div
                    layoutId="activeBannerTab"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-[#FFBF00] to-amber-500 shadow-md"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            </div>

            <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
              <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                <SlidersHorizontal className="size-3.5 text-amber-500" />
                <span>
                  Visualizando:{" "}
                  {selectedTab === "all"
                    ? "Todos os setores"
                    : positions.find((p) => p.value === selectedTab)?.label}
                </span>
              </div>

              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  setViewMode((prev) =>
                    prev === "detailed" ? "compact" : "detailed",
                  )
                }
                className="group h-8 w-8 rounded-lg border-zinc-800 bg-zinc-900/60 transition-all hover:border-admin-gold/50 hover:bg-zinc-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                title={
                  viewMode === "detailed"
                    ? "Visualização Compacta"
                    : "Visualização Detalhada"
                }
              >
                {viewMode === "detailed" ? (
                  <List className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                ) : (
                  <LayoutGrid className="size-4 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Banner Content List */}
        {!isLoaded && banners.length === 0 ? (
          <div className="py-6">
            {viewMode === "compact"
              ? renderCompactSkeleton()
              : renderSkeleton()}
          </div>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={cn(viewMode === "compact" ? "space-y-10" : "space-y-16")}
          >
            {visiblePositions.map((pos) => {
              const positionBanners = banners
                .filter((b) => b.position === pos.value)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

              return (
                <div
                  key={pos.value}
                  className={cn(
                    viewMode === "compact" ? "space-y-4" : "space-y-6",
                  )}
                >
                  {selectedTab === "all" && (
                    <div className="flex select-none items-center justify-between border-b border-white/5 px-2 pb-2">
                      <div className="flex items-center gap-3">
                        <div className="size-2.5 animate-pulse rounded-full bg-gradient-to-br from-[#FFBF00] to-amber-500 shadow-[0_0_10px_rgba(255,191,0,0.5)]" />
                        <h2 className="text-xs font-black uppercase italic tracking-widest text-white">
                          {pos.label}
                        </h2>
                      </div>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                        {positionBanners.length}{" "}
                        {positionBanners.length === 1 ? "Banner" : "Banners"}
                      </span>
                    </div>
                  )}

                  {positionBanners.length === 0 ? (
                    <div className="group/empty flex flex-col items-center justify-center rounded-[2.5rem] border border-dashed border-white/5 bg-zinc-950/20 p-12 text-center backdrop-blur-sm transition-all duration-300 hover:border-zinc-800">
                      <Layout className="mb-3 size-8 text-zinc-700 transition-colors group-hover/empty:text-zinc-500" />
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                        Nenhum Banner cadastrado neste Setor
                      </p>
                      <button
                        onClick={() =>
                          handleOpenDialog({ position: pos.value } as Banner)
                        }
                        disabled={isOffline}
                        className="text-[10px] font-black uppercase tracking-widest text-[#FFBF00] underline transition-colors hover:text-white disabled:pointer-events-none disabled:opacity-50 disabled:grayscale"
                      >
                        + Adicionar Primeiro Banner
                      </button>
                    </div>
                  ) : (
                    <motion.div
                      layout
                      className={
                        viewMode === "compact" ? "grid gap-3" : "grid gap-6"
                      }
                    >
                      {positionBanners.map((banner, index) => {
                        if (viewMode === "compact") {
                          return (
                            <motion.div
                              layout
                              key={banner.id}
                              variants={itemVariants}
                              className={cn(
                                "group relative bg-zinc-950/20 border border-white/5 rounded-2xl p-3 transition-all duration-300 hover:border-zinc-800 hover:bg-zinc-950/40 hover:shadow-lg",
                                !banner.active && "opacity-60",
                              )}
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                {/* Left Side: Thumbnail, Title, Sector/Order badges, and Link */}
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  {/* Thumbnail */}
                                  <div className="relative aspect-[21/9] w-24 sm:w-28 shrink-0 overflow-hidden rounded-lg border border-white/5 bg-zinc-900 shadow-md">
                                    <LazyImage
                                      src={banner.imageUrl}
                                      alt={banner.title || "Banner"}
                                      className="size-full object-cover"
                                    />
                                    {!banner.active && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-[7px] font-black uppercase tracking-wider text-white/80">
                                        Pausado
                                      </div>
                                    )}
                                  </div>

                                  {/* Title, Badge and Link Info */}
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <h4 className="truncate text-xs font-bold text-white transition-colors group-hover:text-admin-gold">
                                        {banner.title || "Campanha sem Título"}
                                      </h4>
                                      <div className="shrink-0 rounded bg-zinc-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                                        #{banner.order}
                                      </div>
                                      {selectedTab === "all" && (
                                        <div className="shrink-0 rounded bg-zinc-900 border border-white/5 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                                          {pos.label.split(" ")[0]}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1 text-[8px] text-zinc-500 font-mono truncate">
                                      <ExternalLink className="size-2.5 shrink-0 text-amber-500" />
                                      <span className="truncate">
                                        {banner.link || "Início (Sem Rota)"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                {/* Right Side: Reordering, Switch & Actions */}
                                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-2 sm:border-t-0 sm:pt-0 sm:justify-end shrink-0">
                                  {/* Arrow Reordering */}
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => moveBanner(banner, "up")}
                                      disabled={
                                        index === 0 || isProcessing || isOffline
                                      }
                                      className="flex size-7 items-center justify-center rounded-md border border-white/5 bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-white disabled:opacity-10"
                                      title="Mover para cima"
                                    >
                                      {activeAction?.id === banner.id &&
                                      activeAction?.type === "up" ? (
                                        <Loader2 className="size-3 animate-spin text-admin-gold" />
                                      ) : (
                                        <ArrowUp className="size-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => moveBanner(banner, "down")}
                                      disabled={
                                        index === positionBanners.length - 1 ||
                                        isProcessing ||
                                        isOffline
                                      }
                                      className="flex size-7 items-center justify-center rounded-md border border-white/5 bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-white disabled:opacity-10"
                                      title="Mover para baixo"
                                    >
                                      {activeAction?.id === banner.id &&
                                      activeAction?.type === "down" ? (
                                        <Loader2 className="size-3 animate-spin text-admin-gold" />
                                      ) : (
                                        <ArrowDown className="size-3.5" />
                                      )}
                                    </button>
                                  </div>

                                  {/* Toggle Status Switch */}
                                  <div className="flex items-center gap-2">
                                    <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500 hidden sm:inline">
                                      Exibir
                                    </span>
                                    <Switch
                                      checked={banner.active}
                                      onCheckedChange={() =>
                                        handleToggleActive(banner)
                                      }
                                      disabled={
                                        (activeAction?.id === banner.id &&
                                          activeAction?.type === "toggle") ||
                                        isOffline
                                      }
                                      className="scale-75 data-[state=checked]:bg-[#FFBF00]"
                                    />
                                  </div>

                                  {/* Edit & Delete Action Buttons */}
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleOpenDialog(banner)}
                                      disabled={isProcessing || isOffline}
                                      className="flex size-7 items-center justify-center rounded-md border border-white/5 bg-zinc-900 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white"
                                      title="Editar"
                                    >
                                      <Edit className="size-3.5 text-[#FFBF00]" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        handleDelete(banner.id, banner.imageUrl)
                                      }
                                      disabled={isProcessing || isOffline}
                                      className="flex size-7 items-center justify-center rounded-md border border-red-500/20 bg-red-500/10 text-red-400 transition-all hover:bg-red-500 hover:text-white"
                                      title="Excluir"
                                    >
                                      {activeAction?.id === banner.id &&
                                      activeAction?.type === "delete" ? (
                                        <Loader2 className="size-3 animate-spin" />
                                      ) : (
                                        <Trash className="size-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          );
                        }

                        return (
                          <motion.div
                            layout
                            key={banner.id}
                            variants={itemVariants}
                            className={cn(
                              "group relative bg-zinc-950/30 backdrop-blur-md border border-white/5 rounded-[2.5rem] p-4 sm:p-5 transition-all duration-500 hover:border-zinc-800 hover:bg-zinc-950/50 hover:shadow-2xl",
                              !banner.active && "opacity-50",
                            )}
                          >
                            <div className="flex w-full flex-col items-center gap-6 lg:flex-row">
                              {/* Image Preview Card */}
                              <div className="relative aspect-[21/9] w-full shrink-0 overflow-hidden rounded-2xl border border-white/5 bg-zinc-900 shadow-2xl transition-all duration-500 group-hover:scale-[1.01] lg:w-[380px] xl:w-[440px]">
                                <LazyImage
                                  src={banner.imageUrl}
                                  alt={banner.title || "Banner"}
                                  className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                                {!banner.active && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/65 px-4 text-center text-[10px] font-black uppercase italic tracking-[0.4em] text-white/70 backdrop-blur-[2px]">
                                    Exibição Suspensa
                                  </div>
                                )}
                              </div>

                              {/* Details and Controls Panel */}
                              <div className="relative z-10 w-full min-w-0 flex-1 space-y-4">
                                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                                  <div className="w-full min-w-0 space-y-1">
                                    <h3 className="w-full truncate text-base font-bold leading-snug tracking-tight text-white transition-colors duration-300 group-hover:text-admin-gold sm:text-lg">
                                      {banner.title || "Campanha sem Título"}
                                    </h3>
                                    <div className="flex items-center gap-2">
                                      <div className="shrink-0 rounded-md border border-white/5 bg-zinc-900 px-2 py-0.5">
                                        <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                                          Ordem:{" "}
                                          <span className="font-mono text-white">
                                            #{banner.order}
                                          </span>
                                        </p>
                                      </div>
                                      <div className="shrink-0 rounded-md border border-white/5 bg-zinc-900 px-2 py-0.5">
                                        <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
                                          Setor:{" "}
                                          <span className="font-mono text-white">
                                            {pos.label.split(" ")[0]}
                                          </span>
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Arrow Position Reordering pads */}
                                  <div className="flex shrink-0 gap-1.5 self-start sm:self-center">
                                    <button
                                      onClick={() => moveBanner(banner, "up")}
                                      disabled={
                                        index === 0 || isProcessing || isOffline
                                      }
                                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-10"
                                      title="Mover para cima"
                                    >
                                      {activeAction?.id === banner.id &&
                                      activeAction?.type === "up" ? (
                                        <Loader2 className="size-3.5 animate-spin text-admin-gold" />
                                      ) : (
                                        <ArrowUp className="size-4" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => moveBanner(banner, "down")}
                                      disabled={
                                        index === positionBanners.length - 1 ||
                                        isProcessing ||
                                        isOffline
                                      }
                                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-zinc-900 text-zinc-500 transition-all hover:bg-zinc-800 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-10"
                                      title="Mover para baixo"
                                    >
                                      {activeAction?.id === banner.id &&
                                      activeAction?.type === "down" ? (
                                        <Loader2 className="size-3.5 animate-spin text-admin-gold" />
                                      ) : (
                                        <ArrowDown className="size-4" />
                                      )}
                                    </button>
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 items-center gap-3 border-y border-white/5 py-3 sm:grid-cols-2">
                                  <div className="flex max-w-full items-center gap-2 truncate rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                                    <ExternalLink className="size-3.5 shrink-0 text-[#FFBF00]" />
                                    <span>Link:</span>
                                    <span className="truncate font-mono text-white">
                                      {banner.link || "Início (Sem Rota)"}
                                    </span>
                                  </div>

                                  {/* Fast Status Switch Toggle directly in the card */}
                                  <div className="flex items-center justify-between gap-3 px-1 sm:justify-end">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                                      Exibir no App
                                    </span>
                                    <Switch
                                      checked={banner.active}
                                      onCheckedChange={() =>
                                        handleToggleActive(banner)
                                      }
                                      disabled={
                                        (activeAction?.id === banner.id &&
                                          activeAction?.type === "toggle") ||
                                        isOffline
                                      }
                                      className="data-[state=checked]:bg-[#FFBF00]"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center gap-3 pt-1">
                                  <button
                                    onClick={() => handleOpenDialog(banner)}
                                    disabled={isProcessing || isOffline}
                                    className="flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-white/5 bg-zinc-900 px-4 text-xs font-semibold text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                  >
                                    <Edit className="size-3.5 shrink-0 text-[#FFBF00]" />{" "}
                                    Editar
                                  </button>
                                  <button
                                    onClick={() =>
                                      handleDelete(banner.id, banner.imageUrl)
                                    }
                                    disabled={isProcessing || isOffline}
                                    className="flex h-9 items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 text-xs font-semibold text-red-400 transition-all hover:border-transparent hover:bg-red-500 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                                  >
                                    {activeAction?.id === banner.id &&
                                    activeAction?.type === "delete" ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Trash className="size-3.5 shrink-0" />
                                    )}{" "}
                                    Excluir
                                  </button>
                                </div>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </motion.div>
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </div>
        </>
      )}

      {/* Formulário de Cadastro / Edição (Renderizado Inline como Página) */}
      {isDialogOpen && (
        <div className="mx-auto max-w-4xl w-full text-white space-y-6 p-4 sm:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-300 relative z-10">
          <div className="pointer-events-none absolute -right-40 -top-40 size-80 rounded-full bg-admin-gold/5 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-40 -left-40 size-80 rounded-full bg-[#FFBF00]/5 blur-[120px]" />

          <div className="w-full space-y-6 sm:space-y-8">
            <div className="select-none border-b border-white/5 pb-4">
              <h2 className="flex items-center gap-3 truncate text-lg font-black uppercase italic tracking-wider text-white sm:gap-4 sm:text-xl">
                <Sparkles className="size-6 shrink-0 text-[#FFBF00] sm:size-8" />
                <span className="truncate">
                  {editingBanner ? "Editar Banner" : "Cadastrar Novo Banner"}
                </span>
              </h2>
              <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500 sm:text-[10px]">
                Configuração de Layout e Parâmetros de Exibição
              </p>
            </div>

            {/* Two Columns: Left Form, Right Smartphone Simulator Mockup */}
            <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
              {/* Left Column: Form Controls */}
              <div className="space-y-4 lg:col-span-7">
                <div className="space-y-1.5">
                  <div className="mb-0.5 flex select-none items-baseline justify-between">
                    <Label
                      htmlFor="banner-upload"
                      className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500 opacity-85"
                    >
                      Imagem do Banner
                    </Label>
                    <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">
                      {formData.position === "home_top"
                        ? "Recomendado: 4:1 (ex: 1200x300px)"
                        : "Recomendado: 21:9 (ex: 1200x500px)"}
                    </span>
                  </div>
                  <div className="flex flex-col gap-6">
                    {uploading ? (
                      <div className="flex h-32 w-full flex-col items-center justify-center gap-4 rounded-2xl border border-white/5 bg-zinc-900/40">
                        <div className="size-8 animate-spin rounded-full border-2 border-zinc-700 border-t-[#FFBF00]" />
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                          Enviando Imagem...
                        </span>
                      </div>
                    ) : formData.imageUrl ? (
                      <div className="group relative aspect-[21/9] w-full overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl">
                        <img
                          src={formData.imageUrl}
                          alt="Preview"
                          className="size-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/45 opacity-100 transition-opacity hover-hover:opacity-0 hover-hover:group-hover:opacity-100">
                          <Label
                            htmlFor="banner-upload"
                            className="cursor-pointer select-none rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-white transition-all hover:bg-zinc-800"
                          >
                            Alterar
                          </Label>
                          <Button
                            type="button"
                            onClick={() => openAdjuster(formData.imageUrl!)}
                            className="flex select-none items-center gap-1.5 rounded-xl bg-[#FFBF00] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-black shadow-md transition-all duration-200 animate-in fade-in zoom-in-95 hover:bg-[#FFBF00]/90 active:scale-95"
                          >
                            <SlidersHorizontal className="size-3.5" /> Ajustar
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative">
                        <Label
                          htmlFor="banner-upload"
                          className="group flex h-32 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/5 bg-zinc-900/50 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600 transition-all hover:border-admin-gold/30 hover:bg-zinc-900"
                        >
                          <Upload className="size-8 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                          <span>Enviar Imagem Principal</span>
                        </Label>
                      </div>
                    )}
                    <Input
                      id="banner-upload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={uploading}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label
                      htmlFor="banner-title"
                      className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500"
                    >
                      Título da Campanha
                    </Label>
                    <LocalBufferedInput
                      id="banner-title"
                      name="title"
                      value={formData.title || ""}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, title: val }))
                      }
                      placeholder="Ex: Coleção de Verão"
                      useShadcn={true}
                      className="h-10 rounded-xl border-white/10 bg-zinc-900/50 text-sm font-bold text-white transition-all focus:border-[#FFBF00]/50 focus:ring-[#FFBF00]"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="banner-position"
                      className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500"
                    >
                      Posição na Tela
                    </Label>
                    <Select
                      value={formData.position}
                      onValueChange={(value: any) => {
                        const nextOrder =
                          banners.filter((b) => b.position === value).length +
                          1;
                        setFormData((prev) => ({
                          ...prev,
                          position: value,
                          order: nextOrder,
                        }));
                      }}
                    >
                      <SelectTrigger
                        id="banner-position"
                        className="h-10 rounded-xl border-white/10 bg-zinc-900/50 text-[9px] font-bold uppercase tracking-wider focus:ring-[#FFBF00]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-white/10 bg-zinc-950 text-white">
                        {positions.map((pos) => (
                          <SelectItem
                            key={pos.value}
                            value={pos.value}
                            className="text-[9px] font-bold uppercase tracking-wider"
                          >
                            {pos.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="banner-order"
                      className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500"
                    >
                      Prioridade de Exibição
                    </Label>
                    <Input
                      id="banner-order"
                      name="order"
                      type="number"
                      value={formData.order ?? ""}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          order: Number(e.target.value),
                        })
                      }
                      className="h-10 rounded-xl border-white/10 bg-zinc-900/50 text-sm font-bold focus:ring-[#FFBF00]"
                    />
                  </div>

                  <div className="space-y-1 sm:col-span-2">
                    <Label
                      htmlFor="banner-link"
                      className="ml-1 text-[9px] font-black uppercase italic tracking-widest text-zinc-500"
                    >
                      Link de Redirecionamento (Rota)
                    </Label>
                    <LocalBufferedInput
                      id="banner-link"
                      name="link"
                      value={formData.link || ""}
                      onFlush={(val) =>
                        setFormData((prev) => ({ ...prev, link: val }))
                      }
                      placeholder="Ex: /produtos, /categoria/calcados ou URL completa"
                      useShadcn={true}
                      className="h-10 rounded-xl border-white/10 bg-zinc-900/50 font-mono text-xs tracking-wide transition-all placeholder:text-zinc-750 focus:border-[#FFBF00]/50 focus:ring-[#FFBF00]"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-xl border border-white/5 bg-black/40 p-3 shadow-inner">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="banner-active"
                      className="flex items-center gap-2 text-[9px] font-black uppercase italic tracking-wider text-white"
                    >
                      Banner Ativo <Zap className="size-3.5 text-[#FFBF00]" />
                    </Label>
                    <p className="text-[8px] font-medium uppercase tracking-wider text-zinc-500">
                      Habilitar visualização imediata no aplicativo
                    </p>
                  </div>
                  <Switch
                    id="banner-active"
                    checked={formData.active}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, active: checked })
                    }
                    className="scale-90 data-[state=checked]:bg-[#FFBF00]"
                  />
                </div>
              </div>

              {/* Right Column: Mobile Live PWA Mockup Simulator */}
              <div className="flex select-none flex-col items-center lg:col-span-5">
                <span className="mb-3 self-start text-[10px] font-black uppercase italic tracking-widest text-zinc-500 opacity-85 lg:self-center">
                  Preview em Tempo Real (PWA Mobile)
                </span>

                <div className="group/device relative flex h-[480px] w-[280px] select-none flex-col justify-between overflow-hidden rounded-[2.5rem] border-4 border-zinc-800 bg-[#09090b] text-left shadow-[0_15px_40px_rgba(0,0,0,0.8)]">
                  {/* Mock Notch */}
                  <div className="absolute left-1/2 top-0 z-30 flex h-4.5 w-28 -translate-x-1/2 items-center justify-center rounded-b-2xl border-x border-b border-zinc-700/30 bg-zinc-800">
                    <div className="size-2.5 rounded-full border border-zinc-900 bg-zinc-950" />
                  </div>

                  {/* Status Bar */}
                  <div className="z-20 flex shrink-0 select-none items-center justify-between px-5 pb-1 pt-5 font-mono text-[7px] text-zinc-500">
                    <span>09:41</span>
                    <div className="flex items-center gap-1.5">
                      <span>5G</span>
                      <Smartphone className="size-2.5 text-zinc-500" />
                    </div>
                  </div>

                  {/* App Container */}
                  <div className="custom-scrollbar relative flex flex-1 select-none flex-col gap-4 overflow-y-auto px-4 py-2">
                    {/* Mock Header */}
                    <div className="flex items-center justify-between border-b border-white/5 pb-2">
                      <span className="text-[9px] font-black uppercase italic tracking-tight text-white">
                        IKCOUS
                      </span>
                      <div className="size-3.5 rounded-full bg-zinc-800" />
                    </div>

                    {/* Top Banner Area Preview */}
                    {formData.position === "home_top" && (
                      <div className="relative flex aspect-[21/9] w-full items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-zinc-900 shadow-md">
                        {formData.imageUrl ? (
                          <img
                            src={formData.imageUrl}
                            alt="Mockup Top"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-500">
                            Banner Topo
                          </span>
                        )}
                        {formData.title && (
                          <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[7px] font-bold text-white">
                            {formData.title}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Mock Search Bar */}
                    <div className="flex h-7 w-full shrink-0 items-center gap-1.5 rounded-xl border border-white/5 bg-zinc-900 px-3 text-[7px] text-zinc-600">
                      <span className="truncate">
                        Buscar roupas e calçados...
                      </span>
                    </div>

                    {/* Middle Banner Area Preview */}
                    {formData.position === "home_middle" && (
                      <div className="relative flex aspect-[21/9] w-full items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-zinc-900 shadow-md">
                        {formData.imageUrl ? (
                          <img
                            src={formData.imageUrl}
                            alt="Mockup Middle"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-500">
                            Banner Intermediário
                          </span>
                        )}
                        {formData.title && (
                          <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[7px] font-bold text-white">
                            {formData.title}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Mock Products list */}
                    <div className="shrink-0 space-y-1">
                      <div className="flex justify-between text-[7px] font-black uppercase tracking-wider text-zinc-500">
                        <span>Promoções em Destaque</span>
                        <span className="text-[#FFBF00]">Ver tudo</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-1.5">
                          <div className="aspect-square w-full rounded-md bg-zinc-800" />
                          <div className="h-1 w-8 rounded-sm bg-zinc-700" />
                          <div className="h-1.5 w-12 rounded-sm bg-[#FFBF00]" />
                        </div>
                        <div className="space-y-1 rounded-xl border border-white/5 bg-zinc-900/40 p-1.5">
                          <div className="aspect-square w-full rounded-md bg-zinc-800" />
                          <div className="h-1 w-6 rounded-sm bg-zinc-700" />
                          <div className="h-1.5 w-10 rounded-sm bg-[#FFBF00]" />
                        </div>
                      </div>
                    </div>

                    {/* Bottom Banner Area Preview */}
                    {formData.position === "home_bottom" && (
                      <div className="relative flex aspect-[21/9] w-full items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-zinc-900 shadow-md">
                        {formData.imageUrl ? (
                          <img
                            src={formData.imageUrl}
                            alt="Mockup Bottom"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="text-[7px] font-bold uppercase tracking-widest text-zinc-500">
                            Banner Rodapé
                          </span>
                        )}
                        {formData.title && (
                          <div className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-2 py-1 text-[7px] font-bold text-white">
                            {formData.title}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Mock Navigation Bottom Bar */}
                  <div className="flex shrink-0 justify-between border-t border-white/5 bg-zinc-950/80 px-6 py-2.5 text-[7px] font-bold text-zinc-500 backdrop-blur-md">
                    <span className="text-[#FFBF00]">Início</span>
                    <span>Buscar</span>
                    <span>Carrinho</span>
                    <span>Perfil</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer Action buttons */}
            <div className="flex flex-col gap-3 border-t border-white/5 pt-4 sm:flex-row sm:gap-4">
              <Button
                variant="ghost"
                onClick={() => setIsDialogOpen(false)}
                className="h-11 flex-1 rounded-xl text-[10px] font-black uppercase tracking-wider text-zinc-500 transition-all hover:bg-white/5 hover:text-white"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={uploading || isSubmitting || isOffline}
                className="h-11 flex-[2] rounded-xl border border-amber-400/20 bg-gradient-to-r from-[#FFBF00] to-amber-500 text-[10px] font-black uppercase tracking-wider text-black shadow-lg transition-all hover:scale-[1.02] hover:shadow-[0_0_25px_rgba(255,191,0,0.25)] active:scale-95 disabled:pointer-events-none disabled:scale-100 disabled:border-white/5 disabled:from-zinc-850 disabled:to-zinc-900 disabled:text-zinc-650 disabled:shadow-none"
              >
                {isOffline
                  ? "Modo Offline"
                  : uploading
                    ? "Enviando Imagem..."
                    : isSubmitting
                      ? "Salvando Configurações..."
                      : "Salvar Alterações"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Manual do Gerenciador de Banners"
      >
        <div className="space-y-4">
          <p className="leading-relaxed">
            O Gerenciador de Banners permite que você faça a curadoria dos
            banners rotativos na página inicial do aplicativo do cliente. Essa
            seção é a principal vitrine de promoções e produtos em destaque.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-amber-500 pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#FFBF00]">
              Parâmetros dos Banners
            </h4>
            <div className="grid select-none grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Layout className="size-4 text-emerald-500" />
                  Imagem Promocional
                </div>
                <p className="text-[10px] text-zinc-500">
                  Ideal usar proporção horizontal de 21:9. Imagens com boa
                  legibilidade aumentam a conversão.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <ExternalLink className="size-4 text-[#FFBF00]" />
                  Link de Destino
                </div>
                <p className="text-[10px] text-zinc-500">
                  A rota interna do app para onde o cliente será direcionado
                  (ex: `/produtos` ou `/categoria/calcados`).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <ArrowUp className="size-4 text-sky-500" />
                  Sequência / Ordenação
                </div>
                <p className="text-[10px] text-zinc-500">
                  Prioridade de exibição na fila de slides. Ordene usando os
                  controles simples no painel.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-4 text-purple-500" />
                  Status de Exibição
                </div>
                <p className="text-[10px] text-zinc-500">
                  Suspenda ou ative a visibilidade de qualquer campanha
                  instantaneamente usando o botão de alternar.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Image Adjuster Modal */}
      <ImageAdjuster
        isOpen={isAdjusterOpen}
        onClose={() => setIsAdjusterOpen(false)}
        imageUrl={adjustingImgUrl}
        onConfirm={handleAdjustConfirm}
        isSubmitting={isUploadingAdjusted}
        allowedPresets={["2:1", "4:1", "free"]}
        defaultPreset={formData.position === "home_top" ? "4:1" : "2:1"}
      />

      {/* Diálogo de Confirmação de Exclusão de Banner */}
      <AlertDialog
        open={bannerToDelete !== null}
        onOpenChange={(open) => !open && setBannerToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Excluir Banner?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja excluir este banner? Esta ação não pode ser
              desfeita e removerá a campanha do catálogo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteBanner}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Excluir Banner
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

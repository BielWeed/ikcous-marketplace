import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useCoupons } from "@/hooks/useCoupons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { cn } from "@/lib/utils";
import type { Coupon, View } from "@/types";
import { AnimatePresence, type Variants, motion } from "framer-motion";
import {
  AlertTriangle,
  Calendar,
  Check,
  Copy,
  Edit,
  HelpCircle,
  Plus,
  Sparkles,
  Ticket,
  Trash,
  TrendingUp,
  Users,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 100, damping: 15 },
  },
};

interface AdminCouponsViewProps {
  onNavigate: (view: View) => void;
  active?: boolean;
  onSetDirty?: (dirty: boolean) => void;
}

export const AdminCouponsView = memo(function AdminCouponsView({
  active = true,
  onSetDirty,
}: AdminCouponsViewProps) {
  const {
    coupons,
    loading,
    addCoupon,
    updateCoupon,
    deleteCoupon,
    refreshCoupons,
  } = useCoupons(true);
  const isOffline = useOnlineStatus();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [couponToDelete, setCouponToDelete] = useState<string | null>(null);

  const { ref: viewRef } = useScrollRestoration(
    "admin-coupons",
    active ?? false,
    coupons.length > 0,
  );

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando cupons...", {
        icon: "⚡",
      });
      refreshCoupons();
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, refreshCoupons]);

  const [formData, setFormData] = useState<Partial<Coupon>>({
    code: "",
    type: "percentage",
    value: 0,
    active: true,
    usageLimit: 0,
    minPurchase: 0,
  });

  // Reset modal and dialog states when active is false to prevent focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      setIsDialogOpen(false);
      setEditingCoupon(null);
      setCouponToDelete(null);
      setCopiedCode(null);
      setShowHelpModal(false);
    }
  }, [active]);

  // Controlar estado dirty do formulário para evitar descarte involuntário
  useEffect(() => {
    if (!onSetDirty) return;
    if (!isDialogOpen) {
      onSetDirty(false);
      return;
    }
    const initial = editingCoupon || {
      code: "",
      type: "percentage",
      value: 0,
      active: true,
      usageLimit: 0,
      minPurchase: 0,
    };

    const isDirty =
      (formData.code || "") !== (initial.code || "") ||
      formData.type !== initial.type ||
      Number(formData.value) !== Number(initial.value) ||
      formData.active !== initial.active ||
      Number(formData.usageLimit) !== Number(initial.usageLimit) ||
      Number(formData.minPurchase) !== Number(initial.minPurchase);

    onSetDirty(isDirty);
  }, [isDialogOpen, formData, editingCoupon, onSetDirty]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(`Código "${code}" copiado!`);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleOpenDialog = (coupon?: Coupon) => {
    if (coupon) {
      setEditingCoupon(coupon);
      setFormData({ ...coupon });
    } else {
      setEditingCoupon(null);
      setFormData({
        code: "",
        type: "percentage",
        value: 0,
        active: true,
        usageLimit: 0,
        minPurchase: 0,
      });
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para salvar ou alterar cupons.",
      });
      return;
    }

    const cleanCode = formData.code
      ? formData.code.trim().toUpperCase().replace(/\s+/g, "")
      : "";
    if (!cleanCode) {
      toast.error("O código do cupom é obrigatório.");
      return;
    }

    const value = formData.value ?? 0;
    const minPurchase = formData.minPurchase ?? 0;
    const usageLimit = formData.usageLimit ?? 0;

    if (value <= 0) {
      toast.error("O valor do desconto deve ser maior que zero.");
      return;
    }

    if (formData.type === "percentage" && value > 100) {
      toast.error(
        "O valor do desconto em porcentagem não pode ser maior que 100%.",
      );
      return;
    }

    if (minPurchase < 0) {
      toast.error("O valor mínimo de compra não pode ser negativo.");
      return;
    }

    if (usageLimit < 0) {
      toast.error("O limite de uso não pode ser negativo.");
      return;
    }

    const dataToSubmit = {
      ...formData,
      code: cleanCode,
    };

    try {
      if (editingCoupon) {
        await updateCoupon(editingCoupon.id, dataToSubmit);
      } else {
        await addCoupon(
          dataToSubmit as Required<Omit<Coupon, "id" | "usageCount">>,
        );
      }
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Erro ao salvar cupom:", error);
      toast.error("Erro ao salvar o cupom. Revise as regras de preenchimento.");
    }
  };

  const handleDelete = (id: string) => {
    if (isOffline) {
      toast.error("Sem conexão com a internet", {
        description: "Você precisa estar online para excluir cupons.",
      });
      return;
    }
    setCouponToDelete(id);
  };

  const confirmDeleteCoupon = async () => {
    if (!couponToDelete) return;
    try {
      await deleteCoupon(couponToDelete);
    } catch (error) {
      console.error("Error deleting coupon:", error);
      toast.error("Erro ao excluir o cupom.");
    } finally {
      setCouponToDelete(null);
    }
  };

  // Dynamic stats computation
  const totalCoupons = coupons.length;
  const activeCoupons = coupons.filter((c) => c.active).length;
  const totalUsage = coupons.reduce((sum, c) => sum + (c.usageCount || 0), 0);
  const averageDiscount = (() => {
    const percentageCoupons = coupons.filter((c) => c.type === "percentage");
    if (percentageCoupons.length === 0) return 0;
    const sum = percentageCoupons.reduce((acc, c) => acc + (c.value || 0), 0);
    return Math.round(sum / percentageCoupons.length);
  })();

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "ativos",
        label: "Cupons Ativos",
        icon: Ticket,
        iconClass: "text-emerald-400 animate-pulse",
        iconBg: "bg-emerald-500/10 border-emerald-500/20",
        hoverBorder:
          "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
        value: activeCoupons,
        accent: "text-emerald-400",
        subValue: `/ ${totalCoupons} total`,
        footer: "Disponíveis para uso",
      },
      {
        id: "uso",
        label: "Uso Total",
        icon: Users,
        iconClass: "text-sky-400",
        iconBg: "bg-zinc-900 border-white/5",
        hoverBorder:
          "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
        value: totalUsage,
        accent: "text-sky-400",
        footer: "Utilizações acumuladas",
      },
      {
        id: "desconto",
        label: "Desconto Médio",
        icon: TrendingUp,
        iconClass: "text-amber-400",
        iconBg: "bg-amber-500/10 border-amber-500/20",
        hoverBorder:
          "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
        value: `${averageDiscount}%`,
        accent: "text-amber-400",
        subValue: "OFF",
        footer: "Em ofertas percentuais",
      },
    ],
    [activeCoupons, totalCoupons, totalUsage, averageDiscount],
  );

  const renderSkeleton = () => (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="flex h-[256px] animate-pulse flex-col justify-between rounded-[2.5rem] border border-white/[0.05] bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 p-6 lg:p-8"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="size-12 animate-pulse rounded-2xl bg-white/5" />
              <div className="space-y-1.5">
                <Skeleton className="h-4.5 w-20 animate-pulse bg-white/5" />
                <Skeleton className="h-3 w-12 animate-pulse bg-white/5" />
              </div>
            </div>
            <Skeleton className="h-6 w-12 animate-pulse rounded-full bg-white/5" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4.5 w-full animate-pulse bg-white/5" />
            <Skeleton className="h-3 w-3/4 animate-pulse bg-white/5" />
          </div>
          <div className="flex items-center justify-between border-t border-white/5 pt-4">
            <Skeleton className="h-3 w-16 animate-pulse bg-white/5" />
            <Skeleton className="size-8 animate-pulse rounded-xl bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div
      ref={viewRef}
      className="relative h-auto bg-[#09090b] pb-8 font-sans text-zinc-400 duration-500 animate-in fade-in selection:bg-emerald-500/30 selection:text-emerald-200"
    >
      {/* Header */}
      <div className="sticky top-0 z-50 p-4 pb-0">
        <div className="admin-glass flex flex-col gap-4 rounded-[2rem] border border-white/5 p-4 shadow-2xl sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="flex items-center gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="flex select-none items-center gap-2 text-xl font-black uppercase tracking-tight text-white">
                  <span className="flex flex-nowrap items-baseline whitespace-nowrap">
                    <span className="italic text-white">Cupons</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                    title="Guia de Cupons e Ajuda"
                  >
                    <HelpCircle className="size-3.5" />
                  </button>
                </h1>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                Campanhas
                <span className="size-1 animate-pulse rounded-full bg-emerald-500/50" />
                <span className="text-emerald-400">Otimizar Conversões</span>
              </p>
            </div>
          </div>

          {coupons.length > 0 && (
            <button
              onClick={() => handleOpenDialog()}
              disabled={isOffline}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white px-5 py-2.5 text-[9px] font-black uppercase tracking-wider text-black shadow-lg shadow-white/5 transition-all hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale sm:w-auto"
            >
              <Plus className="size-3.5" /> Novo Cupom
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-7xl p-4 lg:p-8">
        {/* Stats Carousel Row */}
        {(coupons.length > 0 || loading) && (
          <div className="mb-8 space-y-4">
            <AdminKpiCarousel
              cards={kpiCards}
              loading={loading}
              active={active}
              title="Métricas de Campanhas"
            />
          </div>
        )}

        <AnimatePresence mode="wait">
          {loading && coupons.length === 0 ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="py-6"
            >
              {renderSkeleton()}
            </motion.div>
          ) : coupons.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative flex flex-col items-center justify-center overflow-hidden rounded-[3rem] border border-white/5 bg-zinc-900/10 px-6 py-20 backdrop-blur-md"
            >
              {/* Ambient radial glow background */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-[350px] w-[350px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/5 blur-[100px]" />

              {/* Premium Ticket Graphic */}
              <div className="relative mb-6 flex size-28 items-center justify-center">
                {/* Ambient glow */}
                <div className="absolute inset-0 animate-pulse rounded-full bg-emerald-500/10 blur-xl" />

                {/* Floating decorative stars */}
                <motion.div
                  animate={{
                    y: [0, -4, 0],
                    rotate: [0, 10, 0],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                  className="absolute right-0 top-0 text-emerald-400/80"
                >
                  <Sparkles className="size-4" />
                </motion.div>
                <motion.div
                  animate={{
                    y: [0, 4, 0],
                    rotate: [0, -10, 0],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                    delay: 0.5,
                  }}
                  className="absolute bottom-0 left-0 text-emerald-500/40"
                >
                  <Sparkles className="size-3" />
                </motion.div>

                {/* Main Floating Ticket Container */}
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{
                    duration: 3.5,
                    repeat: Number.POSITIVE_INFINITY,
                    ease: "easeInOut",
                  }}
                  className="relative flex h-14 w-20 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-zinc-950 bg-gradient-to-br from-zinc-900 to-zinc-950 shadow-[0_8px_30px_rgb(0,0,0,0.5)]"
                >
                  {/* Ticket Cutouts (Notches) */}
                  <div className="absolute -left-2.5 top-1/2 z-10 size-5 -translate-y-1/2 rounded-full border border-white/10 bg-[#09090b]" />
                  <div className="absolute -right-2.5 top-1/2 z-10 size-5 -translate-y-1/2 rounded-full border border-white/10 bg-[#09090b]" />

                  {/* Ticket Perforation */}
                  <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/10" />

                  <Ticket className="size-6 text-emerald-400 drop-shadow-[0_0_10px_rgba(16,185,129,0.4)]" />
                </motion.div>
              </div>

              <h3 className="text-xl font-black uppercase tracking-tight text-white">
                Nenhum cupom ativo
              </h3>
              <p className="mt-2 max-w-sm text-center text-xs font-semibold leading-relaxed text-zinc-500">
                Crie cupons promocionais para incentivar as vendas no seu
                catálogo e aumentar suas conversões.
              </p>

              <button
                onClick={() => handleOpenDialog()}
                disabled={isOffline}
                className="mt-8 flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-[10px] font-black uppercase tracking-widest text-black shadow-xl shadow-white/5 transition-all hover:scale-[1.02] hover:bg-zinc-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale"
              >
                <Plus className="size-4" /> Criar Primeiro Cupom
              </button>
            </motion.div>
          ) : (
            <div
              className={cn(
                "transition-opacity duration-300",
                loading && "opacity-50 pointer-events-none",
              )}
            >
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
              >
                {coupons.map((coupon) => (
                  <motion.div
                    key={coupon.id}
                    variants={itemVariants}
                    layout
                    className="group relative"
                  >
                    {/* Glass Ticket Design */}
                    <div
                      className={`relative flex min-h-[320px] flex-col justify-between overflow-hidden rounded-[2.5rem] border border-white/5 bg-zinc-900/60 p-7 shadow-xl backdrop-blur-md transition-all duration-500 hover:border-white/10 hover:bg-zinc-900/80 hover:shadow-2xl ${!coupon.active ? "opacity-45 grayscale" : ""}`}
                    >
                      {/* Left Notch */}
                      <div className="pointer-events-none absolute -left-3.5 top-[40%] z-10 size-7 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />

                      {/* Right Notch */}
                      <div className="pointer-events-none absolute -right-3.5 top-[40%] z-10 size-7 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />

                      {/* Perforated Dashed Line */}
                      <div className="pointer-events-none absolute inset-x-4 top-[40%] -translate-y-1/2 border-t-2 border-dashed border-white/10" />

                      {/* Upper Section */}
                      <div className="pb-4">
                        <div className="mb-2 flex items-center justify-between gap-4">
                          <button
                            onClick={() => handleCopyCode(coupon.code)}
                            className="group/code flex max-w-[70%] items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-left transition-all hover:bg-white/[0.08] active:scale-95"
                            title="Copiar Código"
                          >
                            <span className="truncate font-mono text-lg font-black uppercase italic tracking-tighter text-white">
                              {coupon.code}
                            </span>
                            {copiedCode === coupon.code ? (
                              <Check className="size-3.5 shrink-0 text-emerald-400" />
                            ) : (
                              <Copy className="size-3.5 shrink-0 text-zinc-500 transition-colors group-hover/code:text-white" />
                            )}
                          </button>

                          <div className="flex items-center gap-2">
                            <div
                              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[8px] font-black uppercase tracking-widest ${
                                coupon.active
                                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                                  : "border-zinc-500/20 bg-zinc-500/10 text-zinc-500"
                              }`}
                            >
                              <div
                                className={`size-1 rounded-full ${coupon.active ? "animate-pulse bg-emerald-400" : "bg-zinc-600"}`}
                              />
                              {coupon.active ? "Ativo" : "Inativo"}
                            </div>
                            <Switch
                              checked={coupon.active}
                              disabled={isOffline}
                              onCheckedChange={async (checked) => {
                                try {
                                  await updateCoupon(coupon.id, {
                                    active: checked,
                                  });
                                } catch (err) {
                                  console.error(err);
                                }
                              }}
                              className="origin-right scale-75 data-[state=checked]:bg-emerald-500"
                            />
                          </div>
                        </div>

                        <div className="mt-2 flex items-center gap-1.5 text-[8px] font-extrabold uppercase tracking-widest text-zinc-500">
                          <Sparkles className="size-3 text-amber-500" />
                          {coupon.type === "percentage"
                            ? "Desconto Percentual"
                            : "Desconto Fixo"}
                        </div>
                      </div>

                      {/* Lower Section */}
                      <div className="mt-4 flex flex-1 flex-col justify-between pt-6">
                        <div>
                          <div className="mb-4 grid grid-cols-2 gap-4">
                            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5">
                              <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                                Desconto
                              </p>
                              <p className="text-xl font-black italic text-white">
                                {coupon.type === "percentage"
                                  ? `${coupon.value ?? 0}% OFF`
                                  : `R$ ${Number(coupon.value ?? 0).toFixed(2)}`}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3.5 text-right">
                              <p className="mb-1 text-[8px] font-black uppercase tracking-widest text-zinc-500">
                                Mínimo Compra
                              </p>
                              <p className="text-xl font-black text-zinc-400">
                                {coupon.minPurchase && coupon.minPurchase > 0
                                  ? `R$ ${Number(coupon.minPurchase).toFixed(0)}`
                                  : "R$ 0"}
                              </p>
                            </div>
                          </div>

                          {coupon.validUntil && (
                            <div className="mb-4 flex items-center gap-2 px-1">
                              <Calendar className="size-3.5 text-zinc-500" />
                              <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                                Expira em:{" "}
                                <span className="font-extrabold text-zinc-300">
                                  {new Date(
                                    coupon.validUntil,
                                  ).toLocaleDateString("pt-BR")}
                                </span>
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Progress / Utilization */}
                        <div className="mb-6 space-y-2">
                          <div className="flex items-center justify-between px-1">
                            <div className="flex items-center gap-1.5">
                              <Users className="size-3.5 text-zinc-500" />
                              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                                Aproveitamento
                              </span>
                            </div>
                            <span className="text-[9px] font-black text-white">
                              {coupon.usageCount}{" "}
                              <span className="text-zinc-600">
                                / {coupon.usageLimit || "∞"} usos
                              </span>
                            </span>
                          </div>
                          {coupon.usageLimit && coupon.usageLimit > 0 ? (
                            <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/5 bg-white/[0.02]">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{
                                  width: `${Math.min(((coupon.usageCount || 0) / coupon.usageLimit) * 100, 100)}%`,
                                }}
                                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]"
                              />
                            </div>
                          ) : (
                            <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/5 bg-white/[0.02]">
                              <div className="h-full w-[35%] animate-[pulse_2s_infinite] rounded-full bg-zinc-800" />
                            </div>
                          )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 border-t border-white/5 pt-4">
                          <button
                            onClick={() => handleOpenDialog(coupon)}
                            disabled={isOffline}
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-4 py-2.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:bg-white/10 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                          >
                            <Edit className="size-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => handleDelete(coupon.id)}
                            disabled={isOffline}
                            className="flex size-10 items-center justify-center rounded-xl border border-red-500/10 bg-red-500/10 text-red-400 transition-all duration-300 hover:bg-red-500 hover:text-white active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                          >
                            <Trash className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="custom-scrollbar max-h-[92vh] overflow-y-auto rounded-[2.5rem] border-white/10 bg-[#09090b] p-0 text-white sm:max-w-xl">
          <div className="w-full bg-gradient-to-b from-white/[0.02] to-transparent p-8 sm:p-10">
            <DialogHeader className="mb-8">
              <div className="mb-2 flex items-center gap-4">
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                  <Ticket className="size-6 text-emerald-400" />
                </div>
                <div className="text-left">
                  <DialogTitle className="text-2xl font-black tracking-tight">
                    {editingCoupon ? "Editar Campanha" : "Nova Campanha"}
                  </DialogTitle>
                  <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                    Configure os detalhes do seu cupom
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {isOffline && (
              <div className="text-red-450 mb-6 flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 duration-300 animate-in fade-in slide-in-from-top">
                <AlertTriangle className="size-5 shrink-0 text-red-400" />
                <div className="text-left">
                  <p className="text-[10px] font-black uppercase tracking-wider text-red-400">
                    Modo Offline Ativo
                  </p>
                  <p className="mt-1 text-[9px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                    Criação e edição de cupons estão temporariamente
                    desabilitadas.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-6">
              {/* Live Preview Block */}
              <div className="space-y-2 border-b border-white/5 pb-6">
                <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                  PRÉ-VISUALIZAÇÃO EM TEMPO REAL
                </span>

                <div className="relative flex min-h-[150px] flex-col justify-between overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-900/40 p-6 shadow-xl">
                  {/* Preview Left Notch */}
                  <div className="pointer-events-none absolute -left-3 top-[48%] z-10 size-6 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />
                  {/* Preview Right Notch */}
                  <div className="pointer-events-none absolute -right-3 top-[48%] z-10 size-6 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />
                  {/* Preview Dashed Line */}
                  <div className="pointer-events-none absolute inset-x-3 top-[48%] -translate-y-1/2 border-t-2 border-dashed border-white/10" />

                  {/* Preview Upper Section */}
                  <div className="flex items-center justify-between pb-3">
                    <div className="max-w-[65%] rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-1.5">
                      <span className="block truncate font-mono text-sm font-black uppercase italic tracking-tighter text-white">
                        {formData.code || "EX: CAMPANHA10"}
                      </span>
                    </div>
                    <div
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[7px] font-black uppercase tracking-widest ${
                        formData.active
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                          : "border-zinc-500/20 bg-zinc-500/10 text-zinc-500"
                      }`}
                    >
                      {formData.active ? "Ativo" : "Inativo"}
                    </div>
                  </div>

                  {/* Preview Lower Section */}
                  <div className="flex items-end justify-between pt-3">
                    <div>
                      <p className="mb-0.5 text-[7px] font-black uppercase tracking-widest text-zinc-500">
                        Desconto
                      </p>
                      <p className="text-xl font-black italic text-white">
                        {formData.type === "percentage"
                          ? `${formData.value || 0}% OFF`
                          : `R$ ${Number(formData.value || 0).toFixed(2)}`}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="mb-0.5 text-[7px] font-black uppercase tracking-widest text-zinc-500">
                        Mínimo Compra
                      </p>
                      <p className="text-sm font-bold text-zinc-400">
                        R$ {Number(formData.minPurchase || 0).toFixed(0)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full space-y-2">
                <Label
                  htmlFor="coupon-code"
                  className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                >
                  Código Promocional
                </Label>
                <LocalBufferedInput
                  id="coupon-code"
                  name="code"
                  value={formData.code || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      code: val.toUpperCase().trim().replace(/\s+/g, ""),
                    }))
                  }
                  placeholder="EX: VERÃO2026"
                  useShadcn={true}
                  disabled={isOffline}
                  className="h-14 w-full rounded-2xl border-white/10 bg-white/[0.03] text-lg font-black uppercase italic tracking-tight transition-all focus:border-emerald-500/30 focus:ring-emerald-500/20 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Modalidade
                  </span>
                  <div className="relative flex h-14 w-full overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                    <button
                      type="button"
                      onClick={() =>
                        !isOffline &&
                        setFormData({ ...formData, type: "percentage" })
                      }
                      disabled={isOffline}
                      className={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 ${formData.type === "percentage" ? "font-extrabold text-black" : "font-bold text-zinc-400 hover:text-white"}`}
                    >
                      Porcentagem (%)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        !isOffline &&
                        setFormData({ ...formData, type: "fixed" })
                      }
                      disabled={isOffline}
                      className={`relative z-10 flex flex-1 items-center justify-center gap-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all disabled:opacity-50 ${formData.type === "fixed" ? "font-extrabold text-black" : "font-bold text-zinc-400 hover:text-white"}`}
                    >
                      Valor Fixo (R$)
                    </button>

                    {/* Animated Pill Background */}
                    <motion.div
                      layoutId="modalidade-pill"
                      className="absolute inset-y-1 rounded-xl bg-white"
                      animate={{
                        left: formData.type === "percentage" ? "4px" : "50%",
                        right: formData.type === "percentage" ? "50%" : "4px",
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 320,
                        damping: 28,
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="coupon-value"
                    className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Valor do Desconto
                  </Label>
                  <LocalBufferedInput
                    id="coupon-value"
                    name="value"
                    type="number"
                    min={0}
                    max={formData.type === "percentage" ? 100 : undefined}
                    value={formData.value || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({ ...prev, value: Number(val) }))
                    }
                    useShadcn={true}
                    disabled={isOffline}
                    className="h-14 rounded-2xl border-white/10 bg-white/[0.03] text-lg font-black focus:ring-emerald-500/20 disabled:opacity-50"
                    placeholder="EX: 15"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label
                    htmlFor="coupon-min-purchase"
                    className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Pedido Mínimo (R$)
                  </Label>
                  <LocalBufferedInput
                    id="coupon-min-purchase"
                    name="minPurchase"
                    type="number"
                    min={0}
                    value={formData.minPurchase || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({
                        ...prev,
                        minPurchase: Number(val),
                      }))
                    }
                    useShadcn={true}
                    disabled={isOffline}
                    className="h-14 rounded-2xl border-white/10 bg-white/[0.03] font-bold disabled:opacity-50"
                    placeholder="EX: 50"
                  />
                </div>
                <div className="space-y-2">
                  <Label
                    htmlFor="coupon-usage-limit"
                    className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                  >
                    Limite de Uso
                  </Label>
                  <LocalBufferedInput
                    id="coupon-usage-limit"
                    name="usageLimit"
                    type="number"
                    min={0}
                    value={formData.usageLimit || ""}
                    onFlush={(val) =>
                      setFormData((prev) => ({
                        ...prev,
                        usageLimit: Number(val),
                      }))
                    }
                    useShadcn={true}
                    disabled={isOffline}
                    placeholder="0 = Ilimitado"
                    className="h-14 rounded-2xl border-white/10 bg-white/[0.03] font-bold disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="coupon-valid-until"
                  className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
                >
                  Data de Expiração (Opcional)
                </Label>
                <div className="relative">
                  <Calendar className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    id="coupon-valid-until"
                    name="validUntil"
                    type="date"
                    value={(() => {
                      if (!formData.validUntil) return "";
                      const d = new Date(formData.validUntil);
                      return !Number.isNaN(d.getTime())
                        ? d.toISOString().split("T")[0]
                        : "";
                    })()}
                    disabled={isOffline}
                    onChange={(e) => {
                      if (!e.target.value) {
                        setFormData({ ...formData, validUntil: undefined });
                        return;
                      }
                      const d = new Date(e.target.value);
                      if (!Number.isNaN(d.getTime())) {
                        setFormData({
                          ...formData,
                          validUntil: d.toISOString(),
                        });
                      }
                    }}
                    className="h-14 rounded-2xl border-white/10 bg-white/[0.03] pl-12 font-bold focus:ring-emerald-500/20 disabled:opacity-50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/[0.02] p-4">
                <div className="space-y-0.5 text-left">
                  <Label
                    htmlFor="coupon-active"
                    className="text-xs font-black uppercase italic tracking-tight text-white"
                  >
                    Status da Oferta
                  </Label>
                  <p className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                    Tornar este cupom disponível para uso
                  </p>
                </div>
                <Switch
                  id="coupon-active"
                  checked={formData.active}
                  disabled={isOffline}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, active: checked })
                  }
                  className="data-[state=checked]:bg-emerald-500"
                />
              </div>
            </div>

            <div className="mt-10 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
                className="h-14 flex-1 rounded-2xl border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:bg-white/10"
              >
                Cancelar
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isOffline}
                className="h-14 flex-[2] rounded-2xl bg-white text-[10px] font-black uppercase tracking-widest text-black shadow-xl shadow-white/5 transition-all hover:scale-[1.02] active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                Salvar Campanha
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Help Modal */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Campanhas Promocionais"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            Nesta tela você pode criar e gerenciar cupons de desconto para
            campanhas de marketing e promoções especiais da sua loja.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-emerald-500 pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Configurações dos Cupons
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Ticket className="size-4 text-emerald-500" />
                  Código do Cupom
                </div>
                <p className="text-xs text-zinc-400">
                  O texto digitado pelo cliente no checkout (ex: COMPRA10). Deve
                  ser curto, sem espaços e em letras maiúsculas.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Users className="size-4 text-sky-400" />
                  Limite de Uso & Mínimos
                </div>
                <p className="text-xs text-zinc-400">
                  Configure o valor mínimo de compra para ativação e o limite
                  total de usos permitidos (para evitar prejuízos).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Calendar className="size-4 text-amber-500" />
                  Validade
                </div>
                <p className="text-xs text-zinc-400">
                  Defina uma data limite. Após esse prazo, o cupom é desativado
                  automaticamente pelo sistema.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Sparkles className="size-4 text-indigo-400" />
                  Tipos de Desconto
                </div>
                <p className="text-xs text-zinc-400">
                  <strong className="text-white">Fixo:</strong> Subtrai um valor
                  em reais (ex: R$ 10).{" "}
                  <strong className="text-white">Percentual:</strong> Subtrai
                  uma porcentagem (ex: 10%).
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>

      {/* Decorative Elements */}
      <div className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">
        <div className="absolute left-[-10%] top-[-10%] size-2/5 rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] size-2/5 rounded-full bg-white/5 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 z-[-2] size-full -translate-x-1/2 -translate-y-1/2 bg-[#09090b]" />
      </div>

      {/* Diálogo de Confirmação de Exclusão de Cupom */}
      <AlertDialog
        open={couponToDelete !== null}
        onOpenChange={(open) => !open && setCouponToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-lg font-black uppercase tracking-tight text-white">
              Excluir Cupom?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-zinc-400">
              Tem certeza que deseja excluir este cupom? Esta ação não pode ser
              desfeita e invalidará o código para os clientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className="rounded-xl border border-0 border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-zinc-400 hover:bg-white/10 hover:text-white">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteCoupon}
              className="bg-rose-650 rounded-xl border-0 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
            >
              Excluir Cupom
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

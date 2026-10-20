import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  FOCO,
  INTERRUPTOR,
  PRIMARIO,
  SECUNDARIO,
  Selo,
} from "@/components/admin/coupons/apresentacao";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useCoupons } from "@/hooks/useCoupons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { copiarParaClipboard } from "@/lib/copiar-para-clipboard";
import {
  AVISO_CUPOM_PODE_COBRIR_A_COMPRA,
  AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP,
  cupomPodeCobrirACompraInteira,
} from "@/lib/cupom-que-cobre-a-compra";
import { formasPagamentoNaEntregaValidas } from "@/lib/formas-de-pagamento-na-entrega";
import { cn, formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { type RotuloDeCupom, rotuloDoCupom } from "@/utils/status-do-cupom";
import { AnimatePresence, type Variants, motion } from "framer-motion";
import {
  AlertCircle,
  Calendar,
  Check,
  ChevronDown,
  CloudOff,
  Copy,
  Edit,
  HelpCircle,
  LockKeyhole,
  Percent,
  Plus,
  RefreshCw,
  Ticket,
  Trash,
  TrendingUp,
  Users,
  Wallet,
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

// Aparência do selo de status por rótulo (achado do lote 1: cupom vencido
// não pode continuar com a mesma cara de "Ativo").
const classesDoSeloPorRotulo: Record<RotuloDeCupom, string> = {
  Ativo: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  Expirado: "border-orange-400/20 bg-orange-400/10 text-orange-300",
  Inativo: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
  Esgotado: "border-zinc-500/20 bg-zinc-500/10 text-zinc-400",
};

interface AdminCouponsViewProps {
  onNavigate: (view: View, id?: string) => void;
  active?: boolean;
}

export const AdminCouponsView = memo(function AdminCouponsView({
  onNavigate,
  active = true,
}: AdminCouponsViewProps) {
  const {
    coupons,
    loading,
    erroDaListagem,
    updateCoupon,
    deleteCoupon,
    refreshCoupons,
  } = useCoupons(true);
  const isOffline = useOnlineStatus();
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  // Mesma regra do formulario: sem nenhuma forma 'na retirada/entrega', a loja
  // so recebe pelo app e um cupom que zera a compra deixa a cliente sem caminho.
  const lojaSoRecebePeloApp =
    formasPagamentoNaEntregaValidas(config.formasPagamentoEntrega).length === 0;

  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  const [metricasAbertas, setMetricasAbertas] = useState(false);
  const [detalhesAbertos, setDetalhesAbertos] = useState<
    Record<string, boolean>
  >({});

  const handleToggleCoupons = async (checked: boolean) => {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    setIsUpdatingConfig(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue
      // em frente (ADMIN-010, #94).
      const salvou = await updateConfig({ enableCoupons: checked });
      if (!salvou) return;
      toast.success(
        checked
          ? "Cupons de desconto ativados no aplicativo"
          : "Cupons de desconto desativados no aplicativo",
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setIsUpdatingConfig(false);
    }
  };
  const [showHelpModal, setShowHelpModal] = useState(false);
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

  // Reset states when active is false to prevent focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      setCouponToDelete(null);
      setCopiedCode(null);
      setShowHelpModal(false);
    }
  }, [active]);

  // Laudo 0109 (A-8): a cópia só comemora se DEU certo — sem await/catch,
  // "copiado" em verde aparecia até com a API recusando.
  const handleCopyCode = async (code: string) => {
    const ok = await copiarParaClipboard(code);
    if (!ok) {
      toast.error("Não foi possível copiar.");
      return;
    }
    setCopiedCode(code);
    toast.success(`Código "${code}" copiado!`);
    setTimeout(() => setCopiedCode(null), 2000);
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
      // o toast de erro já foi dado no hook (useCoupons)
    } finally {
      setCouponToDelete(null);
    }
  };

  // Dynamic stats computation
  const totalCoupons = coupons.length;
  // Achado do lote 1: cupom vencido continuava contado aqui, mesmo o
  // servidor já recusando ele no checkout (`valid_until > now()`). O mesmo
  // vale para o cupom ESGOTADO (usos no teto): "Disponíveis para uso" é o
  // que o checkout ainda aceita — a mesma leitura do selo do card.
  const activeCoupons = coupons.filter(
    (c) => rotuloDoCupom(c) === "Ativo",
  ).length;
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
        iconClass: "text-violet-300",
        iconBg: "bg-violet-400/10 border-violet-400/20",
        hoverBorder: "hover:border-violet-400/30",
        value: `${averageDiscount}%`,
        accent: "text-violet-300",
        subValue: "OFF",
        footer: "Em ofertas percentuais",
      },
    ],
    [activeCoupons, totalCoupons, totalUsage, averageDiscount],
  );

  const renderSkeleton = () => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="flex min-h-[156px] animate-pulse flex-col justify-between gap-4 rounded-[20px] border border-white/10 bg-[#101013] p-3"
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
      className="pb-admin relative h-auto bg-[#08080A] font-sans text-zinc-400 duration-500 animate-in fade-in selection:bg-emerald-500/30 selection:text-emerald-200 lg:pb-12"
    >
      <div className="sticky top-0 z-20 bg-[#08080A]/95 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 [&_h1]:font-bold [&_h1]:normal-case [&_h1]:tracking-tight">
          <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-coupons"]} />
          {coupons.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("admin-coupon-form")}
              disabled={isOffline}
              className={PRIMARIO}
            >
              <Plus aria-hidden="true" className="size-5" /> Novo Cupom
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-7 px-5 py-3">
        <section aria-label="Métricas de Campanhas" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-400">
              Métricas de Campanhas
            </h2>
            <div className="flex gap-2">
              {(coupons.length > 0 || loading) && (
                <button
                  type="button"
                  aria-label={
                    metricasAbertas
                      ? "Recolher métricas"
                      : "Ver métricas de campanhas"
                  }
                  aria-expanded={metricasAbertas}
                  aria-controls="coupon-metrics"
                  onClick={() => setMetricasAbertas(!metricasAbertas)}
                  className={SECUNDARIO}
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={cn("size-5", metricasAbertas && "rotate-180")}
                  />
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                title="Guia de Cupons e Ajuda"
                aria-label="Guia de Cupons e Ajuda"
                className={`${SECUNDARIO} min-h-11 min-w-11`}
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-lg border border-violet-300/25 bg-violet-300/15"
                >
                  <HelpCircle className="size-5 text-violet-300" />
                </span>
              </button>
            </div>
          </div>
          {(coupons.length > 0 || loading) &&
            (metricasAbertas ? (
              <div
                id="coupon-metrics"
                className="rounded-[20px] border border-white/10 bg-[#101013] p-4 [&_.bg-admin-gold]:bg-zinc-300 [&_.text-admin-gold]:text-zinc-300 [&_.text-zinc-500]:text-zinc-400"
              >
                <AdminKpiCarousel
                  active={active}
                  cards={kpiCards}
                  loading={loading}
                  title="Campanhas · Otimizar Conversões"
                />
              </div>
            ) : (
              <div
                id="coupon-metrics"
                className="grid grid-cols-3 gap-3 rounded-[20px] border border-white/10 bg-[#101013] p-3"
              >
                {kpiCards.map((stat) => (
                  <div key={stat.id} className="flex min-w-0 flex-col gap-2">
                    <p className="order-2 text-xs leading-snug text-zinc-400">
                      {stat.label}
                    </p>
                    <div className="order-1 flex flex-wrap items-center gap-1.5">
                      <stat.icon
                        aria-hidden="true"
                        className={cn("size-5 shrink-0", stat.iconClass)}
                      />
                      {loading ? (
                        <Skeleton className="h-7 w-12 bg-zinc-800" />
                      ) : (
                        <span className="text-xl font-bold tabular-nums text-zinc-50">
                          {stat.value}
                          {stat.id === "ativos" && (
                            <span>
                              {" "}
                              / {totalCoupons}
                              <span className="sr-only"> total</span>
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </section>

        {configLoaded && (
          <section className="rounded-[20px] border border-white/10 bg-[#101013] p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor="enable-coupons-switch"
                  className="text-sm font-bold text-zinc-50"
                >
                  Cupons de Desconto
                </Label>
                <p
                  className={cn(
                    "mt-1 text-sm",
                    config.enableCoupons ? "text-teal-300" : "text-zinc-400",
                  )}
                >
                  No checkout · {config.enableCoupons ? "Ativo" : "Inativo"}
                </p>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[11px] text-zinc-400">Checkout</span>
                <Switch
                  id="enable-coupons-switch"
                  checked={config.enableCoupons}
                  onCheckedChange={handleToggleCoupons}
                  className={INTERRUPTOR}
                  disabled={isOffline || isUpdatingConfig}
                />
              </div>
              <button
                type="button"
                onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                aria-expanded={isDetailsExpanded}
                aria-controls="coupon-settings-help"
                className={SECUNDARIO}
              >
                Saiba mais
              </button>
            </div>
            <p className="sr-only">
              Permitir que clientes usem cupons no checkout.
            </p>
            {isUpdatingConfig && (
              <p role="status" className="mt-3 text-sm text-sky-300">
                Salvando... {config.enableCoupons ? "Ativo" : "Inativo"} até a
                confirmação.
              </p>
            )}
            {isDetailsExpanded && (
              <div
                id="coupon-settings-help"
                className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm leading-relaxed text-zinc-400"
              >
                <h3 className="font-bold text-zinc-50">Cupons no checkout</h3>
                <p>
                  Ativando esta opção, seus clientes poderão digitar códigos de
                  cupom (ex: GANHE10) no checkout para receber descontos
                  especiais.
                </p>
                <p>
                  Se desativado, o campo de cupom some do checkout e nenhum
                  desconto de cupom é aplicado em pedidos novos — nem para quem
                  já tinha aplicado um cupom antes. Pedidos já feitos não mudam.
                </p>
                <p>
                  Use isso para criar campanhas promocionais e incentivar novas
                  vendas!
                </p>
              </div>
            )}
          </section>
        )}
        {isOffline && (
          <div
            role="status"
            className="flex gap-3 rounded-[20px] border border-orange-300/20 bg-orange-300/5 p-4 text-sm leading-relaxed"
          >
            <CloudOff
              aria-hidden="true"
              className="size-5 shrink-0 text-orange-300"
            />
            <div>
              <p className="font-bold text-zinc-50">Você está offline</p>
              <p className="mt-1">
                Novo Cupom, editar, excluir e os interruptores aguardam conexão.
                Ajuda, Saiba mais e cópia continuam disponíveis.
              </p>
            </div>
          </div>
        )}
        {loading && coupons.length > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-sky-300"
          >
            <RefreshCw aria-hidden="true" className="size-4 animate-spin" />
            Atualizando cupons... Seus cupons continuam aqui.
          </p>
        )}

        {erroDaListagem ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-[20px] border border-red-300/20 bg-red-300/5 p-4 text-red-300"
          >
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm leading-relaxed">
              {erroDaListagem}
            </p>
            <button
              type="button"
              onClick={() => refreshCoupons()}
              disabled={loading}
              className={SECUNDARIO}
            >
              Tentar de novo
            </button>
          </div>
        ) : null}

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
          ) : coupons.length === 0 && !erroDaListagem ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="rounded-[20px] border border-white/10 bg-[#101013] p-5"
            >
              <Selo icone={Ticket} matiz="#FF91B9" />
              <h3 className="mt-5 text-2xl font-bold text-zinc-50">
                Nenhum cupom cadastrado
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Crie cupons promocionais para incentivar as vendas no seu
                catálogo e aumentar suas conversões.
              </p>
              <button
                type="button"
                onClick={() => onNavigate("admin-coupon-form")}
                disabled={isOffline}
                className={`${PRIMARIO} mt-5 w-full`}
              >
                <Plus aria-hidden="true" className="size-5" /> Criar Primeiro
                Cupom
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
                className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3"
              >
                {coupons.map((coupon) => {
                  const rotulo = rotuloDoCupom(coupon);
                  const aberto = Boolean(detalhesAbertos[coupon.id]);
                  const indisponivel =
                    rotulo === "Expirado" || rotulo === "Esgotado";
                  return (
                    <motion.div
                      key={coupon.id}
                      variants={itemVariants}
                      layout
                      className="group min-w-0 rounded-[20px] border border-white/10 bg-[#101013] p-3"
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyCode(coupon.code)}
                          title="Copiar Código"
                          aria-label={`Copiar código ${coupon.code}`}
                          className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#17171C] p-2 text-left ${FOCO}`}
                        >
                          <Selo
                            icone={
                              coupon.type === "percentage" ? Percent : Wallet
                            }
                            matiz={
                              coupon.active
                                ? coupon.type === "percentage"
                                  ? "#BAA0FF"
                                  : "#73BFFF"
                                : "#A1A1AD"
                            }
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 break-all text-base font-bold uppercase",
                              coupon.active ? "text-zinc-50" : "text-zinc-400",
                            )}
                          >
                            {coupon.code}
                          </span>
                          {copiedCode === coupon.code ? (
                            <Check
                              aria-hidden="true"
                              className="size-4 shrink-0 text-emerald-300"
                            />
                          ) : (
                            <Copy
                              aria-hidden="true"
                              className="size-4 shrink-0 text-zinc-400"
                            />
                          )}
                        </button>
                        <Switch
                          aria-label={`Ativação manual de ${coupon.code}`}
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
                          className={INTERRUPTOR}
                        />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p
                          className={cn(
                            "min-w-0 break-words text-2xl font-bold tabular-nums",
                            coupon.active ? "text-zinc-50" : "text-zinc-400",
                          )}
                        >
                          <span className="sr-only">Desconto </span>
                          {coupon.type === "percentage"
                            ? `${coupon.value ?? 0}% OFF`
                            : formatCurrency(Number(coupon.value ?? 0))}
                        </p>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${classesDoSeloPorRotulo[rotulo]}`}
                        >
                          {rotulo}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-relaxed text-zinc-400">
                        <span>
                          {coupon.validUntil ? (
                            <>
                              Expira em:{" "}
                              {new Date(coupon.validUntil).toLocaleDateString(
                                "pt-BR",
                              )}
                            </>
                          ) : (
                            "Aproveitamento"
                          )}
                        </span>
                        <span className="tabular-nums">
                          {coupon.usageCount} / {coupon.usageLimit || "∞"} usos
                        </span>
                      </div>
                      {indisponivel && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-orange-300">
                          <LockKeyhole
                            aria-hidden="true"
                            className="size-3.5"
                          />
                          {rotulo === "Expirado"
                            ? "Validade encerrada"
                            : "Limite atingido"}
                        </p>
                      )}
                      {cupomPodeCobrirACompraInteira(coupon) && (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-orange-300">
                          <AlertCircle
                            aria-hidden="true"
                            className="size-3.5 shrink-0"
                          />
                          Confira as formas de pagamento
                        </p>
                      )}
                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] gap-2">
                        <button
                          type="button"
                          aria-label={`Detalhes do cupom ${coupon.code}`}
                          aria-expanded={aberto}
                          aria-controls={`coupon-details-${coupon.id}`}
                          onClick={() =>
                            setDetalhesAbertos((prev) => ({
                              ...prev,
                              [coupon.id]: !prev[coupon.id],
                            }))
                          }
                          className={SECUNDARIO}
                        >
                          <ChevronDown
                            aria-hidden="true"
                            className={cn(
                              "size-4 shrink-0 text-zinc-400",
                              aberto && "rotate-180",
                            )}
                          />
                          {aberto ? "Recolher" : "Detalhes"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate("admin-coupon-form", coupon.id)
                          }
                          disabled={isOffline}
                          className={SECUNDARIO}
                        >
                          <Edit
                            aria-hidden="true"
                            className="size-4 shrink-0 text-sky-300"
                          />
                          Editar
                        </button>
                        <button
                          type="button"
                          aria-label={`Excluir cupom ${coupon.code}`}
                          onClick={() => handleDelete(coupon.id)}
                          disabled={isOffline}
                          className={`${SECUNDARIO} px-0`}
                        >
                          <Trash
                            aria-hidden="true"
                            className="size-5 text-red-400"
                          />
                        </button>
                      </div>
                      {aberto && (
                        <div
                          id={`coupon-details-${coupon.id}`}
                          className="mt-4 space-y-3 border-t border-white/10 pt-4 text-sm text-zinc-400"
                        >
                          <p className="break-all font-bold text-zinc-50">
                            {coupon.code}
                          </p>
                          <p>
                            {coupon.type === "percentage"
                              ? "Desconto Percentual"
                              : "Desconto Fixo"}
                          </p>
                          <div className="flex flex-wrap items-end justify-between gap-3">
                            <div>
                              <p className="text-xs">Mínimo Compra</p>
                              <p className="mt-1 text-lg font-bold tabular-nums text-zinc-50">
                                {formatCurrency(coupon.minPurchase || 0)}
                              </p>
                            </div>
                            {coupon.alcance === "vitrine" && (
                              <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2 py-1 text-xs font-semibold text-teal-300">
                                No checkout
                              </span>
                            )}
                            {coupon.alcance === "exclusivo" && (
                              <span className="rounded-full border border-violet-300/20 bg-violet-300/10 px-2 py-1 text-xs font-semibold text-violet-300">
                                Exclusivo
                              </span>
                            )}
                          </div>
                          <p>
                            Aproveitamento · {coupon.usageCount} /{" "}
                            {coupon.usageLimit || "∞"} usos
                          </p>
                          {coupon.usageLimit && coupon.usageLimit > 0 ? (
                            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className="h-full rounded-full bg-violet-300"
                                style={{
                                  width: `${Math.min(((coupon.usageCount || 0) / coupon.usageLimit) * 100, 100)}%`,
                                }}
                              />
                            </div>
                          ) : (
                            <p>Sem limite de utilizações.</p>
                          )}
                          <p>
                            Ativação manual ·{" "}
                            {coupon.active ? "Ligada" : "Desligada"}
                          </p>
                          {cupomPodeCobrirACompraInteira(coupon) && (
                            <p className="text-sm leading-relaxed text-orange-200">
                              {lojaSoRecebePeloApp
                                ? AVISO_CUPOM_PODE_COBRIR_E_LOJA_SO_NO_APP
                                : AVISO_CUPOM_PODE_COBRIR_A_COMPRA}
                            </p>
                          )}
                          {indisponivel && (
                            <div className="rounded-2xl border border-orange-300/20 bg-orange-300/5 p-3">
                              <p className="font-bold text-orange-300">
                                Cupom indisponível
                              </p>
                              <p className="mt-1 leading-relaxed">
                                A chave está ligada. Ajuste{" "}
                                {rotulo === "Expirado"
                                  ? "a validade"
                                  : "o limite de uso"}{" "}
                                para voltar a aceitar o cupom.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
              <p className="mt-5 text-xs text-zinc-400">
                {coupons.length} {coupons.length === 1 ? "cupom" : "cupons"} ·
                mais recentes primeiro.
              </p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Help Modal */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Campanhas Promocionais"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-400">
            Nesta tela você pode criar e gerenciar cupons de desconto para
            campanhas de marketing e promoções especiais da sua loja.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-emerald-500 pl-2 text-[11px] font-black uppercase tracking-[0.12em] text-zinc-400">
              Configurações dos Cupons
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-50">
                  <Selo icone={Ticket} matiz="#FF91B9" />
                  Código do Cupom
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  O texto digitado pelo cliente no checkout (ex: COMPRA10). Deve
                  ser curto, sem espaços e em letras maiúsculas.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-50">
                  <Selo icone={Users} matiz="#73BFFF" />
                  Limite de Uso & Mínimos
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  Configure o valor mínimo de compra para ativação e o limite
                  total de usos permitidos (para evitar prejuízos). Ao chegar no
                  limite, o selo muda para "Esgotado" e o cupom deixa de ser
                  aceito no checkout.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-50">
                  <Selo icone={Calendar} matiz="#FFA45C" />
                  Validade
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {/* Achado 16 da auditoria de 20/08/2026, terceira
                      ocorrência (não estava no relatório original): mesmo
                      erro das duas primeiras — o cupom nunca foi aceito no
                      carrinho, só no checkout. */}
                  Defina uma data limite. Depois dela, o cupom deixa de ser
                  aceito no checkout e o selo aqui muda para "Expirado" — a
                  chavinha de ativação continua sob seu controle manual.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-50">
                  <Selo icone={Percent} matiz="#BAA0FF" />
                  Tipos de Desconto
                </div>
                <p className="text-sm leading-relaxed text-zinc-400">
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

      {/* Diálogo de Confirmação de Exclusão de Cupom */}
      <AlertDialog
        open={couponToDelete !== null}
        onOpenChange={(open) => !open && setCouponToDelete(null)}
      >
        <AlertDialogContent className="max-w-md rounded-3xl border border-white/10 bg-zinc-950">
          <AlertDialogHeader>
            <Selo icone={Trash} matiz="#FF6868" />
            <AlertDialogTitle className="text-2xl font-bold text-zinc-50">
              Excluir Cupom?
            </AlertDialogTitle>
            <p className="break-all text-sm font-bold text-zinc-400">
              {coupons.find((coupon) => coupon.id === couponToDelete)?.code}
            </p>
            <AlertDialogDescription className="text-sm leading-relaxed text-zinc-400">
              Tem certeza que deseja excluir este cupom? Esta ação não pode ser
              desfeita e invalidará o código para os clientes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel className={SECUNDARIO}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteCoupon}
              className={SECUNDARIO}
            >
              Excluir Cupom
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

import { LazyImage } from "@/components/LazyImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  Edit3,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Plus,
  Printer,
  QrCode,
  Truck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { OrderReceipt } from "./OrderReceipt";
import { statusConfig } from "./OrderStatusBadge";

const statusFlow: OrderStatus[] = [
  "pending",
  "processing",
  "shipping",
  "delivered",
];

interface OrderDetailProps {
  order: Order;
  onBack?: () => void;
  onStatusChange: (
    orderId: string,
    status: OrderStatus,
  ) => Promise<void> | void;
  isOffline?: boolean;
}

const globalSkuCache: Record<string, string> = {};

export const OrderDetail = memo(function OrderDetail({
  order,
  onStatusChange,
  isOffline = false,
}: Readonly<OrderDetailProps>) {
  // Local state for instant UI update & inline editing
  const [localTrackingCode, setLocalTrackingCode] = useState(
    order.trackingCode || "",
  );
  const [isEditingTracking, setIsEditingTracking] = useState(false);
  const [trackingValue, setTrackingValue] = useState(order.trackingCode || "");
  const [isSavingTracking, setIsSavingTracking] = useState(false);

  const [localNotes, setLocalNotes] = useState(order.notes || "");
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(order.notes || "");
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  const [skus, setSkus] = useState<Record<string, string>>({});
  const [loadingSkus, setLoadingSkus] = useState(false);

  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);

  const handleStatusChange = async (
    orderId: string,
    nextStatus: OrderStatus,
  ) => {
    if (isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    try {
      await onStatusChange(orderId, nextStatus);
    } catch {
      // parent component handles/toasts the error
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Sync state with order changes (e.g. from realtime update)
  useEffect(() => {
    setLocalTrackingCode(order.trackingCode || "");
    setTrackingValue(order.trackingCode || "");
    setLocalNotes(order.notes || "");
    setNotesValue(order.notes || "");
  }, [order.trackingCode, order.notes]);

  const itemsSerialized = JSON.stringify(
    order.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId || null,
      quantity: item.quantity,
    })),
  );

  // Load product and variant SKUs
  useEffect(() => {
    const fetchSkus = async () => {
      try {
        const itemsList = JSON.parse(itemsSerialized) as {
          productId: string;
          variantId: string | null;
        }[];
        const productIds = itemsList.map((item) => item.productId);
        const variantIds = itemsList
          .map((item) => item.variantId)
          .filter((id): id is string => !!id);

        // Check cache first
        const missingProductIds = productIds.filter(
          (id) => !globalSkuCache[`prod-${id}`],
        );
        const missingVariantIds = variantIds.filter(
          (id) => !globalSkuCache[`var-${id}`],
        );

        if (missingProductIds.length === 0 && missingVariantIds.length === 0) {
          // All cached, set state immediately without spinner
          const cachedSkus: Record<string, string> = {};
          productIds.forEach((id) => {
            cachedSkus[`prod-${id}`] = globalSkuCache[`prod-${id}`];
          });
          variantIds.forEach((id) => {
            cachedSkus[`var-${id}`] = globalSkuCache[`var-${id}`];
          });
          setSkus(cachedSkus);
          return;
        }

        setLoadingSkus(true);

        // Fetch missing product SKUs
        if (missingProductIds.length > 0) {
          const { data: productsData } = await supabase
            .from("produtos")
            .select("id, codigo")
            .in("id", missingProductIds);

          productsData?.forEach((p) => {
            if (p.codigo) globalSkuCache[`prod-${p.id}`] = p.codigo;
          });
        }

        // Fetch missing variant SKUs
        if (missingVariantIds.length > 0) {
          const { data: variantsData } = await supabase
            .from("product_variants")
            .select("id, sku")
            .in("id", missingVariantIds);

          variantsData?.forEach((v) => {
            if (v.sku) globalSkuCache[`var-${v.id}`] = v.sku;
          });
        }

        // Build full result from cache
        const resultSkus: Record<string, string> = {};
        productIds.forEach((id) => {
          if (globalSkuCache[`prod-${id}`])
            resultSkus[`prod-${id}`] = globalSkuCache[`prod-${id}`];
        });
        variantIds.forEach((id) => {
          if (globalSkuCache[`var-${id}`])
            resultSkus[`var-${id}`] = globalSkuCache[`var-${id}`];
        });

        setSkus(resultSkus);
      } catch (err) {
        console.error("Error fetching SKUs:", err);
      } finally {
        setLoadingSkus(false);
      }
    };

    fetchSkus();
  }, [itemsSerialized]);

  const getNextStatus = (current: OrderStatus): OrderStatus | null => {
    const currentIndex = statusFlow.indexOf(current);
    if (currentIndex < statusFlow.length - 1) {
      return statusFlow[currentIndex + 1];
    }
    return null;
  };

  const nextStatus = getNextStatus(order.status);

  const statusesStepper: { key: OrderStatus; label: string; icon: any }[] = [
    { key: "pending", label: "Novo", icon: Package },
    { key: "processing", label: "Separação", icon: Clock },
    { key: "shipping", label: "Trânsito", icon: Truck },
    { key: "delivered", label: "Finalizado", icon: CheckCircle2 },
  ];

  const currentStepperIndex = statusFlow.indexOf(order.status);

  const fullAddress =
    `${order.customer.address || ""}, ${order.customer.number || ""} - ${order.customer.neighborhood || ""} ${order.customer.reference ? `(${order.customer.reference})` : ""}`.trim();

  const handleCopyAddress = () => {
    navigator.clipboard.writeText(fullAddress);
    setCopiedAddress(true);
    toast.success("Endereço copiado para a área de transferência!");
    setTimeout(() => setCopiedAddress(false), 2000);
  };

  const handleCopyTracking = () => {
    navigator.clipboard.writeText(localTrackingCode);
    setCopiedTracking(true);
    toast.success("Código de rastreamento copiado!");
    setTimeout(() => setCopiedTracking(false), 2000);
  };

  const handleSaveTracking = async () => {
    try {
      setIsSavingTracking(true);
      const { error } = await supabase
        .from("marketplace_orders")
        .update({ tracking_code: trackingValue.trim() || null })
        .eq("id", order.id);

      if (error) throw error;
      setLocalTrackingCode(trackingValue.trim());
      setIsEditingTracking(false);
      toast.success("Código de rastreamento salvo!");
    } catch (err) {
      console.error("Error saving tracking code:", err);
      toast.error("Erro ao salvar código de rastreamento.");
    } finally {
      setIsSavingTracking(false);
    }
  };

  const handleSaveNotes = async () => {
    try {
      setIsSavingNotes(true);
      const { error } = await supabase
        .from("marketplace_orders")
        .update({ notes: notesValue.trim() || null })
        .eq("id", order.id);

      if (error) throw error;
      setLocalNotes(notesValue.trim());
      setIsEditingNotes(false);
      toast.success("Notas operacionais salvas!");
    } catch (err) {
      console.error("Error saving notes:", err);
      toast.error("Erro ao salvar notas operacionais.");
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleWhatsAppDirect = () => {
    let phone = (order.customer?.whatsapp || "").replace(/\D/g, "");
    if (phone.length === 11 || phone.length === 10) {
      phone = `55${phone}`;
    }
    const message = `Olá ${order.customer?.name || "Cliente"}! Entramos em contato sobre o seu pedido #${order.id.slice(-6)}.`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    globalThis.open(url, "_blank");
  };

  return (
    <div className="min-h-screen bg-admin-bg pb-24 duration-500 animate-in fade-in">
      {/* Elite Sticky Header */}
      <div className="admin-glass sticky top-0 z-[60] border-b border-white/5 shadow-2xl backdrop-blur-3xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <h2 className="mb-1 flex items-center gap-1.5 text-[9px] font-black uppercase leading-none tracking-[0.2em] text-zinc-500">
                GESTÃO OPERACIONAL
                <div className="size-1 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              </h2>
              <h1 className="text-lg font-bold tracking-tighter text-white">
                Pedido{" "}
                <span className="text-admin-gold">#{order.id.slice(-6)}</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => globalThis.print()}
              className="size-10 rounded-xl border border-white/5 bg-white/5 p-0 text-white transition-all duration-300 hover:bg-white/10 active:scale-95"
              title="Imprimir Pedido"
            >
              <Printer className="size-5" />
            </Button>

            {order.status !== "cancelled" && order.status !== "delivered" && (
              <Button
                onClick={() => handleStatusChange(order.id, "cancelled")}
                disabled={isOffline || isUpdatingStatus}
                variant="ghost"
                className="size-10 rounded-xl border border-red-500/10 bg-red-500/5 p-0 text-red-400 transition-all duration-300 hover:bg-red-500/15 hover:text-red-300 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                title="Abortar Operação"
              >
                <XCircle className="size-5" />
              </Button>
            )}

            {nextStatus && order.status !== "cancelled" && (
              <Button
                onClick={() => handleStatusChange(order.id, nextStatus)}
                disabled={isOffline || isUpdatingStatus}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-admin-gold/20 bg-admin-gold/10 px-4 text-[10px] font-black uppercase tracking-wider text-admin-gold transition-all duration-300 hover:bg-admin-gold hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-40"
              >
                {isUpdatingStatus ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span className="hidden xs:inline">Processando</span>
                  </>
                ) : (
                  <>
                    <span>Avançar</span>
                    <span className="hidden sm:inline">
                      : {statusConfig[nextStatus].label}
                    </span>
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
        {/* Cancelled Banner */}
        {order.status === "cancelled" && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-950/20 p-4 text-red-400 duration-300 animate-in slide-in-from-top">
            <XCircle className="size-5 shrink-0" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wider">
                Operação Abortada / Cancelada
              </p>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                Este pedido foi cancelado e não pode prosseguir.
              </p>
            </div>
          </div>
        )}

        {/* Status Stepper Pipeline */}
        {order.status !== "cancelled" && (
          <div className="admin-glass relative overflow-hidden rounded-3xl border border-white/5 p-5 shadow-2xl md:p-6">
            <div className="relative flex w-full items-center justify-between">
              {/* Connecting Line Background */}
              <div className="absolute inset-x-6 top-1/2 z-0 h-[2px] -translate-y-1/2 bg-white/5" />
              <div
                className="absolute left-6 top-1/2 z-0 h-[2px] -translate-y-1/2 bg-admin-gold transition-all duration-500"
                style={{
                  width: `${currentStepperIndex >= 0 ? (currentStepperIndex / (statusesStepper.length - 1)) * 90 : 0}%`,
                }}
              />

              {statusesStepper.map((step, idx) => {
                const Icon = step.icon;
                const isCompleted = idx < currentStepperIndex;
                const isActive = idx === currentStepperIndex;
                const isFuture = idx > currentStepperIndex;

                return (
                  <div
                    key={step.key}
                    className="relative z-10 flex flex-1 flex-col items-center"
                  >
                    <div
                      className={cn(
                        "w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300",
                        isActive &&
                          "bg-zinc-950 border-admin-gold text-admin-gold shadow-[0_0_12px_rgba(234,179,8,0.3)] scale-110",
                        isCompleted &&
                          "bg-admin-gold border-admin-gold text-black",
                        isFuture && "bg-zinc-900 border-white/5 text-zinc-500",
                      )}
                    >
                      <Icon className="size-4" />
                    </div>
                    <span
                      className={cn(
                        "text-[8px] md:text-[9px] font-black uppercase tracking-wider mt-2 text-center",
                        isActive && "text-admin-gold font-black",
                        isCompleted && "text-zinc-300 font-bold",
                        isFuture && "text-zinc-500 font-medium",
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2-Column Layout */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Flow Column */}
          <div className="space-y-6 lg:col-span-2">
            {/* Customer Card */}
            <div className="admin-glass space-y-4 rounded-3xl border border-white/5 p-5">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <Users className="size-3.5 text-zinc-500" />
                  Dados do Cliente
                </h3>
                <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold text-emerald-400">
                  <span className="size-1 rounded-full bg-emerald-500" />
                  Portfólio Ativo
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Nome Completo
                  </p>
                  <p className="text-base font-bold leading-tight text-white">
                    {order.customer.name}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Contato Comercial
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm font-semibold text-white">
                      {order.customer.whatsapp}
                    </p>
                    <button
                      onClick={handleWhatsAppDirect}
                      disabled={isOffline}
                      className="rounded p-1 text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:text-emerald-300 disabled:pointer-events-none disabled:opacity-40"
                      title="Conversar no WhatsApp"
                    >
                      <MessageCircle className="size-4 fill-current" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="space-y-2 border-t border-white/5 pt-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">
                  Endereço de Entrega
                </p>
                <div className="flex flex-col justify-between gap-3 rounded-2xl border border-white/5 bg-zinc-950/40 p-3 md:flex-row md:items-start">
                  <p className="flex-1 text-xs uppercase leading-relaxed text-zinc-300">
                    {order.customer.address}, {order.customer.number}
                    <br />
                    <span className="text-[10px] normal-case text-zinc-400">
                      {order.customer.neighborhood}{" "}
                      {order.customer.reference
                        ? `• Ref: ${order.customer.reference}`
                        : ""}
                    </span>
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={handleCopyAddress}
                      className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 active:scale-95"
                      title="Copiar Endereço"
                    >
                      {copiedAddress ? (
                        <>
                          <Check className="size-3 text-emerald-400" />
                          Copiado
                        </>
                      ) : (
                        <>
                          <Copy className="size-3 text-zinc-400" />
                          Copiar
                        </>
                      )}
                    </button>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/5 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 active:scale-95"
                      title="Ver no Google Maps"
                    >
                      <MapPin className="size-3 text-zinc-400" />
                      Maps
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Order Items Assets */}
            <div className="admin-glass space-y-4 rounded-3xl border border-white/5 p-5">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <Package className="size-3.5 text-zinc-500" />
                  Itens do Pedido
                </h3>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-bold text-zinc-400">
                  {order.items.reduce((acc, item) => acc + item.quantity, 0)}{" "}
                  {order.items.reduce((acc, item) => acc + item.quantity, 0) ===
                  1
                    ? "Unidade"
                    : "Unidades"}
                </span>
              </div>
              <div className="divide-y divide-white/5">
                {order.items.map((item) => {
                  const itemSku = item.variantId
                    ? skus[`var-${item.variantId}`] ||
                      skus[`prod-${item.productId}`]
                    : skus[`prod-${item.productId}`];

                  return (
                    <div
                      key={`${item.productId}-${item.variantId || "default"}`}
                      className="group/item flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                    >
                      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-white/10 shadow-lg">
                        <LazyImage
                          src={item.image}
                          alt={item.name}
                          className="group-hover/item:scale-115 size-full object-cover transition-transform duration-500"
                        />
                        <div className="absolute right-0.5 top-0.5 rounded-md border border-white/10 bg-black/85 px-1.5 py-0.5 text-[8px] font-black text-white">
                          {item.quantity}X
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-bold text-white transition-colors group-hover/item:text-admin-gold">
                          {item.name}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="rounded border border-white/5 bg-white/5 px-1.5 py-0.5 text-[9px] font-bold text-zinc-400">
                            R${" "}
                            {item.price.toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                          {loadingSkus ? (
                            <span className="animate-pulse font-mono text-[8px] text-zinc-600">
                              Carregando SKU...
                            </span>
                          ) : itemSku ? (
                            <span className="rounded border border-admin-gold/20 bg-admin-gold/10 px-1.5 py-0.5 font-mono text-[8px] font-black uppercase tracking-wider text-admin-gold">
                              SKU: {itemSku}
                            </span>
                          ) : (
                            <span className="font-mono text-[8px] uppercase text-zinc-500">
                              ID: #{item.productId.slice(-6)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs font-black tabular-nums text-white">
                          R${" "}
                          {(
                            (item.price || 0) * (item.quantity || 0)
                          ).toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Financial & Logistics Column */}
          <div className="space-y-6">
            {/* High-Performance Finance Card */}
            <div className="group relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-950 p-6 text-white shadow-2xl">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <DollarSign className="size-4 text-admin-gold" />
                  Consolidado Financeiro
                </h3>
              </div>

              <div className="relative z-10 space-y-4">
                <div className="flex justify-between text-xs font-bold text-zinc-400">
                  <span className="uppercase tracking-widest">
                    Subtotal Bruto
                  </span>
                  <span className="font-mono">
                    R${" "}
                    {(order?.subtotal || 0).toLocaleString("pt-BR", {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>

                {(order?.discount > 0 || order?.couponCode) && (
                  <div className="flex justify-between text-xs font-bold text-amber-500">
                    <span className="flex items-center gap-1.5 uppercase tracking-widest">
                      Desconto
                      {order.couponCode && (
                        <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber-500">
                          {order.couponCode}
                        </span>
                      )}
                    </span>
                    <span className="font-mono">
                      - R${" "}
                      {(order?.discount || 0).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                )}

                <div className="flex justify-between text-xs font-bold text-emerald-400">
                  <span className="uppercase tracking-widest">
                    Taxa Logística
                  </span>
                  <span className="font-mono">
                    {(order?.shipping || 0) === 0
                      ? "BONIFICADO"
                      : `R$ ${(order?.shipping || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`}
                  </span>
                </div>

                <div className="mt-4 border-t border-white/10 pt-4">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <span className="mb-1 block text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">
                        Montante Final
                      </span>
                      <span className="text-3xl font-black tracking-tighter text-white">
                        <span className="mr-1 text-lg text-admin-gold">R$</span>
                        {(order?.total || 0).toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 p-3">
                    <div className="shrink-0 rounded-xl bg-emerald-500/15 p-2">
                      <QrCode className="size-4 text-emerald-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[8px] font-black uppercase leading-none tracking-widest text-zinc-500">
                        Liquidação
                      </p>
                      <p className="mt-1 truncate text-xs font-bold uppercase tracking-tight text-white">
                        {(() => {
                          if (order.paymentMethod === "pix") return "Rede PIX";
                          if (order.paymentMethod === "card")
                            return "Rede Crédito";
                          return "Dinheiro Espécie";
                        })()}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Decorative Background Glow */}
              <div className="absolute right-0 top-0 size-32 bg-admin-gold opacity-5 blur-[100px]" />
            </div>

            {/* Logistics & Tracking Card */}
            <div className="admin-glass space-y-4 rounded-[2rem] border border-white/5 p-5">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <Truck className="size-3.5 text-zinc-500" />
                  Logística & Rastreio
                </h3>
              </div>

              {isEditingTracking ? (
                <div className="space-y-3 duration-300 animate-in fade-in">
                  <div className="space-y-1">
                    <label
                      htmlFor="tracking-input"
                      className="text-[8px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      Código de Rastreamento
                    </label>
                    <Input
                      id="tracking-input"
                      value={trackingValue}
                      onChange={(e) =>
                        setTrackingValue(e.target.value.toUpperCase())
                      }
                      placeholder="EX: BR123456789BR"
                      className="h-10 rounded-xl border-white/10 bg-zinc-950 font-mono text-xs text-white focus:border-admin-gold/30"
                      disabled={isSavingTracking}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setTrackingValue(localTrackingCode);
                        setIsEditingTracking(false);
                      }}
                      className="h-8 rounded-lg px-2.5 text-zinc-400 hover:text-white"
                      disabled={isSavingTracking}
                    >
                      <X className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveTracking}
                      className="flex h-8 items-center gap-1 rounded-lg bg-admin-gold px-3 text-[9px] font-black uppercase tracking-wider text-black hover:bg-admin-gold/90"
                      disabled={isSavingTracking}
                    >
                      {isSavingTracking ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {localTrackingCode ? (
                    <div className="space-y-2">
                      <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                        Código Cadastrado
                      </p>
                      <div className="flex items-center justify-between rounded-xl border border-white/5 bg-zinc-950/40 p-2.5">
                        <span className="select-all font-mono text-xs font-bold tracking-widest text-white">
                          {localTrackingCode}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={handleCopyTracking}
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                            title="Copiar Código"
                          >
                            {copiedTracking ? (
                              <Check className="size-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                          <a
                            href={`https://linkrastreio.com/?codigo=${localTrackingCode}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
                            title="Rastrear nos Correios"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                          <button
                            onClick={() => setIsEditingTracking(true)}
                            disabled={isOffline}
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                            title="Editar Código"
                          >
                            <Edit3 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/5 bg-zinc-950/20 p-4 text-center">
                      <p className="text-[10px] font-medium text-zinc-500">
                        Nenhum código de rastreamento cadastrado.
                      </p>
                      <Button
                        onClick={() => setIsEditingTracking(true)}
                        disabled={isOffline}
                        className="flex h-8 items-center gap-1 rounded-lg border border-white/5 bg-white/5 px-3 text-[9px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Plus className="size-3.5" />
                        Adicionar Rastreio
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Operative Notes */}
            <div className="admin-glass space-y-4 rounded-[2rem] border border-white/5 p-5">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <h3 className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                  <MessageCircle className="size-3.5 text-zinc-500" />
                  Notas Operacionais
                </h3>
              </div>

              {isEditingNotes ? (
                <div className="space-y-3 duration-300 animate-in fade-in">
                  <div className="space-y-1">
                    <label
                      htmlFor="notes-textarea"
                      className="text-[8px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      Anotações Internas
                    </label>
                    <textarea
                      id="notes-textarea"
                      value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      placeholder="Ex: Cliente solicitou entrega após as 18h..."
                      className="h-20 w-full resize-none rounded-xl border border-white/10 bg-zinc-950 p-3 text-xs text-white focus:border-admin-gold/30 focus:outline-none"
                      disabled={isSavingNotes}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setNotesValue(localNotes);
                        setIsEditingNotes(false);
                      }}
                      className="h-8 rounded-lg px-2.5 text-zinc-400 hover:text-white"
                      disabled={isSavingNotes}
                    >
                      <X className="size-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveNotes}
                      className="flex h-8 items-center gap-1 rounded-lg bg-admin-gold px-3 text-[9px] font-black uppercase tracking-wider text-black hover:bg-admin-gold/90"
                      disabled={isSavingNotes}
                    >
                      {isSavingNotes ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {localNotes ? (
                    <div className="space-y-3">
                      <p className="rounded-2xl border border-amber-500/10 bg-amber-500/5 p-3 text-xs font-medium italic leading-relaxed text-amber-200">
                        "{localNotes}"
                      </p>
                      <div className="flex justify-end">
                        <Button
                          onClick={() => setIsEditingNotes(true)}
                          disabled={isOffline}
                          className="flex h-8 items-center gap-1 rounded-lg border border-white/5 bg-white/5 px-3 text-[9px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                        >
                          <Edit3 className="size-3.5 text-zinc-400" />
                          Editar Notas
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/5 bg-zinc-950/20 p-4 text-center">
                      <p className="text-[10px] font-medium text-zinc-500">
                        Nenhuma nota cadastrada para este pedido.
                      </p>
                      <Button
                        onClick={() => setIsEditingNotes(true)}
                        disabled={isOffline}
                        className="flex h-8 items-center gap-1 rounded-lg border border-white/5 bg-white/5 px-3 text-[9px] font-bold uppercase tracking-wider text-white transition-all hover:bg-white/10 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Plus className="size-3.5" />
                        Adicionar Nota
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Order Receipt for Printing */}
      <OrderReceipt order={order} />
    </div>
  );
});

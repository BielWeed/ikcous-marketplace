import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCoupons } from "@/hooks/useCoupons";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn, formatCurrency } from "@/lib/utils";
import type { Coupon, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { AlertTriangle, Calendar, Ticket } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";

interface AdminCouponFormViewProps {
  couponId?: string;
  onNavigate: (view: View, id?: string) => void;
  onSetDirty?: (dirty: boolean) => void;
}

export const AdminCouponFormView = memo(function AdminCouponFormView({
  couponId,
  onNavigate,
  onSetDirty,
}: AdminCouponFormViewProps) {
  const { coupons, addCoupon, updateCoupon } = useCoupons(true);
  const isOffline = useOnlineStatus();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<Partial<Coupon>>({
    code: "",
    type: "percentage",
    value: 0,
    active: true,
    usageLimit: 0,
    minPurchase: 0,
  });

  const [initialData, setInitialData] = useState<Partial<Coupon>>({
    code: "",
    type: "percentage",
    value: 0,
    active: true,
    usageLimit: 0,
    minPurchase: 0,
  });

  const editingCoupon = couponId
    ? coupons.find((c) => c.id === couponId)
    : null;

  // Initialize form data when editing a coupon
  useEffect(() => {
    if (couponId && coupons.length > 0) {
      const editing = coupons.find((c) => c.id === couponId);
      if (editing) {
        const data = {
          code: editing.code,
          type: editing.type,
          value: editing.value,
          minPurchase: editing.minPurchase || 0,
          usageLimit: editing.usageLimit || 0,
          validUntil: editing.validUntil,
          active: editing.active,
        };
        setFormData(data);
        setInitialData(data);
      }
    }
  }, [couponId, coupons]);

  // Track form dirty state to prevent accidental discards
  useEffect(() => {
    if (!onSetDirty) return;
    const isDirty =
      (formData.code || "") !== (initialData.code || "") ||
      formData.type !== initialData.type ||
      Number(formData.value) !== Number(initialData.value) ||
      formData.active !== initialData.active ||
      Number(formData.usageLimit) !== Number(initialData.usageLimit) ||
      Number(formData.minPurchase) !== Number(initialData.minPurchase) ||
      formData.validUntil !== initialData.validUntil;

    onSetDirty(isDirty);
  }, [formData, initialData, onSetDirty]);

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

    setIsSubmitting(true);
    try {
      if (editingCoupon) {
        await updateCoupon(editingCoupon.id, dataToSubmit);
      } else {
        await addCoupon(
          dataToSubmit as Required<Omit<Coupon, "id" | "usageCount">>,
        );
      }
      if (onSetDirty) onSetDirty(false); // Reset dirty state before navigating
      onNavigate("admin-coupons");
    } catch (error) {
      console.error("Erro ao salvar cupom:", error);
      toast.error("Erro ao salvar o cupom. Revise as regras de preenchimento.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    haptic.light();
    onNavigate("admin-coupons");
  };

  return (
    <div className="relative min-h-screen bg-[#09090b] pb-admin lg:pb-12 font-sans text-zinc-400">
      {/* Action Header bar inside the view */}
      <div className="sticky top-0 z-40 p-4 pb-0">
        <div className="admin-glass flex items-center justify-between rounded-[2rem] border border-white/5 p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-sm font-black uppercase tracking-tight text-white">
                {editingCoupon ? "Editar Cupom" : "Novo Cupom"}
              </h1>
              <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
                Configure os detalhes do seu cupom de desconto
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2">
              <Ticket className="size-4.5 text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-xl p-4 mt-2 space-y-4">
        {isOffline && (
          <div className="text-red-450 flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 duration-300 animate-in fade-in slide-in-from-top">
            <AlertTriangle className="size-5 shrink-0 text-red-400" />
            <div className="text-left">
              <p className="text-[10px] font-black uppercase tracking-wider text-red-400">
                Modo Offline Ativo
              </p>
              <p className="mt-1 text-[9px] font-bold uppercase leading-none tracking-widest text-zinc-500">
                Criação e edição de cupons estão temporariamente desabilitadas.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-4 rounded-3xl border border-white/5 bg-zinc-950/20 p-5 sm:p-6 backdrop-blur-md shadow-xl">
          {/* Live Preview Block */}
          <div className="space-y-2 border-b border-white/5 pb-4">
            <div className="relative flex min-h-[110px] flex-col justify-between overflow-hidden rounded-2xl border border-emerald-500/10 bg-gradient-to-br from-emerald-500/10 via-zinc-900/40 to-zinc-950/60 p-4 shadow-lg">
              {/* Preview Left Notch */}
              <div className="pointer-events-none absolute -left-2.5 top-[48%] z-10 size-5 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />
              {/* Preview Right Notch */}
              <div className="pointer-events-none absolute -right-2.5 top-[48%] z-10 size-5 -translate-y-1/2 rounded-full border border-white/5 bg-[#09090b]" />
              {/* Preview Dashed Line */}
              <div className="pointer-events-none absolute inset-x-2.5 top-[48%] -translate-y-1/2 border-t border-dashed border-white/10" />

              {/* Preview Upper Section */}
              <div className="flex items-center justify-between pb-2">
                <div className="max-w-[70%] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1">
                  <span className="block truncate font-mono text-xs font-black uppercase italic tracking-tighter text-white">
                    {formData.code || "CUPOMEXEMPLO"}
                  </span>
                </div>
                <div
                  className={cn(
                    "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[6px] font-black uppercase tracking-widest",
                    formData.active
                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
                      : "border-zinc-500/20 bg-zinc-500/10 text-zinc-500",
                  )}
                >
                  {formData.active ? "Ativo" : "Inativo"}
                </div>
              </div>

              {/* Preview Lower Section */}
              <div className="flex items-end justify-between pt-2">
                <div>
                  <p className="mb-0.5 text-[7px] font-black uppercase tracking-widest text-zinc-500">
                    Desconto
                  </p>
                  <p className="text-base font-black italic text-white leading-none">
                    {formData.type === "percentage"
                      ? `${formData.value || 0}% OFF`
                      : `R$ ${Number(formData.value || 0).toFixed(2)}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="mb-0.5 text-[7px] font-black uppercase tracking-widest text-zinc-500">
                    Mínimo Compra
                  </p>
                  <p className="text-xs font-bold text-zinc-400 leading-none">
                    {/* Achado 15 da auditoria de 20/08/2026 — mesmo defeito
                        do card em AdminCouponsView.tsx: `.toFixed(0)`
                        arredondava R$ 49,90 para "R$ 50". */}
                    {formatCurrency(formData.minPurchase || 0)}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-[9px] font-medium tracking-wide text-zinc-500 text-center select-none uppercase">
              Visualização em tempo real do cupom
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Promo Code & Status switch */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label
                  htmlFor="coupon-code"
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  Código do Cupom
                </Label>
                <LocalBufferedInput
                  id="coupon-code"
                  name="code"
                  autoComplete="off"
                  value={formData.code || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      code: val.toUpperCase().trim().replace(/\s+/g, ""),
                    }))
                  }
                  placeholder="EX: VERÃO10"
                  useShadcn={true}
                  disabled={isOffline || isSubmitting}
                  className="h-11 w-full rounded-xl border-white/10 bg-white/[0.03] text-sm font-bold uppercase italic tracking-tight transition-all focus:border-emerald-500/30 focus:ring-emerald-500/20 disabled:opacity-50"
                />
              </div>
              <div className="w-[100px] space-y-1.5 shrink-0">
                <Label
                  htmlFor="coupon-active"
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 block text-center"
                >
                  Ativar?
                </Label>
                <div className="flex h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3">
                  <Switch
                    id="coupon-active"
                    checked={formData.active}
                    disabled={isOffline || isSubmitting}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, active: checked })
                    }
                    className="data-[state=checked]:bg-emerald-500 scale-90"
                  />
                </div>
              </div>
            </div>

            {/* Type & Value */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500 block">
                  Tipo de Desconto
                </span>
                <div className="relative flex h-11 w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.03] p-1 select-none">
                  <button
                    type="button"
                    onClick={() =>
                      !isOffline &&
                      !isSubmitting &&
                      setFormData({ ...formData, type: "percentage" })
                    }
                    disabled={isOffline || isSubmitting}
                    className={cn(
                      "relative z-10 flex flex-1 items-center justify-center rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-50",
                      formData.type === "percentage"
                        ? "font-extrabold text-black"
                        : "font-bold text-zinc-400 hover:text-white",
                    )}
                  >
                    %
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      !isOffline &&
                      !isSubmitting &&
                      setFormData({ ...formData, type: "fixed" })
                    }
                    disabled={isOffline || isSubmitting}
                    className={cn(
                      "relative z-10 flex flex-1 items-center justify-center rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all disabled:opacity-50",
                      formData.type === "fixed"
                        ? "font-extrabold text-black"
                        : "font-bold text-zinc-400 hover:text-white",
                    )}
                  >
                    R$
                  </button>

                  {/* Simulated pill position */}
                  <div
                    className={cn(
                      "absolute inset-y-1 rounded-lg bg-white transition-all duration-300",
                      formData.type === "percentage"
                        ? "left-[4px] right-[50%]"
                        : "left-[50%] right-[4px]",
                    )}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="coupon-value"
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  {formData.type === "percentage" ? "Valor (%)" : "Valor (R$)"}
                </Label>
                <LocalBufferedInput
                  id="coupon-value"
                  name="value"
                  type="number"
                  autoComplete="off"
                  min={0}
                  max={formData.type === "percentage" ? 100 : undefined}
                  value={formData.value || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({ ...prev, value: Number(val) }))
                  }
                  useShadcn={true}
                  disabled={isOffline || isSubmitting}
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-sm font-bold focus:ring-emerald-500/20 disabled:opacity-50"
                  placeholder="EX: 15"
                />
              </div>
            </div>

            {/* Min Purchase & Limit */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="coupon-min-purchase"
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  Mínimo de Compra
                </Label>
                <LocalBufferedInput
                  id="coupon-min-purchase"
                  name="minPurchase"
                  type="number"
                  autoComplete="off"
                  min={0}
                  value={formData.minPurchase || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      minPurchase: Number(val),
                    }))
                  }
                  useShadcn={true}
                  disabled={isOffline || isSubmitting}
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-sm font-bold disabled:opacity-50"
                  placeholder="EX: 50"
                />
              </div>
              <div className="space-y-1.5">
                <Label
                  htmlFor="coupon-usage-limit"
                  className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
                >
                  Limite de Uso
                </Label>
                <LocalBufferedInput
                  id="coupon-usage-limit"
                  name="usageLimit"
                  type="number"
                  autoComplete="off"
                  min={0}
                  value={formData.usageLimit || ""}
                  onFlush={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      usageLimit: Number(val),
                    }))
                  }
                  useShadcn={true}
                  disabled={isOffline || isSubmitting}
                  placeholder="0 = Ilimitado"
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-sm font-bold disabled:opacity-50"
                />
              </div>
            </div>

            {/* Validity date */}
            <div className="space-y-1.5">
              <Label
                htmlFor="coupon-valid-until"
                className="ml-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"
              >
                Validade (Opcional)
              </Label>
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <Input
                  id="coupon-valid-until"
                  name="validUntil"
                  type="date"
                  autoComplete="off"
                  value={(() => {
                    if (!formData.validUntil) return "";
                    const d = new Date(formData.validUntil);
                    return !Number.isNaN(d.getTime())
                      ? d.toISOString().split("T")[0]
                      : "";
                  })()}
                  disabled={isOffline || isSubmitting}
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
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] pl-10 text-sm font-bold focus:ring-emerald-500/20 disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={isSubmitting}
              className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:bg-white/10"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isOffline || isSubmitting}
              className="h-11 flex-[1.5] rounded-xl bg-white text-[10px] font-bold uppercase tracking-wider text-black shadow-lg hover:scale-[1.01] active:scale-98 transition-all disabled:opacity-50"
            >
              {isSubmitting ? "Salvando..." : "Salvar Cupom"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

import { useAuth } from "@/hooks/useAuth";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/utils";
import type { CartItem, ShippingOption } from "@/types";
import { haptic } from "@/utils/haptic";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Search, Sparkles, Truck } from "lucide-react";
import { useEffect, useState } from "react";

interface ShippingCalculatorProps {
  cart: CartItem[];
  subtotal: number;
  freeShippingMin: number;
  selectedOption: ShippingOption | null;
  onSelectOption: (option: ShippingOption | null) => void;
  onCepValidated?: (cep: string) => void;
}

export function ShippingCalculator({
  cart,
  subtotal,
  freeShippingMin,
  selectedOption,
  onSelectOption,
  onCepValidated,
}: ShippingCalculatorProps) {
  const isOffline = useOnlineStatus();
  const { user } = useAuth();
  const [cep, setCep] = useState(() => {
    return localStorage.getItem("ikcous_last_shipping_cep") || "";
  });
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Auto-format CEP: 99999-999
  const handleCepChange = (val: string) => {
    const clean = val.replace(/\D/g, "");
    if (clean.length <= 5) {
      setCep(clean);
    } else {
      setCep(`${clean.slice(0, 5)}-${clean.slice(5, 8)}`);
    }
  };

  const calculateShipping = async (e?: React.FormEvent, skipHaptic = false) => {
    if (e) e.preventDefault();

    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length !== 8) {
      setError("CEP deve conter 8 dígitos.");
      return;
    }

    if (!skipHaptic) {
      haptic.light();
    }
    setLoading(true);
    setError(null);

    const cacheKey = `ikcous_shipping_cache_${cleanCep}`;

    try {
      // 1. Check local cache first if offline or as speedup
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setOptions(parsed);

            // Auto-select first/cheapest option if none selected
            const hasMatch = parsed.some(
              (opt) => opt.id === selectedOption?.id,
            );
            if (!hasMatch) {
              onSelectOption(parsed[0]);
            }
            onCepValidated?.(cep);
            setLoading(false);
            localStorage.setItem("ikcous_last_shipping_cep", cep);
            return;
          }
        } catch (e) {
          console.error("Error parsing cached shipping options:", e);
        }
      }

      // 2. Fallback to Edge Function request
      if (isOffline) {
        throw new Error("Sem conexão com a internet.");
      }

      const { data, error: funcError } = await supabase.functions.invoke(
        "calculate-shipping",
        {
          body: { cep: cleanCep, cart: cart },
        },
      );

      if (funcError || !data || !data.options) {
        throw new Error(funcError?.message || "Falha ao cotar frete.");
      }

      const calculatedOptions: ShippingOption[] = data.options;
      setOptions(calculatedOptions);

      // Save to cache
      localStorage.setItem(cacheKey, JSON.stringify(calculatedOptions));
      localStorage.setItem("ikcous_last_shipping_cep", cep);

      // Auto-select cheapest option if not selected
      if (calculatedOptions.length > 0) {
        const hasMatch = calculatedOptions.some(
          (opt) => opt.id === selectedOption?.id,
        );
        if (!hasMatch) {
          onSelectOption(calculatedOptions[0]);
        }
      }
      onCepValidated?.(cep);
    } catch (err: any) {
      console.error("Error calculating shipping:", err);
      setError(err.message || "Erro ao calcular frete.");

      // Safe fallback option
      const fallbackOption: ShippingOption = {
        id: "flat-fee-fallback-ui",
        name: "Entrega Padrão (Fallback)",
        price: 15,
        deliveryDays: 2,
        provider: "flat_fee",
      };
      setOptions([fallbackOption]);
      onSelectOption(fallbackOption);
    } finally {
      setLoading(false);
    }
  };

  // Re-run calculation if cart changes and CEP was already computed
  useEffect(() => {
    const cleanCep = cep.replace(/\D/g, "");
    if (cleanCep.length === 8 && cart.length > 0 && !loading) {
      // Clear cache for this CEP to get fresh calculations for updated cart
      localStorage.removeItem(`ikcous_shipping_cache_${cleanCep}`);
      calculateShipping(undefined, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.length]);

  // Regra de frete grátis. Espelha `shippingFee` em CartContext.tsx:740-757 e a RPC
  // `create_marketplace_order_v23`, que só zera o frete quando `v_user_id IS NOT NULL`.
  // Sem a checagem de `user`, o convidado via todas as opções a R$ 0,00 aqui e era
  // cobrado o valor cheio no fechamento do pedido. Unificar as cópias desta regra é a FRETE-020.
  const hasFreeShippingItem = cart.some((item) => item.product?.freeShipping);
  const reachedFreeShippingGoal =
    freeShippingMin > 0 && subtotal >= freeShippingMin && Boolean(user);
  const isFree = hasFreeShippingItem || reachedFreeShippingGoal;

  return (
    <div className="w-full space-y-4 rounded-3xl border border-zinc-100 bg-zinc-50/50 p-4">
      <div className="flex items-center gap-2">
        <Truck className="size-4 text-zinc-500" />
        <span className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
          Calcular Frete & Prazo
        </span>
      </div>

      <form onSubmit={calculateShipping} className="flex gap-2">
        <div className="relative flex-1">
          <input
            id="shipping-calculator-cep"
            name="cep"
            type="tel"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            placeholder="00000-000"
            maxLength={9}
            className="w-full rounded-2xl border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-xs font-semibold text-zinc-800 transition-all focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20"
          />
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
        </div>
        <button
          type="submit"
          disabled={loading || cep.replace(/\D/g, "").length !== 8}
          className="shrink-0 select-none rounded-2xl bg-primary px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40"
        >
          {loading ? "Cotando..." : "Calcular"}
        </button>
      </form>

      {error && (
        <div className="flex items-start gap-1.5 rounded-2xl border border-amber-100 bg-amber-50 p-2.5 text-[9.5px] font-medium text-amber-800">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Shipping Options list */}
      <AnimatePresence mode="popLayout">
        {options.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="space-y-2"
          >
            {options.map((option) => {
              const isSelected = selectedOption?.id === option.id;
              const priceToDisplay = isFree ? 0 : option.price;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    haptic.light();
                    onSelectOption(option);
                  }}
                  className={`flex w-full select-none items-center justify-between rounded-2xl border p-3 text-left transition-all duration-200 ${
                    isSelected
                      ? "border-primary bg-primary text-white shadow-md shadow-black/10"
                      : "border-zinc-100 bg-white text-zinc-800 hover:border-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex size-7 items-center justify-center rounded-lg border transition-colors ${
                        isSelected
                          ? "border-white/20 bg-white/20 text-white"
                          : "border-zinc-100 bg-zinc-50 text-zinc-500"
                      }`}
                    >
                      {isSelected ? (
                        <Check className="size-4" />
                      ) : (
                        <Truck className="size-4" />
                      )}
                    </div>
                    <div>
                      <span className="block text-[11px] font-bold leading-snug">
                        {option.name}
                      </span>
                      <span
                        className={`mt-0.5 block text-[9px] leading-none ${
                          isSelected ? "text-zinc-300" : "text-zinc-400"
                        }`}
                      >
                        Entrega em até {option.deliveryDays}{" "}
                        {option.deliveryDays > 1 ? "dias úteis" : "dia útil"}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col justify-center text-right">
                    {isFree ? (
                      <div className="flex items-center gap-1">
                        <Sparkles className="size-3 fill-emerald-500/20 text-emerald-500" />
                        <span className="text-xs font-black uppercase tracking-wider text-emerald-500">
                          GRÁTIS
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-black tracking-tight">
                        {formatCurrency(priceToDisplay)}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

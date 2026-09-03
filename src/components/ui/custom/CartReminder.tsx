import { useStore } from "@/contexts/StoreContext";
import { useCart } from "@/hooks/useCart";
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import { formatCurrency } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, ShoppingCart, Truck } from "lucide-react";
import { useEffect, useState } from "react";

interface CartReminderProps {
  onAction: () => void;
  docked?: boolean;
}

export function CartReminder({ onAction, docked }: CartReminderProps) {
  const { cart: items, getCartCount, cartTotal } = useCart();
  const { config } = useStore();
  const [isVisible, setIsVisible] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const isControlled = docked !== undefined;

  const totalAmount = cartTotal;

  // FRETE V2 (frente B, 03/09): a meta exibida vem do PRESET do lojista
  // (fonte única: presets-de-frete-gratis.ts).
  //  - "sempre" (sentinela 0,01): sem meta e sem "faltam R$ 0,01" — o lembrete
  //    diz "Frete grátis em toda a loja".
  //  - "acima_de_valor": meta de valor normal, e vale para convidado também —
  //    a trava de login do frete grátis morreu com o modelo de presets
  //    (CartContext.tsx), então o "Faça login para liberar o Frete VIP" e a
  //    barra zerada para convidado eram promessa falsa e saíram.
  //  - "desligado" (0) E "por_produto" (sentinela -1): sem barra de valor —
  //    com por produto quem comunica o grátis é a marcação no produto, e uma
  //    barra de valor aqui mentiria (não existe número de corte).
  const preset = presetDoConfig(config.freeShippingMin);
  const hasFreeShippingGoal = config.freeShippingMin > 0;
  const isSempreGratis = preset === "sempre";
  const isFree =
    isSempreGratis ||
    (hasFreeShippingGoal && totalAmount >= config.freeShippingMin);
  const amountToFree = hasFreeShippingGoal
    ? Math.max(0, config.freeShippingMin - totalAmount)
    : 0;
  const progress = hasFreeShippingGoal
    ? Math.min(100, (totalAmount / config.freeShippingMin) * 100)
    : 0;

  // Reset dismiss state and visibility when undocked
  useEffect(() => {
    if (isControlled && !docked) {
      setIsVisible(false);
      setIsDismissed(false);
    }
  }, [docked, isControlled]);

  useEffect(() => {
    if (isControlled && !docked) return;

    if (items.length > 0 && !isDismissed) {
      const delay = isControlled ? 500 : 1500;
      const showTimer = setTimeout(() => setIsVisible(true), delay);
      return () => clearTimeout(showTimer);
    }
    const hideTimer = setTimeout(() => setIsVisible(false), 0);
    return () => clearTimeout(hideTimer);
  }, [items.length, isDismissed, docked, isControlled]);

  useEffect(() => {
    if (isVisible) {
      const hideTimer = setTimeout(() => {
        setIsVisible(false);
        setIsDismissed(true);
      }, 5000); // 5 seconds for more readability
      return () => clearTimeout(hideTimer);
    }
  }, [isVisible]);

  const itemCount = getCartCount();

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(76px+var(--safe-area-bottom,0px))] z-40 flex justify-center px-4 md:bottom-24">
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="group pointer-events-auto relative flex w-full max-w-md items-center gap-3 overflow-hidden rounded-2xl border border-zinc-100/40 bg-white/95 px-3.5 py-2.5 shadow-lg shadow-black/10 backdrop-blur-md"
          >
            {/* Subtle Glow */}
            <div className="absolute right-0 top-0 size-20 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-500/5 blur-2xl" />

            {/* Ultra Slim Top Progress Bar */}
            <div className="absolute inset-x-0 top-0 h-[2px] bg-zinc-100">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${isSempreGratis ? 100 : progress}%` }}
                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-1000"
              />
            </div>

            {/* Left: Animated Icon with Badge */}
            <div className="relative flex-shrink-0">
              <div className="relative flex size-9 items-center justify-center rounded-xl border border-zinc-100 bg-secondary/10 transition-all duration-500 group-hover:scale-105">
                <ShoppingCart className="size-4 text-emerald-500" />
                {itemCount > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full border-2 border-white bg-emerald-500 px-1 text-[8px] font-black text-white shadow-lg"
                  >
                    {itemCount}
                  </motion.span>
                )}
              </div>
            </div>

            {/* Middle: Compressed Info */}
            <div className="relative z-10 min-w-0 flex-1 py-0.5">
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className="text-[8px] font-black uppercase tracking-[0.15em] text-emerald-500">
                  Premium Delivery
                </span>
                <div className="size-1 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
              </div>
              {!hasFreeShippingGoal ? (
                <p className="text-[10px] font-semibold leading-tight text-slate-600">
                  {itemCount === 1
                    ? "1 item no seu carrinho"
                    : `${itemCount} itens no seu carrinho`}
                </p>
              ) : isSempreGratis ? (
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight text-emerald-500">
                  <Truck className="size-3" />
                  <span>Frete grátis em toda a loja</span>
                </div>
              ) : isFree ? (
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-tight text-emerald-500">
                  <Truck className="size-3" />
                  <span>Frete VIP Liberado</span>
                </div>
              ) : (
                <p className="text-[10px] font-semibold leading-tight text-slate-600">
                  Faltam{" "}
                  <span className="font-extrabold text-primary">
                    {formatCurrency(amountToFree)}
                  </span>{" "}
                  para o{" "}
                  <span className="italic text-emerald-500">Frete VIP</span>
                </p>
              )}
            </div>

            {/* Right: Compact Action */}
            <button
              onClick={onAction}
              className="group/btn flex h-8 flex-shrink-0 items-center gap-1 rounded-lg bg-primary px-3.5 text-[9px] font-black uppercase tracking-wider text-white shadow-md transition-all hover:bg-primary/90 active:scale-95"
            >
              Carrinho
              <ChevronRight className="size-2.5 transition-transform group-hover:translate-x-0.5" />
            </button>

            {/* Vertical Separator for Timer */}
            <div className="mx-0.5 h-5 w-px bg-zinc-100" />

            {/* Compact Timer */}
            <div className="relative flex size-5 items-center justify-center opacity-60 transition-opacity">
              <svg className="size-full -rotate-90" viewBox="0 0 32 32">
                <circle
                  cx="16"
                  cy="16"
                  r="14"
                  stroke="#e4e4e7"
                  strokeWidth="2.5"
                  fill="transparent"
                />
                <motion.circle
                  key={isVisible ? "timer-active" : "timer-inactive"}
                  cx="16"
                  cy="16"
                  r="14"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  fill="transparent"
                  strokeDasharray={87.96}
                  initial={{ strokeDashoffset: 87.96 }}
                  animate={{ strokeDashoffset: 0 }}
                  transition={{ duration: 5, ease: "linear" }}
                />
              </svg>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const style = document.createElement("style");
style.textContent = `
    @keyframes timer {
        from { stroke-dashoffset: 87.96; }
        to { stroke-dashoffset: 0; }
    }
`;
if (typeof document !== "undefined") document.head.appendChild(style);

import { cn, formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles as SparklesIcon } from "lucide-react";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface CartFooterSummaryProps {
  cartCount: number;
  /** `null` = frete indefinido (cotação real ainda não escolhida): a barra
   *  mostra "A calcular" em vez de um valor chutado (laudo caça-bugs 30/08). */
  shipping: number | null;
  total: number;
  onNavigate: (view: View) => void;
}

export function CartFooterSummary({
  cartCount,
  shipping,
  total,
  onNavigate,
}: CartFooterSummaryProps) {
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    let rafId: number;
    const handleResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        const isInputActive =
          activeEl &&
          ((activeEl.tagName === "INPUT" &&
            ![
              "button",
              "submit",
              "checkbox",
              "radio",
              "file",
              "image",
              "range",
              "hidden",
              "reset",
            ].includes(activeEl.getAttribute("type") || "")) ||
            activeEl.tagName === "TEXTAREA" ||
            activeEl.getAttribute("contenteditable") === "true");
        const keyboardActive =
          isInputActive && viewport.height < window.innerHeight * 0.85;
        setIsKeyboardOpen(!!keyboardActive);
      });
    };

    viewport.addEventListener("resize", handleResize);
    return () => {
      cancelAnimationFrame(rafId);
      viewport.removeEventListener("resize", handleResize);
    };
  }, []);

  if (typeof document === "undefined" || !document.body || isKeyboardOpen)
    return null;

  return createPortal(
    <div className="bottom-docked-navigation fixed inset-x-0 z-[110] md:bottom-[104px] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 lg:hidden">
      <motion.div
        initial={{ y: "100%", opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full border-t border-zinc-100 bg-white shadow-[0_-10px_40px_-5px_rgba(0,0,0,0.08)] md:rounded-b-none md:rounded-t-2xl md:border-x md:border-b-0 md:border-t md:border-zinc-200/60"
      >
        <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-2 p-4 xs:gap-4 xs:px-6 md:gap-3 md:px-4">
          {/* Visual context */}
          <div className="hidden flex-shrink-0 flex-col md:flex">
            <span className="mb-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Seu Carrinho
            </span>
            <span className="text-xs font-black text-zinc-900">
              {cartCount} it{cartCount > 1 ? "ens" : "em"} selecionado
              {cartCount > 1 ? "s" : ""}
            </span>
          </div>

          {/* Total & Benefits */}
          <div className="flex min-w-0 flex-col md:flex-shrink-0">
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-[10px] font-black uppercase leading-none tracking-widest text-zinc-400">
                Total
              </span>
              {shipping === 0 && (
                <div className="flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5">
                  <SparklesIcon className="size-2.5 fill-emerald-500/20 text-emerald-500" />
                  <span className="text-[8px] font-black uppercase tracking-tighter text-emerald-700">
                    Bônus VIP
                  </span>
                </div>
              )}
            </div>
            <p
              className={cn(
                "text-lg xs:text-xl md:text-lg font-black tracking-tighter transition-all duration-500",
                shipping === 0
                  ? "bg-gradient-to-r from-emerald-600 to-emerald-400 bg-clip-text text-transparent"
                  : "text-zinc-950",
              )}
            >
              {formatCurrency(total)}
            </p>
          </div>

          {/* Main Action */}
          <div className="flex items-center gap-2 xs:gap-3 md:flex-shrink-0 md:gap-2">
            <div className="flex h-8 flex-shrink-0 flex-col items-end justify-center border-r border-zinc-100 pr-2 xs:pr-3 md:pr-2">
              <span className="mb-1 text-[9px] font-black uppercase leading-none tracking-widest text-zinc-400">
                Frete
              </span>
              <span
                className={cn(
                  "text-xs font-black leading-none tracking-tight",
                  shipping === 0
                    ? "text-emerald-500"
                    : shipping === null
                      ? "text-zinc-500"
                      : "text-zinc-600",
                )}
              >
                {shipping === 0
                  ? "GRÁTIS"
                  : shipping === null
                    ? "A calcular"
                    : formatCurrency(shipping)}
              </span>
            </div>

            <button
              onClick={() => onNavigate("checkout")}
              className="group relative flex h-12 flex-shrink-0 items-center gap-2 overflow-hidden rounded-2xl bg-primary px-4 text-white shadow-xl shadow-black/10 transition-all hover:bg-primary/90 active:scale-[0.98] xs:h-14 xs:gap-3 xs:px-8 md:h-12 md:gap-2.5 md:px-5"
            >
              <div className="relative z-10 flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest">
                  Finalizar
                </span>
                <div className="flex size-8 items-center justify-center rounded-xl bg-white/20 transition-colors group-hover:bg-white/30">
                  <ArrowRight className="size-4 text-white transition-transform group-hover:translate-x-0.5" />
                </div>
              </div>

              {/* Subtle Shimmer */}
              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

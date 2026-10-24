import { medirRodapeCliente } from "@/lib/medir-rodape-cliente";
import { cn, formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
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
    <div
      ref={medirRodapeCliente}
      className="bottom-docked-navigation fixed inset-x-0 z-[110] md:left-1/2 md:right-auto md:w-full md:max-w-md md:-translate-x-1/2 lg:hidden"
    >
      <motion.div
        initial={{ y: "100%", opacity: 0.5 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
        className="w-full border-t border-border bg-background/95 backdrop-blur-md md:rounded-b-none md:rounded-t-[18px] md:border-x md:border-b-0 md:border-t md:border-border"
      >
        <div className="mx-auto flex max-w-screen-xl flex-wrap items-center justify-between gap-x-4 gap-y-3 p-4 min-[380px]:px-5">
          {/* Visual context */}
          <div className="hidden w-full items-baseline justify-between gap-2 md:flex">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              Seu Carrinho
            </span>
            <span className="text-[13px] font-semibold text-foreground">
              {cartCount} it{cartCount > 1 ? "ens" : "em"} selecionado
              {cartCount > 1 ? "s" : ""}
            </span>
          </div>

          {/* Total & Frete */}
          <div className="flex min-w-0 flex-col">
            <span className="font-mono text-[11px] uppercase leading-none tracking-[0.12em] text-muted-foreground">
              Total
            </span>
            <p className="mt-1.5 text-2xl font-bold leading-none tracking-tight text-foreground">
              {formatCurrency(total)}
            </p>
            <p
              className={cn(
                "mt-1.5 flex items-center gap-1.5 text-[13px] font-medium leading-none",
                shipping === 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {shipping === 0 && (
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" />
              )}
              <span>Frete</span>{" "}
              <span className={shipping === 0 ? "lowercase" : "font-semibold"}>
                {shipping === 0
                  ? "GRÁTIS"
                  : shipping === null
                    ? "A calcular"
                    : formatCurrency(shipping)}
              </span>
            </p>
          </div>

          {/* Main Action */}
          <button
            onClick={() => onNavigate("checkout")}
            className="flex h-[52px] min-w-0 flex-1 basis-[184px] items-center justify-center gap-3 rounded-2xl bg-foreground px-5 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-[0.98]"
          >
            Finalizar compra
            <ArrowRight className="size-5 shrink-0" />
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { Minus, Plus } from "lucide-react";

interface QuantitySelectorProps {
  quantity: number;
  maxQuantity: number;
  onChange: (quantity: number) => void;
  size?: "sm" | "md" | "pill";
}

export function QuantitySelector({
  quantity,
  maxQuantity,
  onChange,
  size = "md",
}: QuantitySelectorProps) {
  // sm: botao visual de 28px; o `before` invisivel de -inset-2 leva a area de
  // toque a 44px (8px por lado). Cabe sem sobrepor o vizinho: o numero entre
  // os dois botoes tem 32px (h-7 w-8), e cada area invade 8px dele.
  const buttonSize =
    size === "sm"
      ? "w-7 h-7 relative before:absolute before:-inset-2 before:content-['']"
      : size === "pill"
        ? "size-11 shrink-0"
        : "w-8 h-8 xs:w-9 xs:h-9";
  const iconSize = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5 xs:w-4 xs:h-4";

  const handleDecrease = () => {
    if (quantity > 1) {
      onChange(quantity - 1);
    }
  };

  const handleIncrease = () => {
    if (quantity < maxQuantity) {
      onChange(quantity + 1);
    }
  };

  return (
    <div
      className={
        size === "pill"
          ? "flex min-h-[52px] items-center rounded-full bg-muted p-1"
          : "flex items-center rounded-2xl border border-zinc-200/50 bg-zinc-100/50 p-1 backdrop-blur-sm"
      }
    >
      <button
        onClick={handleDecrease}
        disabled={quantity <= 1}
        aria-label="Diminuir quantidade"
        type="button"
        title="Diminuir"
        className={`${buttonSize} flex items-center justify-center rounded-full ${size === "pill" ? "" : "border border-zinc-200/50 bg-white shadow-sm"} transition-all hover:bg-zinc-50 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30`}
      >
        <Minus className={`${iconSize} text-zinc-600`} />
      </button>

      {/* Laudo de acessibilidade 03/09, achado 6: o número animado troca de
          elemento a cada mudança (`key={quantity}`) e o leitor de tela nunca
          era avisado — apertar "+" não dizia nada. A região live fica no
          container PERSISTENTE (fora da animação) para o anúncio ser confiável,
          sem tocar no visual. */}
      <div
        aria-live="polite"
        className={`relative flex items-center justify-center overflow-hidden ${size === "pill" ? "h-11 w-6" : size === "sm" ? "h-7 w-8" : "h-8 w-10 xs:h-9 xs:w-12"}`}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={quantity}
            initial={{ y: 8, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="absolute text-sm font-black text-zinc-800"
          >
            {quantity}
          </motion.span>
        </AnimatePresence>
      </div>

      <button
        onClick={handleIncrease}
        disabled={quantity >= maxQuantity}
        aria-label="Aumentar quantidade"
        type="button"
        title="Aumentar"
        className={`${buttonSize} flex items-center justify-center rounded-full ${size === "pill" ? "" : "border border-zinc-200/50 bg-white shadow-sm"} transition-all hover:bg-zinc-50 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30`}
      >
        <Plus className={`${iconSize} text-zinc-600`} />
      </button>
    </div>
  );
}

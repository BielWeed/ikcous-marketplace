import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import { motion } from "framer-motion";
import { ArrowRight, ShoppingBag } from "lucide-react";

interface EmptyCartProps {
  onNavigate: (view: View) => void;
}

export function EmptyCart({ onNavigate }: EmptyCartProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex h-full flex-col items-center justify-center px-8 py-10 text-center"
    >
      <div className="mb-6 flex size-20 items-center justify-center rounded-[22px] bg-muted/60 text-muted-foreground">
        <ShoppingBag className="size-9" strokeWidth={1.5} />
      </div>

      <h2 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
        Seu carrinho está vazio
      </h2>
      <p className="mx-auto mb-8 max-w-[280px] text-[15px] leading-snug text-muted-foreground">
        Parece que você ainda não adicionou nenhum item ao seu carrinho. Que tal
        explorar nossas novidades?
      </p>

      <button
        onClick={() => {
          haptic.medium();
          onNavigate("home");
        }}
        className="flex h-[52px] items-center justify-center gap-3 rounded-2xl bg-foreground px-8 text-[15px] font-semibold text-background transition-colors hover:bg-foreground/90 active:scale-[0.98]"
      >
        <span>Explorar Produtos</span>
        <ArrowRight className="size-5" />
      </button>
    </motion.div>
  );
}

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
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex h-full flex-col items-center justify-center px-10 text-center"
    >
      <div className="relative mb-8">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, 5, -5, 0],
          }}
          transition={{
            duration: 4,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
          className="relative z-10 flex size-32 items-center justify-center rounded-[3rem] border border-zinc-200/50 bg-zinc-100/50 shadow-inner"
        >
          <ShoppingBag className="size-12 text-zinc-300" strokeWidth={1.5} />
        </motion.div>

        {/* Decorative Blobs */}
        <div className="absolute left-1/2 top-1/2 -z-10 size-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400/5 blur-3xl" />
      </div>

      <h2 className="mb-3 text-2xl font-black tracking-tight text-zinc-900">
        Seu carrinho está vazio
      </h2>
      <p className="mx-auto max-w-[280px] text-xs font-medium leading-relaxed text-zinc-500">
        Parece que você ainda não adicionou nenhum item ao seu carrinho. Que tal
        explorar nossas novidades?
      </p>

      <button
        onClick={() => {
          haptic.medium();
          onNavigate("home");
        }}
        className="group relative flex items-center gap-3 overflow-hidden rounded-[2rem] bg-primary px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-white shadow-xl shadow-black/10 transition-all hover:opacity-90 active:scale-95"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white/20 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        <span>Explorar Produtos</span>
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
      </button>
    </motion.div>
  );
}

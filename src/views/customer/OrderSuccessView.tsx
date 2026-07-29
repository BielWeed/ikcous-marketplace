import { Button } from "@/components/ui/button";
import type { View } from "@/types";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, Home, Package } from "lucide-react";

interface OrderSuccessViewProps {
  onNavigate: (view: View) => void;
}

export function OrderSuccessView({ onNavigate }: OrderSuccessViewProps) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-white px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 15 }}
        className="mb-8 flex size-24 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"
      >
        <CheckCircle2 className="size-12" />
      </motion.div>

      <h1 className="mb-4 text-3xl font-black tracking-tighter text-zinc-900">
        Pedido Realizado!
      </h1>
      <p className="mb-12 max-w-xs leading-relaxed text-zinc-500">
        Seu pedido foi recebido com sucesso e já está sendo processado. Você
        receberá atualizações em breve.
      </p>

      <div className="grid w-full max-w-xs gap-4">
        <Button
          onClick={() => onNavigate("orders")}
          className="h-14 gap-3 rounded-2xl bg-zinc-900 text-base font-bold text-white hover:bg-black"
        >
          <Package className="size-5" />
          Meus Pedidos
        </Button>
        <Button
          variant="ghost"
          onClick={() => onNavigate("home")}
          className="h-14 gap-3 rounded-2xl font-bold text-zinc-500"
        >
          <Home className="size-5" />
          Voltar para Início
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

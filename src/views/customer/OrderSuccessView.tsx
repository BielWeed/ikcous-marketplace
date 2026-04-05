import { CheckCircle2, Package, ArrowRight, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';
import type { View } from '@/types';

interface OrderSuccessViewProps {
    onNavigate: (view: View) => void;
}

export function OrderSuccessView({ onNavigate }: OrderSuccessViewProps) {
    return (
        <div className="min-h-full bg-white px-6 py-12 flex flex-col items-center justify-center text-center">
            <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
                className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-8"
            >
                <CheckCircle2 className="w-12 h-12" />
            </motion.div>

            <h1 className="text-3xl font-black tracking-tighter mb-4 text-zinc-900">
                Pedido Realizado!
            </h1>
            <p className="text-zinc-500 mb-12 max-w-xs leading-relaxed">
                Seu pedido foi recebido com sucesso e já está sendo processado. Você receberá atualizações em breve.
            </p>

            <div className="grid gap-4 w-full max-w-xs">
                <Button
                    onClick={() => onNavigate('orders')}
                    className="bg-zinc-900 text-white hover:bg-black h-14 rounded-2xl text-base font-bold gap-3"
                >
                    <Package className="w-5 h-5" />
                    Meus Pedidos
                </Button>
                <Button
                    variant="ghost"
                    onClick={() => onNavigate('home')}
                    className="h-14 rounded-2xl text-zinc-500 font-bold gap-3"
                >
                    <Home className="w-5 h-5" />
                    Voltar para Início
                    <ArrowRight className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}

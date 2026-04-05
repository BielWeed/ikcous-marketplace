import { Check, Package, Truck, Home, XCircle } from 'lucide-react';
import type { OrderStatus } from '@/types';

interface OrderTimelineProps {
    status: OrderStatus;
}

export function OrderTimeline({ status }: OrderTimelineProps) {
    const steps = [
        { key: 'new', label: 'Recebido', icon: Check },
        { key: 'processing', label: 'Preparando', icon: Package },
        { key: 'shipping', label: 'Em Rota', icon: Truck },
        { key: 'delivered', label: 'Entregue', icon: Home },
    ];

    if (status === 'cancelled') {
        return (
            <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-100">
                <XCircle className="w-5 h-5" />
                <span className="font-medium text-sm">Pedido Cancelado</span>
            </div>
        );
    }

    const currentStepIndex = steps.findIndex(s => s.key === status);
    // Se o status for um que não mapeamos (raro), garantimos um fallback
    const safeIndex = currentStepIndex === -1 ? 0 : currentStepIndex;

    return (
        <div className="relative flex justify-between items-center w-full px-2 py-6">
            {/* Background Line */}
            <div className="absolute top-[36px] left-[30px] right-[30px] h-0.5 bg-gray-100" />

            {/* Active Line */}
            <div
                className="absolute top-[36px] left-[30px] h-0.5 bg-zinc-900 transition-all duration-1000 ease-in-out"
                style={{
                    width: `calc(${Math.max(0, (safeIndex / (steps.length - 1)) * 100)}% - 0px)`,
                    maxWidth: 'calc(100% - 60px)'
                }}
            />

            {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index <= safeIndex;
                const isCurrent = index === safeIndex;

                return (
                    <div key={step.key} className="relative flex flex-col items-center z-10 flex-1">
                        <div
                            className={`w-12 h-12 rounded-2xl flex items-center justify-center border-2 transition-all duration-700 ${isActive
                                ? 'bg-zinc-900 border-zinc-900 text-white shadow-2xl shadow-zinc-200'
                                : 'bg-white border-zinc-100 text-zinc-300'
                                } ${isCurrent ? 'scale-110 -rotate-3 ring-4 ring-zinc-100' : ''}`}
                        >
                            <Icon className={`w-5 h-5 ${isCurrent ? 'animate-pulse' : ''}`} />
                        </div>
                        <span className={`text-[8px] mt-3 font-black uppercase tracking-[0.2em] transition-colors duration-500 ${isActive ? 'text-zinc-900' : 'text-zinc-300'
                            }`}>
                            {step.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

import { Check, Package, Truck, Home, XCircle } from 'lucide-react';
import type { OrderStatus } from '@/types';

interface OrderTimelineProps {
    status: OrderStatus;
}

export function OrderTimeline({ status }: OrderTimelineProps) {
    const steps = [
        { key: 'pending', label: 'Recebido', icon: Check },
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
        <div className="relative flex justify-between items-start w-full px-2 py-6">
            {/* Background Line */}
            <div className="absolute top-[48px] left-[30px] right-[30px] h-[3px] bg-zinc-100 rounded-full" />

            {/* Active Line */}
            <div
                className="absolute top-[48px] left-[30px] h-[3px] bg-emerald-500 rounded-full transition-all duration-1000 ease-in-out"
                style={{
                    width: `calc(${Math.max(0, (safeIndex / (steps.length - 1)) * 100)}% - 0px)`,
                    maxWidth: 'calc(100% - 60px)'
                }}
            />

            {steps.map((step, index) => {
                const Icon = step.icon;
                const isActive = index <= safeIndex;
                const isCompleted = index < safeIndex;
                const isCurrent = index === safeIndex;

                return (
                    <div key={step.key} className="relative flex flex-col items-center z-10 flex-1">
                        <div
                            className={`relative w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-700 ${
                                isCompleted
                                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-100/50'
                                    : isCurrent
                                    ? 'bg-zinc-900 border-zinc-900 text-white shadow-xl shadow-zinc-200 ring-4 ring-emerald-500/25 scale-110'
                                    : 'bg-white border-zinc-200 text-zinc-300'
                            }`}
                        >
                            {isCompleted ? (
                                <Check className="w-5 h-5 stroke-[3px]" />
                            ) : (
                                <Icon className={`w-5 h-5 ${isCurrent ? 'animate-pulse' : ''}`} />
                            )}

                            {isCurrent && (
                                <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 border border-zinc-900"></span>
                                </span>
                            )}
                        </div>
                        <span className={`text-[8px] mt-3 font-black uppercase tracking-[0.2em] transition-colors duration-500 text-center ${
                            isActive ? 'text-zinc-900' : 'text-zinc-300'
                        }`}>
                            {step.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}


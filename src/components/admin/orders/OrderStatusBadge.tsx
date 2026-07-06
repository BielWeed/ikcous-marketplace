 
import React, { memo } from 'react';
import { Package, Clock, Truck, CheckCircle, XCircle } from 'lucide-react';
import type { OrderStatus } from '@/types';

export const statusConfig: Record<OrderStatus, { label: string; icon: React.ElementType; color: string; bgColor: string; borderColor: string; className?: string }> = {
    pending: {
        label: 'Novo Pedido',
        icon: Package,
        color: 'text-blue-400',
        bgColor: 'bg-blue-500/10',
        borderColor: 'border-blue-500/20',
        className: 'text-blue-400'
    },
    processing: {
        label: 'Em Separação',
        icon: Clock,
        color: 'text-amber-400',
        bgColor: 'bg-amber-500/10',
        borderColor: 'border-amber-500/20',
        className: 'text-amber-400'
    },
    shipping: {
        label: 'Em Trânsito',
        icon: Truck,
        color: 'text-indigo-400',
        bgColor: 'bg-indigo-500/10',
        borderColor: 'border-indigo-500/20',
        className: 'text-indigo-400'
    },
    delivered: {
        label: 'Finalizado',
        icon: CheckCircle,
        color: 'text-emerald-400',
        bgColor: 'bg-emerald-500/10',
        borderColor: 'border-emerald-500/20',
        className: 'text-emerald-400'
    },
    cancelled: {
        label: 'Cancelado',
        icon: XCircle,
        color: 'text-zinc-500',
        bgColor: 'bg-zinc-500/10',
        borderColor: 'border-zinc-500/20',
        className: 'text-zinc-500'
    }
};

interface OrderStatusBadgeProps {
    status: OrderStatus;
    className?: string;
}

export const OrderStatusBadge = memo(function OrderStatusBadge({ status, className }: Readonly<OrderStatusBadgeProps>) {
    const cfg = statusConfig[status || 'pending'] || statusConfig.pending;

    return (
        <div className={`flex items-center px-2 py-0.5 rounded-full ${cfg.bgColor} ${className}`}>
            <span className={`text-[9px] font-black uppercase tracking-[0.1em] ${cfg.color}`}>
                {cfg.label}
            </span>
        </div>
    );
});

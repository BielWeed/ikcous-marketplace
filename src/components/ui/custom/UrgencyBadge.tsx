import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UrgencyBadgeProps {
    stock: number;
    className?: string;
}

export function UrgencyBadge({ stock, className }: UrgencyBadgeProps) {
    if (stock > 10 || stock <= 0) return null;

    return (
        <div className={cn(
            "flex items-center gap-1 px-2 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black uppercase tracking-tighter animate-pulse shadow-lg shadow-amber-500/20 whitespace-nowrap",
            className
        )}>
            <Zap className="w-3 h-3 fill-current" />
            <span>{stock === 1 ? 'Última unidade!' : `Últimas ${stock} unidades!`}</span>
        </div>
    );
}

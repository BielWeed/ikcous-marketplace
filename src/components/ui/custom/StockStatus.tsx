import { Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StockStatusProps {
    stock: number;
    className?: string;
}

export function StockStatus({ stock, className = "" }: StockStatusProps) {
    if (stock > 5) return null;

    return (
        <div className={cn(
            "max-w-fit flex items-center gap-1 px-2.5 py-1 bg-white rounded-lg border border-amber-200 shadow-md whitespace-nowrap",
            className
        )}>
            <Zap className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
            <span className="text-[9px] font-black uppercase tracking-tighter text-amber-700">
                {stock === 0 ? 'Esgotado' : stock === 1 ? 'Última unidade' : `Apenas ${stock}`}
            </span>
        </div>
    );
}

import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InventoryAlertProps {
    alertsCount: number;
    onNavigate: (view: any, id?: string) => void;
}

export function InventoryAlert({ alertsCount, onNavigate }: InventoryAlertProps) {
    if (alertsCount <= 0) return null;

    return (
        <div className="px-0 sm:px-6">
            <div className="relative group admin-glass sm:rounded-[2.5rem] border-y sm:border-x border-rose-500/20 overflow-hidden p-6 flex items-center justify-between shadow-[0_0_50px_-12px_rgba(244,63,94,0.1)]">
                <div className="absolute inset-0 bg-gradient-to-r from-rose-500/[0.03] to-transparent pointer-events-none" />
                <div className="flex items-center gap-6 relative z-10">
                    <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center border border-rose-500/20 shadow-inner group-hover:scale-110 transition-transform duration-500">
                        <AlertCircle className="w-7 h-7 text-rose-500 animate-pulse" />
                    </div>
                    <div>
                        <h3 className="text-base font-black uppercase tracking-widest text-white group-hover:text-rose-500 transition-colors">Alerta de Crítico</h3>
                        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter mt-1">{alertsCount} produtos operando abaixo do estoque mínimo</p>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onNavigate('admin-products')}
                    className="relative z-10 bg-zinc-950 border-rose-500/20 hover:bg-rose-500 hover:text-white transition-all text-[10px] font-black uppercase tracking-[0.2em] px-6 h-12 rounded-2xl"
                >
                    Repor Agora
                </Button>
            </div>
        </div>
    );

}

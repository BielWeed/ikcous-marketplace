import { ArrowUpRight, Star, MessageSquare } from 'lucide-react';

interface SupportBannersProps {
    onNavigate: (view: any, id?: string) => void;
}

export function SupportBanners({ onNavigate }: SupportBannersProps) {
    return (
        <div className="grid grid-cols-2 gap-3">
            {/* Experience Metrics Card */}
            <div
                onClick={() => onNavigate('admin-reviews')}
                className="group relative overflow-hidden rounded-2xl p-3.5 cursor-pointer active:scale-[0.98] transition-all duration-500 shadow-lg border border-white/5 bg-zinc-950/40 hover:border-admin-gold/30 hover:bg-zinc-900/30"
            >
                {/* Ambient glow */}
                <div className="absolute -right-4 -bottom-4 w-12 h-12 rounded-full bg-admin-gold/5 blur-xl group-hover:bg-admin-gold/15 transition-all duration-700" />
                
                <div className="relative flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-admin-gold/15 flex items-center justify-center border border-admin-gold/20 text-admin-gold shrink-0 transition-colors duration-300 group-hover:bg-admin-gold group-hover:text-black">
                            <Star className="w-4 h-4 fill-current" />
                        </div>
                        <div className="min-w-0">
                            <span className="block text-[8px] font-black uppercase text-admin-gold/60 tracking-widest leading-none mb-0.5">Feedback</span>
                            <h3 className="text-xs font-black text-white leading-tight tracking-tight truncate">Reviews</h3>
                        </div>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 group-hover:bg-admin-gold group-hover:text-black group-hover:border-transparent transition-all duration-300 shrink-0">
                        <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                </div>
            </div>

            {/* Consultive Support Card */}
            <div
                onClick={() => onNavigate('admin-qa')}
                className="group relative overflow-hidden rounded-2xl p-3.5 cursor-pointer active:scale-[0.98] transition-all duration-500 shadow-lg border border-white/5 bg-zinc-950/40 hover:border-admin-gold/30 hover:bg-zinc-900/30"
            >
                {/* Ambient glow */}
                <div className="absolute -right-4 -bottom-4 w-12 h-12 rounded-full bg-admin-gold/5 blur-xl group-hover:bg-admin-gold/15 transition-all duration-700" />

                <div className="relative flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center border border-white/5 text-zinc-400 shrink-0 transition-all duration-300 group-hover:bg-admin-gold group-hover:text-black group-hover:border-transparent">
                            <MessageSquare className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                            <span className="block text-[8px] font-black uppercase text-zinc-500 tracking-widest leading-none mb-0.5">Dúvidas</span>
                            <h3 className="text-xs font-black text-white leading-tight tracking-tight truncate">Suporte</h3>
                        </div>
                    </div>
                    <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center text-zinc-400 group-hover:bg-admin-gold group-hover:text-black group-hover:border-transparent transition-all duration-300 shrink-0">
                        <ArrowUpRight className="w-3.5 h-3.5 stroke-[2.5]" />
                    </div>
                </div>
            </div>
        </div>
    );
}

import { ArrowUpRight, Star, MessageSquare } from 'lucide-react';

interface SupportBannersProps {
    onNavigate: (view: any, id?: string) => void;
}

export function SupportBanners({ onNavigate }: SupportBannersProps) {
    return (
        <div className="px-0 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Experience Metrics Banner */}
                <div
                    onClick={() => onNavigate('admin-reviews')}
                    className="group relative overflow-hidden rounded-[1.5rem] p-5 cursor-pointer active:scale-[0.98] transition-all duration-700 shadow-xl border border-white/5"
                >
                    <div className="absolute inset-0 bg-gradient-to-br from-admin-gold to-[#b48904] group-hover:from-[#facc15] group-hover:to-admin-gold transition-all duration-700" />
                    <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-125 transition-transform duration-1000 rotate-12">
                        <Star className="w-24 h-24 text-white stroke-[0.5]" />
                    </div>
                    <div className="relative space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-black/20 backdrop-blur-md flex items-center justify-center border border-white/10">
                                <Star className="w-5 h-5 text-white" />
                            </div>
                            <h3 className="text-xl font-black text-white leading-tight tracking-tighter">Métricas de Experiência</h3>
                        </div>
                        <p className="text-xs text-white/80 max-w-[280px] font-bold leading-relaxed">Analise o feedback dos consumidores e impulsione a autoridade da marca no mercado.</p>
                        <div className="pt-2">
                            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-xl bg-black text-admin-gold font-black text-[9px] uppercase tracking-[0.2em] shadow-lg group-hover:scale-105 transition-all">
                                Gerenciar Reviews <ArrowUpRight className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Consultive Support Banner */}
                <div
                    onClick={() => onNavigate('admin-qa')}
                    className="group relative overflow-hidden rounded-[1.5rem] p-5 cursor-pointer active:scale-[0.98] transition-all duration-700 border border-white/5 shadow-xl admin-glass"
                >
                    <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 group-hover:scale-125 transition-all duration-1000 -rotate-12">
                        <MessageSquare className="w-24 h-24 text-white stroke-[0.5]" />
                    </div>
                    <div className="relative space-y-4">
                        <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center border border-white/5 group-hover:border-admin-gold/30 transition-colors">
                                <MessageSquare className="w-5 h-5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                            </div>
                            <h3 className="text-xl font-black text-white leading-tight tracking-tighter">Suporte Consultivo</h3>
                        </div>
                        <p className="text-xs text-zinc-500 max-w-[280px] font-bold leading-relaxed">Capture intenções de compra através do esclarecimento ágil e estratégico de dúvidas.</p>
                        <div className="pt-2">
                            <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-xl bg-white/5 text-zinc-400 font-black text-[9px] uppercase tracking-[0.2em] border border-white/5 group-hover:bg-admin-gold group-hover:text-black group-hover:border-transparent transition-all">
                                Central de Dúvidas <ArrowUpRight className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

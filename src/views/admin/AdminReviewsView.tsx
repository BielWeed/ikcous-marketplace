import { useState, useEffect } from 'react';
import { Search, Star, Trash2, ShieldCheck, ShieldOff, ThumbsUp, MessageSquare, ArrowLeft, User } from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useReviews } from '@/hooks/useReviews';
import type { View } from '@/types';

interface AdminReviewsViewProps {
    readonly onNavigate: (view: View) => void;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.1
        }
    }
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
        opacity: 1,
        y: 0,
        transition: {
            type: "spring",
            stiffness: 100,
            damping: 15
        }
    }
};

export function AdminReviewsView({ onNavigate: _onNavigate }: AdminReviewsViewProps) {
    const { adminReviews, loading, getAllReviews, deleteReview, toggleVerified, addMerchantReply } = useReviews();
    const [page, setPage] = useState(0);
    const [totalReviews, setTotalReviews] = useState(0);
    const pageSize = 10;
    const [searchQuery, setSearchQuery] = useState('');
    const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');
    const [isSubmittingReply, setIsSubmittingReply] = useState(false);

    useEffect(() => {
        const load = async () => {
            const result = await getAllReviews(page, pageSize, {
                rating: ratingFilter,
                search: searchQuery
            });
            if (result) setTotalReviews(result.total);
        };
        load();
    }, [getAllReviews, page, ratingFilter, searchQuery]);

    const totalPages = Math.ceil(totalReviews / pageSize);

    const avgRating = adminReviews.length > 0
        ? (adminReviews.reduce((a, r) => a + r.rating, 0) / adminReviews.length).toFixed(1)
        : '0.0';

    const handleDelete = async (id: string) => {
        await deleteReview(id);
        setConfirmDeleteId(null);
    };

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

    const renderStars = (rating: number) => (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
                <Star
                    key={i}
                    className={`w-4 h-4 transition-all duration-300 ${i <= rating ? 'fill-yellow-400 text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.4)]' : 'text-zinc-700'}`}
                />
            ))}
        </div>
    );

    if (loading && adminReviews.length === 0) {
        return (
            <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center space-y-6">
                <div className="relative">
                    <div className="w-16 h-16 border-2 border-zinc-800 border-t-emerald-500 rounded-full animate-spin" />
                    <Star className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-emerald-500 animate-pulse" />
                </div>
                <div className="text-center">
                    <p className="text-sm font-black text-white uppercase tracking-[0.2em]">Carregando Feedback</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-2">Sincronizando com a base de dados...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-400 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
            {/* Header / Stats Overlay */}
            <div className="sticky top-0 z-50 p-4 pb-0">
                <div className="admin-glass rounded-[2rem] border border-white/5 p-6 shadow-2xl">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => _onNavigate('admin-dashboard')}
                                    className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group"
                                >
                                    <ArrowLeft className="w-5 h-5 text-zinc-400 group-hover:text-white transition-colors" />
                                </button>
                                <div className="space-y-0.5">
                                    <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-3">
                                        Avaliações
                                        <div className="px-2.5 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{totalReviews}</p>
                                        </div>
                                    </h1>
                                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] flex items-center gap-2">
                                        Monitoramento de Satisfação <span className="w-1 h-1 rounded-full bg-emerald-500/40 animate-pulse" /> <span className="text-emerald-400/80">{avgRating} Média global</span>
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Search & Main Filter */}
                        <div className="flex flex-col sm:flex-row items-stretch gap-3 flex-1 max-w-2xl">
                            <div className="relative flex-1 group">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-emerald-400 transition-colors" />
                                <label htmlFor="reviews-search" className="sr-only">Buscar avaliações</label>
                                <input
                                    type="text"
                                    id="reviews-search"
                                    name="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar por cliente ou produto..."
                                    className="w-full pl-11 pr-4 py-3 bg-white/[0.03] border border-white/5 rounded-2xl text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:bg-white/[0.05] transition-all"
                                />
                            </div>
                            <div className="flex items-center gap-2 p-1 bg-white/[0.03] rounded-2xl border border-white/5 overflow-x-auto no-scrollbar">
                                <button
                                    onClick={() => setRatingFilter('all')}
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${ratingFilter === 'all'
                                        ? 'bg-white text-black shadow-lg shadow-white/10'
                                        : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                >
                                    Todas
                                </button>
                                {[5, 4, 3, 2, 1].map(star => (
                                    <button
                                        key={star}
                                        onClick={() => setRatingFilter(star)}
                                        className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 whitespace-nowrap ${ratingFilter === star
                                            ? 'bg-white text-black shadow-lg shadow-white/10'
                                            : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        {star} <Star className={`w-3 h-3 ${ratingFilter === star ? 'fill-black' : 'fill-zinc-700'}`} />
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto p-4 lg:p-8">
                <AnimatePresence mode="wait">
                    {adminReviews.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col items-center justify-center py-32 rounded-[3rem] border-2 border-dashed border-white/5 bg-white/[0.02]"
                        >
                            <div className="w-24 h-24 bg-white/[0.03] rounded-3xl flex items-center justify-center border border-white/5 mb-8 relative">
                                <Star className="w-12 h-12 text-zinc-800" />
                                <div className="absolute inset-0 bg-emerald-500/20 blur-2xl rounded-full" />
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tight uppercase">Sem Feedback ainda</h3>
                            <p className="text-sm font-medium text-zinc-500 mt-2 max-w-xs text-center">As avaliações dos seus clientes aparecerão aqui assim que começarem a chegar.</p>
                        </motion.div>
                    ) : (
                        <motion.div
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                            className="grid grid-cols-1 gap-6"
                        >
                            {adminReviews.map((review) => (
                                <motion.div
                                    key={review.id}
                                    variants={itemVariants}
                                    layout
                                    className="group relative"
                                >
                                    <div className="absolute -inset-px bg-gradient-to-r from-emerald-500/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[2.5rem]" />
                                    <div className="relative bg-white/[0.03] rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md hover:bg-white/[0.05] transition-all duration-500 overflow-hidden">

                                        {/* Review Header */}
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
                                            <div className="flex items-center gap-5">
                                                <div className="relative">
                                                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center font-black text-xl text-white shadow-2xl border border-white/10 ring-4 ring-white/5">
                                                        {review.customerName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-lg flex items-center justify-center border-2 border-[#09090b] shadow-lg shadow-emerald-500/20">
                                                        <User className="w-3 h-3 text-black" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-lg font-black text-white tracking-tight uppercase">{review.customerName}</p>
                                                        {review.verified && (
                                                            <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-500/10 text-emerald-400 text-[8px] font-black uppercase tracking-[0.1em] border border-emerald-500/20 rounded-md">
                                                                <ShieldCheck className="w-2.5 h-2.5" />
                                                                Verificado
                                                            </div>
                                                        )}
                                                    </div>
                                                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mt-1.5">
                                                        Em <span className="text-white font-black">{review.productName}</span>
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-right hidden sm:block">
                                                    <p className="text-[10px] font-black text-zinc-700 uppercase tracking-widest leading-none">Data da Postagem</p>
                                                    <p className="text-sm font-bold text-zinc-400 mt-1.5 tracking-tighter">{formatDate(review.createdAt)}</p>
                                                </div>
                                                <div className="p-4 bg-white/[0.03] rounded-3xl border border-white/5 backdrop-blur-xl ring-1 ring-white/5 flex items-center gap-4">
                                                    {renderStars(review.rating)}
                                                    {review.helpful > 0 && (
                                                        <>
                                                            <div className="w-px h-4 bg-zinc-800" />
                                                            <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-full border border-white/5">
                                                                <ThumbsUp className="w-3 h-3 text-emerald-400" />
                                                                <span className="text-[10px] font-bold text-white tracking-tighter">{review.helpful}</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Content Area */}
                                        <div className="relative pl-6 lg:pl-10 mb-8 border-l border-white/10 group-hover:border-emerald-500/30 transition-colors">
                                            <div className="absolute -left-3 -top-2 text-6xl text-white/[0.05] font-serif leading-none select-none pointer-events-none group-hover:text-emerald-500/10 transition-colors">"</div>
                                            <p className="text-lg font-medium text-zinc-300 leading-relaxed tracking-tight lg:pr-12">
                                                {review.comment}
                                            </p>
                                        </div>

                                        {/* Merchant Reply Area */}
                                        {review.merchantReply && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="mb-8 p-6 lg:p-8 bg-emerald-500/[0.02] rounded-[2rem] border border-emerald-500/10 relative overflow-hidden group/reply shadow-inner"
                                            >
                                                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover/reply:opacity-10 transition-opacity">
                                                    <MessageSquare className="w-16 h-16 text-emerald-400" />
                                                </div>
                                                <div className="flex items-center gap-3 mb-4">
                                                    <div className="w-8 h-8 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                                                        <MessageSquare className="w-4 h-4 text-black" />
                                                    </div>
                                                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] italic">Nossa Resposta</span>
                                                </div>
                                                <p className="text-sm font-medium text-emerald-200/60 leading-relaxed italic relative z-10 lg:pr-12">
                                                    "{review.merchantReply}"
                                                </p>
                                            </motion.div>
                                        )}

                                        {/* Action Bar */}
                                        <div className="flex flex-wrap items-center gap-3 pt-8 border-t border-white/5">
                                            <button
                                                onClick={() => toggleVerified(review.id, review.verified)}
                                                className={`flex items-center gap-2.5 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${review.verified
                                                    ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                                                    : 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:scale-[1.02]'
                                                    }`}
                                            >
                                                {review.verified ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                                {review.verified ? 'Remover Verificado' : 'Marcar como Verificado'}
                                            </button>

                                            {!review.merchantReply && (
                                                <button
                                                    onClick={() => {
                                                        setReplyingTo(review.id);
                                                        setReplyText('');
                                                    }}
                                                    className="flex items-center gap-2.5 px-6 py-3 bg-white text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all active:scale-95 shadow-xl shadow-white/5"
                                                >
                                                    <MessageSquare className="w-3.5 h-3.5" /> Responder
                                                </button>
                                            )}

                                            <div className="flex-1" />

                                            {confirmDeleteId === review.id ? (
                                                <div className="flex items-center gap-2 bg-red-500/10 p-2 rounded-2xl border border-red-500/20 animate-in slide-in-from-right-4 duration-300">
                                                    <span className="text-[9px] font-black text-red-400 uppercase tracking-widest px-3">Certeza?</span>
                                                    <button
                                                        onClick={() => handleDelete(review.id)}
                                                        className="px-5 py-2.5 bg-red-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-500 shadow-lg shadow-red-600/20 transition-all font-sans"
                                                    >
                                                        Sim, Apagar
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDeleteId(null)}
                                                        className="px-5 py-2.5 bg-white/5 text-zinc-400 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-white/10 transition-all"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteId(review.id)}
                                                    className="w-12 h-12 flex items-center justify-center bg-red-500/10 text-red-400 rounded-2xl hover:bg-red-500 hover:text-white transition-all duration-300 border border-red-500/10 active:scale-95"
                                                >
                                                    <Trash2 className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>

                                        {/* Inline Reply Form */}
                                        <AnimatePresence>
                                            {replyingTo === review.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                                    animate={{ opacity: 1, height: 'auto', marginTop: 24 }}
                                                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                                    className="overflow-hidden"
                                                >
                                                    <div className="p-8 bg-white/[0.02] rounded-[2.5rem] border border-white/5 ring-1 ring-white/5 shadow-2xl space-y-6">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                                                <MessageSquare className="w-4 h-4 text-emerald-400" />
                                                            </div>
                                                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Formulário de Resposta</span>
                                                        </div>
                                                        <textarea
                                                            value={replyText}
                                                            onChange={(e) => setReplyText(e.target.value)}
                                                            placeholder="Escreva uma resposta atenciosa para este cliente..."
                                                            className="w-full p-6 text-base font-medium bg-black/40 border border-white/10 rounded-3xl text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/30 min-h-[160px] transition-all resize-none"
                                                            disabled={isSubmittingReply}
                                                        />
                                                        <div className="flex justify-end items-center gap-4">
                                                            <button
                                                                onClick={() => setReplyingTo(null)}
                                                                className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors"
                                                                disabled={isSubmittingReply}
                                                            >
                                                                Cancelar
                                                            </button>
                                                            <button
                                                                onClick={async () => {
                                                                    if (!replyText.trim()) return;
                                                                    setIsSubmittingReply(true);
                                                                    const success = await addMerchantReply(review.id, replyText);
                                                                    setIsSubmittingReply(false);
                                                                    if (success) {
                                                                        setReplyingTo(null);
                                                                        setReplyText('');
                                                                        getAllReviews(page, pageSize, {
                                                                            rating: ratingFilter,
                                                                            search: searchQuery
                                                                        });
                                                                    }
                                                                }}
                                                                className="px-8 py-3 bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-[1.02] shadow-xl shadow-emerald-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                                                                disabled={isSubmittingReply || !replyText.trim()}
                                                            >
                                                                {isSubmittingReply ? 'Publicando...' : 'Publicar no Site'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </motion.div>
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Modern Pagination */}
                {totalPages > 1 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex items-center justify-center gap-6 mt-16 pb-12"
                    >
                        <button
                            onClick={() => setPage(prev => Math.max(0, prev - 1))}
                            disabled={page === 0}
                            className="w-14 h-14 flex items-center justify-center bg-white/[0.03] rounded-2xl border border-white/5 text-white shadow-2xl disabled:opacity-20 hover:bg-white/[0.08] transition-all active:scale-90"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </button>

                        <div className="flex items-center gap-3 p-1.5 bg-white/[0.02] rounded-[1.5rem] border border-white/5">
                            {Array.from({ length: totalPages }, (_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setPage(i)}
                                    className={`w-11 h-11 rounded-xl text-[11px] font-black transition-all duration-300 ${page === i
                                        ? 'bg-white text-black shadow-xl shadow-white/20 scale-110'
                                        : 'text-zinc-500 hover:text-white hover:bg-white/5'
                                        }`}
                                >
                                    {i + 1}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => setPage(prev => Math.min(totalPages - 1, prev + 1))}
                            disabled={page === totalPages - 1}
                            className="w-14 h-14 flex items-center justify-center bg-white/[0.03] rounded-2xl border border-white/5 text-white shadow-2xl disabled:opacity-20 hover:bg-white/[0.08] transition-all active:scale-90"
                        >
                            <ArrowLeft className="w-5 h-5 rotate-180" />
                        </button>
                    </motion.div>
                )}
            </div>

            {/* Background Decorative Elements */}
            <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500/5 blur-[120px] rounded-full" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#09090b] z-[-2]" />
            </div>
        </div>
    );
}

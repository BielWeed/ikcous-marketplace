import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { 
    Search, 
    Star, 
    Trash2, 
    ShieldCheck, 
    ShieldOff, 
    ThumbsUp, 
    MessageSquare, 
    ArrowLeft, 
    User, 
    HelpCircle,
    Package,
    Sparkles,
    MessageCircle,
    Clock,
    LayoutGrid,
    List
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { useReviews } from '@/hooks/useReviews';
import type { View } from '@/types';
import { useDebounce } from '@/hooks/useDebounce';
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';

interface AdminReviewsViewProps {
    readonly onNavigate: (view: View) => void;
    readonly active?: boolean;
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

const getAvatarGradient = (name: string) => {
    const colors = [
        'from-amber-500 to-orange-600',
        'from-emerald-500 to-teal-600',
        'from-rose-500 to-red-600',
        'from-blue-500 to-indigo-600',
        'from-purple-500 to-pink-600',
        'from-cyan-500 to-blue-600'
    ];
    let sum = 0;
    for (let i = 0; i < name.length; i++) {
        sum += name.charCodeAt(i);
    }
    return colors[sum % colors.length];
};

export const AdminReviewsView = memo(function AdminReviewsView({ onNavigate: _onNavigate, active = true }: AdminReviewsViewProps) {
    const { adminReviews, loading, getAllReviews, deleteReview, toggleVerified, addMerchantReply } = useReviews();
    const [page, setPage] = useState(0);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [totalReviews, setTotalReviews] = useState(0);
    const pageSize = 10;
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 500);
    const [ratingFilter, setRatingFilter] = useState<number | 'all'>('all');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');
    const [isSubmittingReply, setIsSubmittingReply] = useState(false);
    const [averageRating, setAverageRating] = useState('0.0');
    const [globalVerifiedCount, setGlobalVerifiedCount] = useState(0);
    const [globalRepliedCount, setGlobalRepliedCount] = useState(0);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('compact');

    const triggerRefresh = () => setRefreshTrigger(prev => prev + 1);

    const prevRating = useRef(ratingFilter);
    const prevSearch = useRef(debouncedSearchQuery);

    const loadReviews = useCallback(async (pageToFetch: number) => {
        const result = await getAllReviews(pageToFetch, pageSize, {
            rating: ratingFilter,
            search: debouncedSearchQuery
        });
        if (result) {
            setTotalReviews(result.total);
            setAverageRating(result.averageRating?.toFixed(1) || '0.0');
            setGlobalVerifiedCount(result.globalVerifiedCount || 0);
            setGlobalRepliedCount(result.globalRepliedCount || 0);
        }
    }, [getAllReviews, pageSize, ratingFilter, debouncedSearchQuery]);

    useEffect(() => {
        if (!active) return;

        const filterChanged = prevRating.current !== ratingFilter || prevSearch.current !== debouncedSearchQuery;
        prevRating.current = ratingFilter;
        prevSearch.current = debouncedSearchQuery;

        let pageToFetch = page;
        if (filterChanged) {
            pageToFetch = 0;
            if (page !== 0) {
                setPage(0);
                return;
            }
        }

        loadReviews(pageToFetch);
    }, [page, ratingFilter, debouncedSearchQuery, active, loadReviews, refreshTrigger]);

    const totalPages = Math.ceil(totalReviews / pageSize);
    const avgRating = averageRating;


    // Global Dynamic metrics for display
    const verifiedRate = totalReviews > 0 
        ? Math.round((globalVerifiedCount / totalReviews) * 100) 
        : 100;
    const responseRate = totalReviews > 0 
        ? Math.round((globalRepliedCount / totalReviews) * 100) 
        : 0;

    const handleDelete = async (id: string) => {
        await deleteReview(id);
        setConfirmDeleteId(null);
        if (adminReviews.length === 1 && page > 0) {
            setPage(p => p - 1);
        } else {
            triggerRefresh();
        }
    };

    const formatDate = (dateStr: string) =>
        new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

    const renderStars = (rating: number) => (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(i => (
                <Star
                    key={i}
                    className={`w-4 h-4 transition-all duration-300 ${i <= rating ? 'fill-admin-gold text-admin-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.4)]' : 'text-zinc-800'}`}
                />
            ))}
        </div>
    );

    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        {
            id: 'media',
            label: 'Média Global',
            icon: Star,
            iconClass: "text-admin-gold fill-admin-gold",
            iconBg: "bg-admin-gold/10 border-admin-gold/20",
            hoverBorder: "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)]",
            value: averageRating,
            accent: 'text-admin-gold',
            content: (
                <div className="flex items-center gap-1.5 mt-2 animate-in fade-in">
                    {renderStars(Math.round(Number(averageRating) || 0))}
                </div>
            ),
            footer: "Satisfação dos compradores"
        },
        {
            id: 'total',
            label: 'Total Recebido',
            icon: MessageCircle,
            iconClass: "text-emerald-400",
            iconBg: "bg-emerald-500/10 border-emerald-500/20",
            hoverBorder: "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
            value: totalReviews,
            accent: 'text-emerald-400',
            content: (
                <div className="flex items-center gap-1.5 mt-3 animate-in fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Moderação Ativa</span>
                </div>
            ),
            footer: "Depoimentos coletados"
        },
        {
            id: 'resposta',
            label: 'Taxa de Resposta',
            icon: MessageSquare,
            iconClass: "text-sky-400",
            iconBg: "bg-sky-500/10 border-sky-500/20",
            hoverBorder: "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
            value: `${responseRate}%`,
            accent: 'text-sky-400',
            content: (
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-3 animate-in fade-in">
                    <div className="bg-sky-500 h-full rounded-full transition-all duration-500" style={{ width: `${responseRate}%` }} />
                </div>
            ),
            footer: `${globalRepliedCount} respondidas no total`
        },
        {
            id: 'verificada',
            label: 'Compras Verificadas',
            icon: ShieldCheck,
            iconClass: "text-purple-400",
            iconBg: "bg-purple-500/10 border-purple-500/20",
            hoverBorder: "hover:border-purple-500/30 hover:shadow-[0_0_30px_rgba(168,85,247,0.05)]",
            value: `${verifiedRate}%`,
            accent: 'text-purple-400',
            content: (
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-3 animate-in fade-in">
                    <div className="bg-purple-550 h-full rounded-full transition-all duration-500" style={{ width: `${verifiedRate}%` }} />
                </div>
            ),
            footer: `${globalVerifiedCount} verificadas no total`
        }
    ], [averageRating, totalReviews, responseRate, globalRepliedCount, verifiedRate, globalVerifiedCount]);


    if (loading && adminReviews.length === 0) {
        return (
            <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center space-y-6">
                <div className="relative">
                    <div className="w-16 h-16 border-2 border-zinc-800 border-t-admin-gold rounded-full animate-spin" />
                    <Star className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-admin-gold animate-pulse animate-duration-1000" />
                </div>
                <div className="text-center">
                    <p className="text-sm font-black text-white uppercase tracking-[0.2em]">Carregando Feedback</p>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-2">Sincronizando com a base de dados...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-400 font-sans selection:bg-admin-gold/30 selection:text-white pb-32">
            {/* Header / Stats Overlay */}
            <div className="sticky top-0 z-50 p-2 sm:p-4 pb-0 bg-[#09090b]/80 backdrop-blur-md">
                <div className="admin-glass rounded-2xl sm:rounded-[2rem] border border-white/5 p-3 sm:p-4 shadow-2xl">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        {/* Title & Stats */}
                        <div className="flex items-center justify-between lg:justify-start gap-3 w-full lg:w-auto">
                            <div className="flex items-center gap-2.5">
                                <button
                                    onClick={() => globalThis.history.back()}
                                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group shrink-0"
                                    title="Voltar"
                                >
                                    <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
                                </button>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-lg sm:text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                        <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                                            <span className="text-white italic">Ava</span>
                                            <span className="text-admin-gold not-italic">liações</span>
                                        </span>
                                    </h1>
                                    <button
                                        type="button"
                                        onClick={() => setShowHelpModal(true)}
                                        className="w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                                        title="Guia de Avaliações e Ajuda"
                                    >
                                        <HelpCircle className="w-3 h-3 text-zinc-500 hover:text-white" />
                                    </button>
                                </div>
                            </div>
                            
                            {/* Compact Stats Badges */}
                            <div className="flex items-center gap-1.5">
                                <div className="px-2 py-0.5 bg-admin-gold/10 rounded-lg border border-admin-gold/20 shrink-0" title="Total de avaliações">
                                    <p className="text-[9px] sm:text-[10px] font-black text-admin-gold uppercase tracking-widest">{totalReviews}</p>
                                </div>
                                <div className="flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded-lg border border-white/10 shrink-0" title="Média global de estrelas">
                                    <Star className="w-3 h-3 text-admin-gold fill-admin-gold" />
                                    <span className="text-[9px] sm:text-[10px] font-black text-white tracking-widest">{avgRating}</span>
                                    <span className="text-[8px] text-zinc-500 hidden sm:inline font-bold">MÉDIA</span>
                                </div>
                            </div>
                        </div>

                        {/* Search & Main Filter */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto lg:flex-1 lg:max-w-2xl lg:justify-end">
                            <div className="relative flex-1 group min-w-0">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 group-focus-within:text-admin-gold transition-colors" />
                                <label htmlFor="reviews-search" className="sr-only">Buscar avaliações</label>
                                <input
                                    type="text"
                                    id="reviews-search"
                                    name="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Buscar por cliente ou produto..."
                                    className="w-full pl-9 pr-3 py-2 bg-black/40 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-admin-gold/20 focus:border-admin-gold/50 focus:bg-zinc-950/60 transition-all font-bold"
                                />
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1 p-0.5 bg-black/40 rounded-xl border border-zinc-800 overflow-x-auto no-scrollbar">
                                    <button
                                        onClick={() => setRatingFilter('all')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${ratingFilter === 'all'
                                            ? 'bg-admin-gold text-black shadow-lg shadow-admin-gold/20'
                                            : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        Todas
                                    </button>
                                    {[5, 4, 3, 2, 1].map(star => (
                                        <button
                                            key={star}
                                            onClick={() => setRatingFilter(star)}
                                            className={`px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1 whitespace-nowrap ${ratingFilter === star
                                                ? 'bg-admin-gold text-black shadow-lg shadow-admin-gold/20'
                                                : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                        >
                                            {star} <Star className={`w-3 h-3 ${ratingFilter === star ? 'fill-black text-black' : 'fill-zinc-700 text-zinc-700'}`} />
                                        </button>
                                    ))}
                                </div>
                                
                                <button
                                    type="button"
                                    onClick={() => setViewMode(prev => prev === 'detailed' ? 'compact' : 'detailed')}
                                    className="h-8 w-8 sm:h-9 sm:w-9 rounded-xl border border-zinc-800 bg-black/40 hover:bg-zinc-900 hover:border-admin-gold/50 flex items-center justify-center transition-all shrink-0 active:scale-95 group shadow-lg"
                                    title={viewMode === 'detailed' ? "Visualização Compacta" : "Visualização Detalhada"}
                                >
                                    {viewMode === 'detailed' ? (
                                        <LayoutGrid className="w-3.5 h-3.5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                                    ) : (
                                        <List className="w-3.5 h-3.5 text-zinc-500 group-hover:text-admin-gold transition-colors" />
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* KPI Dashboard Section */}
            <div className="max-w-7xl mx-auto px-4 mt-6 space-y-4">
                <AdminKpiCarousel cards={kpiCards} title="Métricas de Avaliações" />
            </div>

            <div className="max-w-7xl mx-auto p-4 lg:p-8">
                <AnimatePresence mode="wait">
                    {adminReviews.length === 0 ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="flex flex-col items-center justify-center py-24 rounded-[3rem] border border-white/5 bg-zinc-950/40 backdrop-blur-3xl relative overflow-hidden"
                        >
                            <div className="absolute inset-0 bg-radial-gradient from-admin-gold/5 via-transparent to-transparent pointer-events-none" />
                            <div className="w-24 h-24 bg-zinc-900/60 rounded-3xl flex items-center justify-center border border-white/5 mb-8 relative group">
                                <Star className="w-12 h-12 text-zinc-700 group-hover:text-admin-gold group-hover:rotate-12 transition-all duration-500" />
                                <div className="absolute inset-0 bg-admin-gold/20 blur-2xl rounded-full opacity-50" />
                                <Sparkles className="absolute -top-2 -right-2 w-5 h-5 text-admin-gold animate-bounce" />
                            </div>
                            <h3 className="text-xl font-black text-white tracking-tight uppercase">Sem Feedback Ainda</h3>
                            <p className="text-sm font-medium text-zinc-500 mt-2 max-w-xs text-center leading-relaxed">
                                As avaliações e depoimentos de satisfação dos seus clientes aparecerão aqui assim que começarem a chegar.
                            </p>
                        </motion.div>
                    ) : viewMode === 'detailed' ? (
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
                                    <div className="absolute -inset-px bg-gradient-to-r from-admin-gold/10 via-transparent to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[2.5rem]" />
                                    <div className="relative bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 rounded-[2.5rem] border border-white/[0.05] p-6 lg:p-8 backdrop-blur-3xl hover:bg-white/[0.02] hover:border-white/10 transition-all duration-500 overflow-hidden shadow-2xl content-visibility-auto">

                                        {/* Review Header */}
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
                                            <div className="flex items-center gap-5">
                                                <div className="relative">
                                                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${getAvatarGradient(review.customerName)} flex items-center justify-center font-black text-2xl text-white shadow-2xl border border-white/10 ring-4 ring-white/5 transform group-hover:scale-105 transition-transform duration-300`}>
                                                        {review.customerName.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-admin-gold rounded-lg flex items-center justify-center border-2 border-zinc-950 shadow-lg shadow-admin-gold/20">
                                                        <User className="w-3.5 h-3.5 text-black" />
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="flex flex-wrap items-center gap-2.5">
                                                        <p className="text-lg font-black text-white tracking-tight uppercase">{review.customerName}</p>
                                                        {review.verified && (
                                                            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-[9px] font-black uppercase tracking-[0.15em] border border-emerald-500/20 rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                                                                <ShieldCheck className="w-3.5 h-3.5" />
                                                                Compra Verificada
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 mt-2.5">
                                                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Produto:</span>
                                                        <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-zinc-900 border border-white/5 rounded-full text-xs font-black text-admin-gold group-hover:border-admin-gold/30 transition-colors">
                                                            <Package className="w-3.5 h-3.5 text-admin-gold" />
                                                            {review.productName}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-6">
                                                <div className="text-right hidden sm:block">
                                                    <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest leading-none">Data da Postagem</p>
                                                    <p className="text-sm font-bold text-zinc-400 mt-2 tracking-tighter flex items-center gap-1.5 justify-end">
                                                        <Clock className="w-3.5 h-3.5 text-zinc-500" />
                                                        {formatDate(review.createdAt)}
                                                    </p>
                                                </div>
                                                <div className="p-4 bg-zinc-900/60 rounded-3xl border border-white/5 backdrop-blur-xl ring-1 ring-white/5 flex items-center gap-4">
                                                    {renderStars(review.rating)}
                                                    {review.helpful > 0 && (
                                                        <>
                                                            <div className="w-px h-4 bg-zinc-800" />
                                                            <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">
                                                                <ThumbsUp className="w-3 h-3 text-emerald-400 fill-emerald-400/20" />
                                                                <span className="text-[10px] font-bold text-white tracking-tighter">{review.helpful}</span>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Content Area */}
                                        <div className="relative pl-6 lg:pl-10 mb-8 border-l border-white/10 group-hover:border-admin-gold/30 transition-colors">
                                            <div className="absolute -left-3 -top-2 text-6xl text-white/[0.03] font-serif leading-none select-none pointer-events-none group-hover:text-admin-gold/10 transition-colors">"</div>
                                            <p className="text-lg font-medium text-zinc-200 leading-relaxed tracking-tight lg:pr-12">
                                                {review.comment}
                                            </p>
                                        </div>

                                        {/* Merchant Reply Area */}
                                        {review.merchantReply && (
                                            <motion.div
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                className="mb-8 p-6 lg:p-8 bg-admin-gold/[0.02] rounded-[2rem] border border-admin-gold/10 relative overflow-hidden group/reply shadow-inner"
                                            >
                                                <div className="absolute top-0 right-0 p-8 opacity-5 group-hover/reply:opacity-10 transition-opacity">
                                                    <MessageSquare className="w-16 h-16 text-admin-gold" />
                                                </div>
                                                <div className="flex items-center gap-3 mb-4">
                                                    <div className="w-8 h-8 bg-admin-gold rounded-xl flex items-center justify-center shadow-lg shadow-admin-gold/20">
                                                        <MessageSquare className="w-4 h-4 text-black" />
                                                    </div>
                                                    <span className="text-[10px] font-black text-white uppercase tracking-[0.2em] italic">Resposta Oficial da Loja</span>
                                                </div>
                                                <p className="text-sm font-medium text-admin-gold/80 leading-relaxed italic relative z-10 lg:pr-12">
                                                    "{review.merchantReply}"
                                                </p>
                                            </motion.div>
                                        )}

                                        {/* Action Bar */}
                                        <div className="flex flex-wrap items-center gap-3 pt-6 border-t border-white/5">
                                            <button
                                                onClick={() => toggleVerified(review.id, review.verified)}
                                                className={`flex items-center gap-2 px-5 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all duration-300 ${review.verified
                                                    ? 'bg-zinc-900 text-zinc-400 border border-white/5 hover:bg-zinc-800'
                                                    : 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:scale-[1.02]'
                                                    }`}
                                            >
                                                {review.verified ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                                {review.verified ? 'Remover Verificação' : 'Verificar Compra'}
                                            </button>

                                            {!review.merchantReply && (
                                                <button
                                                    onClick={() => {
                                                        setReplyingTo(review.id);
                                                        setReplyText('');
                                                    }}
                                                    className="flex items-center gap-2 px-6 py-3 bg-admin-gold text-black rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] transition-all active:scale-95 shadow-xl shadow-admin-gold/10"
                                                >
                                                    <MessageSquare className="w-3.5 h-3.5" /> Responder
                                                </button>
                                            )}

                                            <div className="flex-1" />

                                            {confirmDeleteId === review.id ? (
                                                <div className="flex items-center gap-2 bg-red-500/10 p-2 rounded-2xl border border-red-500/20 animate-in slide-in-from-right-4 duration-300">
                                                    <span className="text-[9px] font-black text-red-400 uppercase tracking-widest px-3">Confirmar exclusão?</span>
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
                                                    title="Excluir Avaliação"
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
                                                    <div className="p-8 bg-zinc-950/60 rounded-[2.5rem] border border-white/5 ring-1 ring-white/5 shadow-2xl space-y-6">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-full bg-admin-gold/10 flex items-center justify-center">
                                                                <MessageSquare className="w-4 h-4 text-admin-gold" />
                                                            </div>
                                                            <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Formulário de Resposta</span>
                                                        </div>

                                                        {/* Suggested Responses */}
                                                        <div className="space-y-2.5">
                                                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block">Sugestões de Resposta Rápida:</span>
                                                            <div className="flex flex-wrap gap-2">
                                                                {[
                                                                    { label: '👍 Agradecer Feedback', text: 'Muito obrigado pela sua avaliação! Feedbacks como o seu nos motivam a continuar oferecendo a melhor qualidade.' },
                                                                    { label: '🛠️ Dar Suporte', text: 'Olá! Lamentamos muito que sua experiência não tenha sido ideal. Já estamos cientes do seu relato e entraremos em contato via WhatsApp para resolver isso o quanto antes.' },
                                                                    { label: '✨ Feedback Positivo', text: 'Que excelente notícia! Ficamos muito satisfeitos em saber que o produto atendeu suas expectativas. Conte sempre conosco!' },
                                                                    { label: '📝 Esclarecer Produto', text: 'Agradecemos o seu comentário. Gostaríamos de ressaltar que as instruções de uso estão no manual do produto. Qualquer dúvida adicional, estamos à disposição no suporte.' }
                                                                ].map((suggestion, idx) => (
                                                                    <button
                                                                        key={idx}
                                                                        type="button"
                                                                        onClick={() => setReplyText(suggestion.text)}
                                                                        className="px-3.5 py-2 bg-white/5 border border-white/5 hover:border-admin-gold/30 hover:bg-admin-gold/15 rounded-xl text-xs font-bold text-zinc-300 hover:text-white transition-all active:scale-95"
                                                                    >
                                                                        {suggestion.label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <textarea
                                                            value={replyText}
                                                            onChange={(e) => setReplyText(e.target.value)}
                                                            placeholder="Escreva uma resposta atenciosa para este cliente..."
                                                            className="w-full p-6 text-base font-medium bg-black/40 border border-white/10 rounded-3xl text-white placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-admin-gold/20 focus:border-admin-gold/30 min-h-[160px] transition-all resize-none"
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
                                                                            search: debouncedSearchQuery
                                                                        });
                                                                    }
                                                                }}
                                                                className="px-8 py-3 bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest rounded-2xl hover:scale-[1.02] shadow-xl shadow-admin-gold/20 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                                                                disabled={isSubmittingReply || !replyText.trim()}
                                                            >
                                                                {isSubmittingReply ? 'Publicando...' : 'Publicar Resposta'}
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
                    ) : (
                        <motion.div
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                        >
                            {adminReviews.map((review) => (
                                <motion.div
                                    key={review.id}
                                    variants={itemVariants}
                                    layout
                                    className="group relative"
                                >
                                    <div className="absolute -inset-px bg-gradient-to-r from-admin-gold/10 via-transparent to-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-[2rem]" />
                                    <div className="relative bg-zinc-950 bg-gradient-to-br from-zinc-900/40 to-zinc-950/80 rounded-[2rem] border border-white/[0.05] p-5 backdrop-blur-3xl hover:bg-white/[0.02] hover:border-white/10 transition-all duration-500 overflow-hidden shadow-2xl flex flex-col justify-between h-full content-visibility-auto">
                                        <div>
                                            {/* Header with avatar, name and star rating */}
                                            <div className="flex items-start justify-between gap-3 mb-4">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="relative shrink-0">
                                                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getAvatarGradient(review.customerName)} flex items-center justify-center font-black text-sm text-white shadow-lg border border-white/5`}>
                                                            {review.customerName.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-admin-gold rounded flex items-center justify-center border border-zinc-955">
                                                            <User className="w-2.5 h-2.5 text-black" />
                                                        </div>
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1">
                                                            <p className="text-sm font-black text-white truncate uppercase">{review.customerName}</p>
                                                            {review.verified && (
                                                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-450 shrink-0" />
                                                            )}
                                                        </div>
                                                        <span className="text-[8px] font-bold text-zinc-550 uppercase tracking-tight block">
                                                            {formatDate(review.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 bg-zinc-900/80 px-2 py-1 rounded-lg border border-white/5 shrink-0">
                                                    <Star className="w-3 h-3 text-admin-gold fill-admin-gold" />
                                                    <span className="text-[10px] font-black text-white">{review.rating}</span>
                                                </div>
                                            </div>

                                            {/* Product link tag */}
                                            <div className="mb-3">
                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-zinc-900 border border-white/5 rounded-full text-[10px] font-black text-admin-gold truncate max-w-full">
                                                    <Package className="w-3 h-3 text-admin-gold shrink-0" />
                                                    <span className="truncate">{review.productName}</span>
                                                </span>
                                            </div>

                                            {/* Comment */}
                                            <p className="text-xs text-zinc-400 font-medium leading-relaxed line-clamp-3 mb-4 italic">
                                                "{review.comment}"
                                            </p>

                                            {/* Merchant Reply Indicator */}
                                            {review.merchantReply && (
                                                <div className="mb-4 p-3 bg-admin-gold/[0.02] rounded-xl border border-admin-gold/10 flex items-start gap-2">
                                                    <MessageSquare className="w-3.5 h-3.5 text-admin-gold shrink-0 mt-0.5" />
                                                    <p className="text-[10px] text-admin-gold/80 italic line-clamp-2">
                                                        "{review.merchantReply}"
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center justify-between gap-2 pt-4 border-t border-white/5 mt-auto">
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => toggleVerified(review.id, review.verified)}
                                                    className={`p-2 rounded-xl transition-all duration-300 ${review.verified
                                                        ? 'bg-zinc-900 text-zinc-550 border border-white/5 hover:bg-zinc-800'
                                                        : 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/20 hover:scale-105'
                                                        }`}
                                                    title={review.verified ? 'Remover Verificação' : 'Verificar Compra'}
                                                >
                                                    <ShieldCheck className="w-4 h-4" />
                                                </button>

                                                {!review.merchantReply && (
                                                    <button
                                                        onClick={() => {
                                                            setReplyingTo(review.id);
                                                            setReplyText('');
                                                        }}
                                                        className="p-2 bg-admin-gold text-black rounded-xl hover:scale-105 transition-all shadow-md shadow-admin-gold/10"
                                                        title="Responder"
                                                    >
                                                        <MessageSquare className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>

                                            {confirmDeleteId === review.id ? (
                                                <div className="flex items-center gap-1 bg-red-500/10 p-1 rounded-xl border border-red-500/20 animate-in slide-in-from-right-4 duration-300">
                                                    <button
                                                        onClick={() => handleDelete(review.id)}
                                                        className="px-2 py-1 bg-red-650 text-white text-[9px] font-black uppercase rounded-lg hover:bg-red-550 transition-all"
                                                    >
                                                        Sim
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDeleteId(null)}
                                                        className="px-2 py-1 bg-white/5 text-zinc-400 text-[9px] font-black rounded-lg hover:bg-white/10 transition-all"
                                                    >
                                                        Não
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteId(review.id)}
                                                    className="p-2 bg-red-500/10 text-red-400 rounded-xl hover:bg-red-500 hover:text-white transition-all duration-300 border border-red-500/10 active:scale-95"
                                                    title="Excluir"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        {/* Inline Reply Form (Compact version) */}
                                        <AnimatePresence>
                                            {replyingTo === review.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                                                    animate={{ opacity: 1, height: 'auto', marginTop: 12 }}
                                                    exit={{ opacity: 0, height: 0, marginTop: 0 }}
                                                    className="overflow-hidden absolute inset-x-0 bottom-0 bg-zinc-950 p-4 border-t border-white/10 rounded-b-[2rem] z-20"
                                                >
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-[8px] font-black text-white uppercase tracking-widest">Responder</span>
                                                            <button 
                                                                onClick={() => setReplyingTo(null)} 
                                                                className="text-zinc-550 hover:text-white text-[10px]"
                                                            >
                                                                ✕
                                                            </button>
                                                        </div>
                                                        <textarea
                                                            value={replyText}
                                                            onChange={(e) => setReplyText(e.target.value)}
                                                            placeholder="Resposta..."
                                                            className="w-full p-3 text-xs bg-black/45 border border-white/10 rounded-xl text-white placeholder:text-zinc-700 focus:outline-none focus:ring-1 focus:ring-admin-gold/30 min-h-[80px] transition-all resize-none"
                                                            disabled={isSubmittingReply}
                                                        />
                                                        <div className="flex justify-end gap-2">
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
                                                                            search: debouncedSearchQuery
                                                                        });
                                                                    }
                                                                }}
                                                                className="px-4 py-1.5 bg-admin-gold text-black text-[9px] font-black uppercase rounded-lg hover:scale-105 transition-all disabled:opacity-50"
                                                                disabled={isSubmittingReply || !replyText.trim()}
                                                            >
                                                                {isSubmittingReply ? 'Enviando...' : 'Responder'}
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
                        className="flex items-center justify-center gap-6 mt-16"
                    >
                        <button
                            onClick={() => setPage(prev => Math.max(0, prev - 1))}
                            disabled={page === 0}
                            className="w-14 h-14 flex items-center justify-center bg-zinc-950/50 rounded-2xl border border-white/5 text-white shadow-2xl disabled:opacity-20 hover:bg-zinc-900 transition-all active:scale-90"
                        >
                            <ArrowLeft className="w-5 h-5 text-zinc-400" />
                        </button>

                        <div className="flex items-center gap-3 p-1.5 bg-zinc-950/30 rounded-[1.5rem] border border-white/5">
                            {Array.from({ length: totalPages }, (_, i) => (
                                <button
                                    key={i}
                                    onClick={() => setPage(i)}
                                    className={`w-11 h-11 rounded-xl text-[11px] font-black transition-all duration-300 ${page === i
                                        ? 'bg-admin-gold text-black shadow-xl shadow-admin-gold/20 scale-110'
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
                            className="w-14 h-14 flex items-center justify-center bg-zinc-950/50 rounded-2xl border border-white/5 text-white shadow-2xl disabled:opacity-20 hover:bg-zinc-900 transition-all active:scale-90"
                        >
                            <ArrowLeft className="w-5 h-5 rotate-180 text-zinc-400" />
                        </button>
                    </motion.div>
                )}
            </div>

            {/* Modal de Ajuda */}
            {showHelpModal && (
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-zinc-300 text-sm">
                  {/* Header */}
                  <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                    <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                      Guia de Moderação de Avaliações
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(false)}
                      className="w-8 h-8 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all flex items-center justify-center font-bold text-sm"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Scrollable Content */}
                  <div className="flex-1 overflow-y-auto space-y-6 pr-1 pb-6 custom-scrollbar text-zinc-300 text-sm">
                    <div className="space-y-4">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Esta tela permite auditar e moderar o feedback dos clientes sobre as compras. A moderação de avaliações garante que o feed de depoimentos se mantenha limpo, verídico e útil para novos compradores.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Principais Recursos
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Star className="w-4 h-4 text-admin-gold fill-admin-gold" />
                              Nota por Estrelas (1-5)
                            </div>
                            <p className="text-xs text-zinc-400">
                              O nível de satisfação do cliente. A média global de estrelas é calculada na parte superior de forma dinâmica.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <ShieldCheck className="w-4 h-4 text-emerald-400" />
                              Compra Verificada
                            </div>
                            <p className="text-xs text-zinc-400">
                              Indica se o cliente de fato realizou a compra desse item pela plataforma. Você pode marcar ou desmarcar manualmente.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <MessageSquare className="w-4 h-4 text-sky-400" />
                              Resposta Oficial da Loja
                            </div>
                            <p className="text-xs text-zinc-400">
                              Você pode responder diretamente ao comentário do cliente com atalhos de resposta rápidas predefinidas para dar suporte.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Trash2 className="w-4 h-4 text-red-400" />
                              Exclusão Preventiva
                            </div>
                            <p className="text-xs text-zinc-400">
                              Avaliações com linguagem imprópria ou spam podem ser permanentemente removidas do sistema clicando no ícone de lixeira.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="pt-4 border-t border-white/5 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(false)}
                      className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all font-bold"
                    >
                      Entendi
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Background Decorative Elements */}
            <div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-admin-gold/5 blur-[120px] rounded-full animate-pulse animate-duration-3000" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-white/5 blur-[120px] rounded-full" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-[#09090b] z-[-2]" />
            </div>
        </div>
    );
});
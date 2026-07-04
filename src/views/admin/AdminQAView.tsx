import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { LazyImage } from '@/components/LazyImage';
import { 
    MessageSquare, 
    ArrowLeft, 
    Trash2, 
    HelpCircle, 
    Send, 
    Calendar, 
    CheckCircle2, 
    ChevronLeft, 
    ChevronRight, 
    Search,
    MessageCircle,
    Clock,
    LayoutGrid,
    List,
    Sparkles,
    Check,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    Loader2
} from 'lucide-react';
import { useQuestions } from '@/hooks/useQuestions';
import type { Question } from '@/hooks/useQuestions';
import type { View } from '@/types';
import { toast } from 'sonner';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { DebouncedSearchInput } from '@/components/admin/DebouncedSearchInput';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { AdminKpiCarousel, type KpiCardConfig } from '@/components/admin/AdminKpiCarousel';

interface AdminQAViewProps {
    readonly onNavigate: (view: View) => void;
    readonly active?: boolean;
}

const containerVariants: Variants = {
    hidden: { opacity: 0 },
    visible: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05
        }
    }
};

const itemVariants: Variants = {
    hidden: { y: 15, opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: {
            type: "spring",
            stiffness: 120,
            damping: 18
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
    const cleanName = name || 'Usuario';
    for (let i = 0; i < cleanName.length; i++) {
        sum += cleanName.charCodeAt(i);
    }
    return colors[sum % colors.length];
};

let cachedQAStats: {
    total: number;
    pending: number;
    answered: number;
    rate: number;
} | null = null;

export const AdminQAView = memo(function AdminQAView({ onNavigate, active = true }: AdminQAViewProps) {
    const { questions, loading, getAllQuestions, addAnswer, deleteQuestion, subscribeToQuestions } = useQuestions();
    const isOffline = useOnlineStatus();
    const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
    const [answer, setAnswer] = useState('');
    const [showHelpModal, setShowHelpModal] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [filter, setFilter] = useState<'pending' | 'all'>('pending');
    const [page, setPage] = useState(0);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const pageSize = 10;

    // Redesign Added States
    const [viewMode, setViewMode] = useState<'detailed' | 'compact'>('compact');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    const [totalCount, setTotalCount] = useState(() => cachedQAStats?.total || 0);
    const [pendingCount, setPendingCount] = useState(() => cachedQAStats?.pending || 0);
    const [answeredCount, setAnsweredCount] = useState(() => cachedQAStats?.answered || 0);
    const [responseRate, setResponseRate] = useState(() => cachedQAStats?.rate || 0);

    // Dynamic metrics fetching
    const fetchStats = useCallback(async () => {
        try {
            const [totalRes, pendingRes] = await Promise.all([
                supabase.from('vw_questions_with_answers_count' as any).select('*', { count: 'exact', head: true }),
                supabase.from('vw_questions_with_answers_count' as any).select('*', { count: 'exact', head: true }).eq('answers_count', 0)
            ]);

            const total = totalRes.count || 0;
            const pending = pendingRes.count || 0;
            const answered = Math.max(0, total - pending);
            const rate = total > 0 ? Math.round((answered / total) * 100) : 0;

            cachedQAStats = {
                total,
                pending,
                answered,
                rate
            };
            setTotalCount(total);
            setPendingCount(pending);
            setAnsweredCount(answered);
            setResponseRate(rate);
        } catch (error) {
            console.error('Error fetching QA stats:', error);
        }
    }, []);

    useEffect(() => {
        if (active) {
            fetchStats();
        }
    }, [fetchStats, refreshTrigger, questions, active]);

    const firstLoadRef = useRef(true);

    const loadQuestions = useCallback((pageToFetch: number) => {
        getAllQuestions(pageToFetch, pageSize, filter, searchQuery).then(result => {
            if (result) {
                setTotalQuestions(result.total);
                const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
                if (pageToFetch > maxPage) {
                    setPage(maxPage);
                }
            }
            firstLoadRef.current = false;
        }).catch(() => {
            firstLoadRef.current = false;
        });
    }, [getAllQuestions, pageSize, filter, searchQuery]);

    const prevFilter = useRef(filter);
    const prevSearch = useRef(searchQuery);

    useEffect(() => {
        if (!active) return;

        const filterChanged = prevFilter.current !== filter || prevSearch.current !== searchQuery;
        prevFilter.current = filter;
        prevSearch.current = searchQuery;

        let pageToFetch = page;
        if (filterChanged) {
            pageToFetch = 0;
            if (page !== 0) {
                setPage(0);
                return;
            }
        }

        loadQuestions(pageToFetch);
    }, [page, filter, searchQuery, active, loadQuestions]);

    const onQuestionEventRef = useRef<() => void>(() => {});

    useEffect(() => {
        onQuestionEventRef.current = () => {
            loadQuestions(page);
        };
    }, [loadQuestions, page]);

    useEffect(() => {
        if (!active) return;
        const unsubscribe = subscribeToQuestions(() => {
            onQuestionEventRef.current();
        });
        return () => unsubscribe();
    }, [subscribeToQuestions, active]);

    const handleSendAnswer = async () => {
        if (isOffline) {
            toast.error('Você está offline', {
                description: 'Não é possível enviar respostas sem conexão com a internet.'
            });
            return;
        }
        if (!selectedQuestion || !answer.trim()) return;

        setIsSubmitting(true);
        try {
            const success = await addAnswer({
                questionId: selectedQuestion.id,
                answer: answer
            }, { silent: true });

            if (success) {
                toast.success('Resposta enviada com sucesso!');
                setSelectedQuestion(null);
                setAnswer('');
                setRefreshTrigger(prev => prev + 1);
                getAllQuestions(page, pageSize, filter, searchQuery);
            }
        } catch (error) {
            console.error('Error answering:', error);
            toast.error('Erro ao processar resposta');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (isOffline) {
            toast.error('Você está offline', {
                description: 'Não é possível excluir perguntas sem conexão com a internet.'
            });
            return;
        }
        await deleteQuestion(id, { silent: true });
        toast.success('Pergunta excluída');
        setConfirmDeleteId(null);
        setRefreshTrigger(prev => prev + 1);
        getAllQuestions(page, pageSize, filter, searchQuery);
    };

    const totalPages = Math.ceil(totalQuestions / pageSize);

    const kpiCards = useMemo<readonly KpiCardConfig[]>(() => [
        {
            id: 'pendentes',
            label: 'Dúvidas Pendentes',
            icon: AlertCircle,
            iconClass: pendingCount > 0 ? "text-amber-400 animate-pulse" : "text-zinc-500",
            iconBg: "bg-amber-500/10 border-amber-500/20",
            hoverBorder: "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
            value: pendingCount,
            accent: 'text-amber-400',
            content: (
                <div className="flex items-center gap-1.5 mt-3 animate-in fade-in">
                    <span className={cn("w-1.5 h-1.5 rounded-full bg-amber-500", pendingCount > 0 && "animate-pulse")} />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">
                        {pendingCount > 0 ? "Ação Requerida" : "Fila Limpa"}
                    </span>
                </div>
            ),
            footer: "Clientes aguardando retorno"
        },
        {
            id: 'taxa_resposta',
            label: 'Taxa de Resposta',
            icon: MessageSquare,
            iconClass: "text-emerald-400",
            iconBg: "bg-emerald-500/10 border-emerald-500/20",
            hoverBorder: "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
            value: `${responseRate}%`,
            accent: 'text-emerald-400',
            content: (
                <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden mt-3 animate-in fade-in">
                    <div className="bg-emerald-500 h-full rounded-full transition-all duration-500" style={{ width: `${responseRate}%` }} />
                </div>
            ),
            footer: `${answeredCount} de ${totalCount} respondidas`
        },
        {
            id: 'total',
            label: 'Total de Perguntas',
            icon: MessageCircle,
            iconClass: "text-sky-400",
            iconBg: "bg-sky-500/10 border-sky-500/20",
            hoverBorder: "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
            value: totalCount,
            accent: 'text-sky-400',
            content: (
                <div className="flex items-center gap-1.5 mt-3 animate-in fade-in">
                    <Clock className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Desde o início</span>
                </div>
            ),
            footer: "Dúvidas totais enviadas"
        },
        {
            id: 'conversao',
            label: 'Conversão Comercial',
            icon: Sparkles,
            iconClass: "text-admin-gold fill-admin-gold",
            iconBg: "bg-admin-gold/10 border-admin-gold/20",
            hoverBorder: "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)]",
            value: "Impacto Alto",
            accent: 'text-admin-gold',
            content: (
                <div className="flex items-center gap-1.5 mt-3 animate-in fade-in">
                    <span className="w-1.5 h-1.5 rounded-full bg-admin-gold animate-pulse" />
                    <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Respostas Ajudam a Vender</span>
                </div>
            ),
            footer: "Q&A aumenta a confiança"
        }
    ], [pendingCount, responseRate, answeredCount, totalCount]);

    const renderSkeleton = () => (
        <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-6 space-y-4 animate-pulse">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-white/5" />
                            <div className="space-y-2">
                                <div className="h-3 w-24 bg-white/5 rounded" />
                                <div className="h-2 w-16 bg-white/5 rounded" />
                            </div>
                        </div>
                        <div className="h-4 w-20 bg-white/5 rounded-full" />
                    </div>
                    <div className="h-4 w-3/4 bg-white/5 rounded" />
                    <div className="h-10 w-full bg-white/5 rounded-xl" />
                </div>
            ))}
        </div>
    );

    const renderCompactSkeleton = () => (
        <div className="border border-white/5 bg-white/[0.02] rounded-3xl overflow-hidden divide-y divide-white/5">
            {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="p-4 flex items-center justify-between gap-4 animate-pulse">
                    <div className="flex items-center gap-3 flex-1">
                        <div className="w-8 h-8 rounded-full bg-white/5 shrink-0" />
                        <div className="space-y-1.5 flex-1 max-w-lg">
                            <div className="h-3 w-1/4 bg-white/5 rounded" />
                            <div className="h-2 w-3/4 bg-white/5 rounded" />
                        </div>
                    </div>
                    <div className="h-4 w-20 bg-white/5 rounded-full shrink-0" />
                    <div className="flex gap-2">
                        <div className="w-9 h-9 bg-white/5 rounded-xl" />
                        <div className="w-9 h-9 bg-white/5 rounded-xl" />
                    </div>
                </div>
            ))}
        </div>
    );

    const renderEmptyState = () => (
        <motion.div
            key="empty"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-20 px-6 relative overflow-hidden"
        >
            <div className="absolute w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

            <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6 relative group shadow-2xl">
                <div className="absolute inset-0 bg-emerald-500/20 blur-xl rounded-3xl opacity-50 group-hover:opacity-80 transition-opacity" />
                <MessageSquare className="w-10 h-10 text-emerald-400 relative z-10" />
                <Sparkles className="absolute -top-2 -right-2 w-5 h-5 text-admin-gold animate-pulse" />
            </div>
            
            <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tight">Fila de Perguntas Limpa</h3>
            <p className="text-zinc-500 text-xs max-w-xs text-center font-medium leading-relaxed">
                Todos os seus clientes estão bem informados e suas dúvidas foram respondidas. Ótimo trabalho de suporte!
            </p>
        </motion.div>
    );

    const renderCompactList = () => {
        return (
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="border border-white/5 bg-white/[0.01] rounded-3xl overflow-hidden divide-y divide-white/5"
            >
                {questions.map((q) => {
                    const isAnswered = q.answers.length > 0;
                    const initials = q.customerName ? q.customerName.charAt(0).toUpperCase() : '?';
                    const avatarGrad = getAvatarGradient(q.customerName);
                    const isConfirmingDelete = confirmDeleteId === q.id;
                    const isExpandedRow = expandedQuestionId === q.id;

                    return (
                        <motion.div
                            key={q.id}
                            variants={itemVariants}
                            layout
                            className="p-4 flex flex-col hover:bg-white/[0.02] transition-all group"
                        >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div 
                                    className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                                    onClick={() => setExpandedQuestionId(isExpandedRow ? null : q.id)}
                                >
                                    {/* Avatar */}
                                    <div className={cn("w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-black text-white shrink-0 shadow-lg", avatarGrad)}>
                                        {initials}
                                    </div>
                                    
                                    {/* Question and Meta */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                            <span className="text-xs font-bold text-white truncate max-w-[150px]">
                                                {q.customerName}
                                            </span>
                                            <span className="text-[10px] text-zinc-500 font-bold">
                                                {new Date(q.createdAt).toLocaleDateString('pt-BR')}
                                            </span>
                                            <span className="text-[9px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-zinc-400 font-bold truncate max-w-[180px]">
                                                {q.productName}
                                            </span>
                                        </div>
                                        <p className={cn("text-xs text-zinc-300 italic transition-all", isExpandedRow ? "whitespace-pre-wrap" : "truncate pr-6")}>
                                            "{q.question}"
                                        </p>
                                    </div>
                                </div>

                                {/* Status & Actions */}
                                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                                    <div 
                                        className="cursor-pointer"
                                        onClick={() => setExpandedQuestionId(isExpandedRow ? null : q.id)}
                                    >
                                        {isAnswered ? (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-wider">
                                                <Check className="w-2.5 h-2.5" /> Respondida
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-wider animate-pulse">
                                                <Clock className="w-2.5 h-2.5" /> Pendente
                                            </span>
                                        )}
                                    </div>

                                    {/* Actions Group */}
                                    <div className="flex items-center gap-1.5">
                                        {isConfirmingDelete ? (
                                            <div className="flex items-center gap-1 bg-red-950/40 border border-red-500/20 rounded-xl p-0.5">
                                                <button
                                                    onClick={() => handleDelete(q.id)}
                                                    className="px-2.5 py-1 text-[9px] font-black bg-red-500 text-white rounded-lg hover:bg-red-400 transition-colors"
                                                >
                                                    Sim
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDeleteId(null)}
                                                    className="px-2 py-1 text-[9px] font-bold text-zinc-400 hover:text-white transition-colors"
                                                >
                                                    Não
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    disabled={isOffline}
                                                    onClick={() => setConfirmDeleteId(q.id)}
                                                    className="w-8 h-8 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/15 flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
                                                    title="Excluir Pergunta"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                                {!isAnswered ? (
                                                    <button
                                                        disabled={isOffline}
                                                        onClick={() => setSelectedQuestion(q)}
                                                        className="h-8 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-all disabled:opacity-40 disabled:pointer-events-none"
                                                    >
                                                        <MessageSquare className="w-3 h-3" /> Responder
                                                    </button>
                                                ) : (
                                                    <button
                                                        disabled={isOffline}
                                                        onClick={() => {
                                                            setSelectedQuestion(q);
                                                            setAnswer(q.answers[0].answer);
                                                        }}
                                                        className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-white/10 flex items-center justify-center transition-all disabled:opacity-40 disabled:pointer-events-none"
                                                        title="Editar Resposta"
                                                    >
                                                        <MessageSquare className="w-3.5 h-3.5 text-emerald-400" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setExpandedQuestionId(isExpandedRow ? null : q.id)}
                                                    className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white border border-white/10 flex items-center justify-center transition-all sm:flex"
                                                >
                                                    {isExpandedRow ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded content under compact row */}
                            <AnimatePresence>
                                {isExpandedRow && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden mt-3 pl-11 space-y-3"
                                    >
                                        <div className="p-4 rounded-2xl bg-white/[0.01] border border-white/5">
                                            <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Pergunta Completa</span>
                                            <p className="text-xs text-zinc-300 italic">"{q.question}"</p>
                                        </div>

                                        {isAnswered && (
                                            <div className="p-4 rounded-2xl bg-emerald-500/[0.02] border border-emerald-500/10 relative overflow-hidden">
                                                <div className="absolute top-0 left-0 w-[2px] h-full bg-emerald-500/30" />
                                                <div className="flex items-center justify-between mb-1.5">
                                                    <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest block">Resposta da Loja</span>
                                                    <span className="text-[8px] text-zinc-500 font-bold">
                                                        {new Date(q.answers[0].createdAt).toLocaleDateString('pt-BR')}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-zinc-300 leading-relaxed font-medium">{q.answers[0].answer}</p>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
            </motion.div>
        );
    };

    const renderDetailedList = () => {
        return (
            <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-6"
            >
                {questions.map((q) => {
                    const isAnswered = q.answers.length > 0;
                    const initials = q.customerName ? q.customerName.charAt(0).toUpperCase() : '?';
                    const avatarGrad = getAvatarGradient(q.customerName);
                    const isConfirmingDelete = confirmDeleteId === q.id;

                    return (
                        <motion.div
                            key={q.id}
                            variants={itemVariants}
                            layout
                            className="group relative bg-[#121214]/60 hover:bg-[#161619]/80 border border-white/5 hover:border-white/10 rounded-[2rem] overflow-hidden transition-all duration-300 shadow-xl hover:shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
                        >
                            <div className="absolute inset-0 bg-radial-gradient from-emerald-500/[0.01] via-transparent to-transparent pointer-events-none" />

                            <div className="p-6 md:p-8 relative z-10">
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                                    <div className="flex-1 space-y-5">
                                        {/* Meta Info */}
                                        <div className="flex flex-wrap items-center gap-2.5">
                                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                                                <div className={cn("w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center text-[9px] font-black text-white", avatarGrad)}>
                                                    {initials}
                                                </div>
                                                <span className="text-[10px] font-black text-zinc-300 uppercase tracking-wider leading-none mt-0.5">
                                                    {q.customerName}
                                                </span>
                                            </div>

                                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                                                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                                                <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider leading-none mt-0.5">
                                                    {new Date(q.createdAt).toLocaleDateString('pt-BR')}
                                                </span>
                                            </div>

                                            {isAnswered ? (
                                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/5">
                                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                                    <span className="text-[9px] font-black uppercase tracking-wider leading-none mt-0.5">Respondida</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 shadow-lg shadow-amber-500/5 animate-pulse">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    <span className="text-[9px] font-black uppercase tracking-wider leading-none mt-0.5">Pendente</span>
                                                </div>
                                            )}
                                        </div>

                                        {/* Question Content */}
                                        <div className="relative pl-6 border-l border-emerald-500/30 min-h-[60px] flex items-center">
                                            <div className="absolute -left-2 -top-4 text-7xl text-white/[0.02] font-serif leading-none select-none pointer-events-none group-hover:text-emerald-500/5 transition-colors">
                                                “
                                            </div>
                                            <p className="text-base md:text-lg font-medium text-zinc-200 italic leading-relaxed">
                                                "{q.question}"
                                            </p>
                                        </div>

                                        {/* Product Reference */}
                                        <div className="inline-flex items-center gap-3 p-1.5 pr-4 bg-white/5 border border-white/10 rounded-2xl group/product transition-all hover:bg-white/10 hover:border-emerald-500/20">
                                            <div className="relative w-9 h-9 rounded-xl overflow-hidden bg-zinc-800 shrink-0">
                                                <LazyImage
                                                    src={q.productImage || 'https://placehold.co/100x100?text=S/I'}
                                                    alt={q.productName || 'Produto'}
                                                    className="w-full h-full object-cover transition-transform duration-500 group-hover/product:scale-110"
                                                />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1">Referente ao produto</span>
                                                <span className="text-xs font-black text-zinc-300 uppercase truncate max-w-[220px]">{q.productName}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex items-center md:flex-col justify-end gap-3 shrink-0">
                                        {isConfirmingDelete ? (
                                            <div className="flex flex-col gap-1 bg-red-950/40 border border-red-500/20 rounded-2xl p-2 w-28 text-center">
                                                <span className="text-[8px] font-black text-red-400 uppercase tracking-wider mb-1">Excluir?</span>
                                                <button
                                                    onClick={() => handleDelete(q.id)}
                                                    className="w-full py-1.5 text-[10px] font-black bg-red-500 text-white rounded-xl hover:bg-red-400 transition-colors"
                                                >
                                                    Sim, Excluir
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDeleteId(null)}
                                                    className="w-full py-1 text-[10px] font-bold text-zinc-400 hover:text-white transition-colors mt-0.5"
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <button
                                                    disabled={isOffline}
                                                    onClick={() => setConfirmDeleteId(q.id)}
                                                    className="w-12 h-12 flex items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/5 group/del disabled:opacity-40 disabled:pointer-events-none"
                                                    title="Excluir Pergunta"
                                                >
                                                    <Trash2 className="w-5 h-5 transition-transform group-hover/del:scale-110" />
                                                </button>

                                                {!isAnswered && (
                                                    <button
                                                        disabled={isOffline}
                                                        onClick={() => setSelectedQuestion(q)}
                                                        className="h-12 px-6 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white border border-emerald-400 shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2 group/rep font-black text-xs uppercase tracking-widest disabled:opacity-40 disabled:pointer-events-none"
                                                    >
                                                        <MessageSquare className="w-4 h-4 shrink-0 transition-transform group-hover/rep:rotate-12" />
                                                        <span>Responder</span>
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>

                                {/* Answers section */}
                                <AnimatePresence>
                                    {isAnswered && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: "auto", opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.3 }}
                                            className="mt-6 pt-6 border-t border-white/5 space-y-4"
                                        >
                                            {q.answers.map(ans => (
                                                <div key={ans.id} className="relative p-5 rounded-2xl bg-white/[0.02] border border-white/5 group/ans overflow-hidden">
                                                    <div className="absolute top-0 left-0 w-[3px] h-full bg-emerald-500/40" />
                                                    <div className="flex items-center justify-between mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-5 h-5 rounded-lg bg-emerald-500/25 text-emerald-400 flex items-center justify-center">
                                                                <Send className="w-2.5 h-2.5" />
                                                            </div>
                                                            <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Resposta da Loja</span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[9px] text-zinc-500 font-bold mr-1">
                                                                {new Date(ans.createdAt).toLocaleDateString('pt-BR')}
                                                            </span>
                                                            <button
                                                                disabled={isOffline}
                                                                onClick={() => {
                                                                    setSelectedQuestion(q);
                                                                    setAnswer(ans.answer);
                                                                }}
                                                                className="px-2 py-0.5 text-[9px] font-black bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-zinc-400 hover:text-white transition-all disabled:opacity-40 disabled:pointer-events-none"
                                                            >
                                                                Editar
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <p className="text-sm text-zinc-300 leading-relaxed font-medium">
                                                        {ans.answer}
                                                    </p>
                                                </div>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                            <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent" />
                        </motion.div>
                    );
                })}
            </motion.div>
        );
    };

    const renderContent = () => {
        if ((loading || firstLoadRef.current) && questions.length === 0) {
            return (
                <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="py-12"
                >
                    {viewMode === 'compact' ? renderCompactSkeleton() : renderSkeleton()}
                </motion.div>
            );
        }

        if (questions.length === 0) {
            return renderEmptyState();
        }

        return (
            <div className={cn("transition-opacity duration-300", loading && "opacity-50 pointer-events-none")}>
                {viewMode === 'compact' ? renderCompactList() : renderDetailedList()}
            </div>
        );
    };

    return (
        <div className="h-auto bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30 pb-8 animate-in fade-in duration-500">
            
            {/* Header Sticky */}
            <div className="sticky top-0 z-50 p-2 sm:p-4 pb-0 bg-[#09090b]/80 backdrop-blur-md">
                <div className="admin-glass rounded-2xl sm:rounded-[2rem] border border-white/5 p-3 sm:p-4 shadow-2xl">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        {/* Title & Stats */}
                        <div className="flex items-center justify-between lg:justify-start gap-3 w-full lg:w-auto">
                            <div className="flex items-center gap-2.5">
                                <button
                                    onClick={() => onNavigate('admin-settings')}
                                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors group shrink-0"
                                    title="Voltar"
                                >
                                    <ArrowLeft className="w-4 h-4 text-zinc-400 group-hover:text-white transition-colors" />
                                </button>
                                <div className="flex items-center gap-2">
                                    <h1 className="text-lg sm:text-xl md:text-2xl font-black text-white tracking-tight flex items-center gap-2">
                                        <span className="flex items-baseline flex-nowrap whitespace-nowrap">
                                            <span className="text-white italic">Per</span>
                                            <span className="text-admin-gold not-italic">guntas</span>
                                        </span>
                                    </h1>
                                    <button
                                        type="button"
                                        onClick={() => setShowHelpModal(true)}
                                        className="w-6 h-6 rounded-full flex items-center justify-center border transition-all duration-300 active:scale-95 bg-zinc-900/60 border-white/5 text-zinc-500 hover:text-white hover:border-white/10 shrink-0"
                                        title="Guia de Q&A e Ajuda"
                                    >
                                        <HelpCircle className="w-3 h-3 text-zinc-500 hover:text-white" />
                                    </button>
                                </div>
                            </div>
                            
                            {/* Compact Stats Badges */}
                            <div className="flex items-center gap-1.5">
                                <div className="px-2 py-0.5 bg-admin-gold/10 rounded-lg border border-admin-gold/20 shrink-0" title="Total de perguntas">
                                    <p className="text-[9px] sm:text-[10px] font-black text-admin-gold uppercase tracking-widest">{totalCount}</p>
                                </div>
                                {pendingCount > 0 && (
                                    <div className="flex items-center gap-1 px-2 py-0.5 bg-amber-500/10 rounded-lg border border-amber-500/20 shrink-0 animate-pulse" title="Pendentes">
                                        <span className="w-1 h-1 rounded-full bg-amber-500" />
                                        <span className="text-[9px] sm:text-[10px] font-black text-amber-400 tracking-widest">{pendingCount} PENDENTES</span>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Search & Main Filter */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto lg:flex-1 lg:max-w-2xl lg:justify-end">
                            <div className="relative flex-1 group min-w-0">
                                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                                    {loading || isTyping ? (
                                        <Loader2 className="w-3.5 h-3.5 text-admin-gold animate-spin" />
                                    ) : (
                                        <Search className="w-3.5 h-3.5 text-zinc-500 group-focus-within:text-admin-gold transition-colors" />
                                    )}
                                </div>
                                <label htmlFor="qa-search" className="sr-only">Buscar perguntas</label>
                                <DebouncedSearchInput
                                    id="qa-search"
                                    name="search"
                                    placeholder="Buscar por cliente ou pergunta..."
                                    className="w-full pl-9 pr-3 py-2 bg-black/40 border border-zinc-800 rounded-xl text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-admin-gold/20 focus:border-admin-gold/50 focus:bg-zinc-950/60 transition-all font-bold"
                                    value={searchQuery}
                                    onChange={setSearchQuery}
                                    onTyping={setIsTyping}
                                    delay={300}
                                />
                            </div>
                            
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1 p-0.5 bg-black/40 rounded-xl border border-zinc-800 overflow-x-auto no-scrollbar">
                                    <button
                                        onClick={() => setFilter('pending')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${filter === 'pending'
                                            ? 'bg-admin-gold text-black shadow-lg shadow-admin-gold/20'
                                            : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        Pendentes
                                    </button>
                                    <button
                                        onClick={() => setFilter('all')}
                                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${filter === 'all'
                                            ? 'bg-admin-gold text-black shadow-lg shadow-admin-gold/20'
                                            : 'text-zinc-500 hover:text-white hover:bg-white/5'}`}
                                    >
                                        Todas
                                    </button>
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
                <AdminKpiCarousel cards={kpiCards} loading={loading && !cachedQAStats} title="Métricas de Suporte (SAC)" />
            </div>

            <main className="max-w-7xl mx-auto px-4 mt-8">
                <AnimatePresence mode="wait">
                    {renderContent()}
                </AnimatePresence>

                {/* Pagination Modern */}
                {!loading && totalPages > 1 && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col sm:flex-row items-center justify-between gap-6 px-4 py-12"
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Página</span>
                            <div className="flex items-center gap-1">
                                <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-black">
                                    {page + 1}
                                </span>
                                <span className="text-[11px] font-bold text-zinc-650 uppercase">de</span>
                                <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 border border-white/10 text-zinc-300 text-xs font-black">
                                    {totalPages}
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setPage(prev => Math.max(0, prev - 1))}
                                disabled={page === 0}
                                className="h-12 px-6 flex items-center gap-3 bg-white/[0.03] border border-white/10 rounded-2xl text-zinc-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-30 disabled:pointer-events-none group"
                            >
                                <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                                <span className="text-[10px] font-black uppercase tracking-widest mt-0.5">Anterior</span>
                            </button>
                            <button
                                onClick={() => setPage(prev => Math.min(totalPages - 1, prev + 1))}
                                disabled={page === totalPages - 1}
                                className="h-12 px-6 flex items-center gap-3 bg-emerald-500 text-white rounded-2xl border border-emerald-400 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-all disabled:opacity-30 disabled:pointer-events-none group font-black"
                            >
                                <span className="text-[10px] uppercase tracking-widest mt-0.5">Seguinte</span>
                                <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </button>
                        </div>
                    </motion.div>
                )}
            </main>

            {/* Answer Modal Premium */}
            <Dialog open={!!selectedQuestion} onOpenChange={() => setSelectedQuestion(null)}>
                <DialogContent className="sm:max-w-xl bg-[#09090b] border-white/10 p-0 overflow-hidden rounded-[2.5rem] shadow-2xl">
                    <div className="p-8 md:p-10">
                        <DialogHeader className="mb-8">
                            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
                                <MessageSquare className="w-8 h-8 text-emerald-400" />
                            </div>
                            <DialogTitle className="text-2xl font-black text-white tracking-tight flex items-center gap-3 uppercase">
                                Enviar Resposta
                            </DialogTitle>
                            <DialogDescription className="text-xs font-bold text-zinc-500 uppercase tracking-[0.1em] mt-2 flex items-center gap-2">
                                Atendimento ao cliente • {selectedQuestion?.customerName}
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-8">
                            <div className="relative p-6 rounded-3xl bg-white/[0.02] border border-white/5 overflow-hidden">
                                <div className="absolute top-0 right-0 p-4 opacity-10">
                                    <MessageSquare className="w-12 h-12" />
                                </div>
                                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-2">Pergunta Original</span>
                                <p className="text-sm font-medium text-zinc-300 italic leading-relaxed relative z-10">
                                    "{selectedQuestion?.question}"
                                </p>
                            </div>

                            <div className="space-y-3">
                                <div className="flex justify-between items-center ml-1">
                                    <label htmlFor="merchant-answer" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Sua Mensagem Specialist</label>
                                    <span className="text-[10px] text-zinc-500 font-bold">{answer.length} caracteres</span>
                                </div>
                                <div className="relative">
                                    <textarea
                                        id="merchant-answer"
                                        value={answer}
                                        onChange={(e) => setAnswer(e.target.value)}
                                        disabled={isOffline}
                                        placeholder={isOffline ? "Você está offline. Não é possível responder no momento." : "Dê uma resposta completa e persuasiva para encantar o cliente..."}
                                        className="w-full h-48 px-6 py-6 bg-white/[0.03] border border-white/10 rounded-[2rem] text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all resize-none shadow-inner scrollbar-hide disabled:opacity-40"
                                    />
                                    <div className="absolute bottom-4 right-6 flex items-center gap-2 pointer-events-none opacity-40">
                                        <Send className="w-4 h-4 text-emerald-400" />
                                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Notificar Cliente</span>
                                    </div>
                                </div>
                            </div>

                            {isOffline && (
                                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-3 text-red-400">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    <span className="text-xs font-bold uppercase tracking-wider">Modo Offline Ativo</span>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-4 pt-2">
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setSelectedQuestion(null)}
                                    className="flex-1 h-14 bg-white/5 text-zinc-400 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 hover:text-white transition-colors duration-200"
                                >
                                    Descartar
                                </motion.button>
                                <motion.button
                                    whileHover={isOffline ? {} : { scale: 1.02 }}
                                    whileTap={isOffline ? {} : { scale: 0.98 }}
                                    onClick={handleSendAnswer}
                                    disabled={isSubmitting || !answer.trim() || isOffline}
                                    className="flex-[2] h-14 bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 border border-emerald-400 hover:bg-emerald-400 transition-colors duration-200 disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3"
                                >
                                    {isSubmitting ? (
                                        <>
                                            <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                            <span>Enviando...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Send className="w-4 h-4" />
                                            <span>Publicar Resposta</span>
                                        </>
                                    )}
                                </motion.button>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Ajuda */}
            {showHelpModal && (
              <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-300 text-left">
                <div className="relative bg-zinc-950/95 border border-white/10 rounded-[2rem] sm:rounded-[2.5rem] w-full max-w-2xl p-5 sm:p-8 flex flex-col max-h-[88vh] sm:max-h-[85vh] shadow-[0_0_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in zoom-in-95 duration-300 text-zinc-300 text-sm">
                  
                  {/* Header */}
                  <div className="flex justify-between items-center pb-4 border-b border-white/5 mb-4 shrink-0">
                    <h3 className="text-sm font-black text-admin-gold uppercase tracking-[0.2em] flex items-center gap-2">
                      <HelpCircle className="w-5 h-5 text-admin-gold animate-pulse" />
                      Guia de Dúvidas (Q&A)
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
                        A Central de Perguntas & Respostas funciona como um canal de suporte assíncrono (SAC) diretamente na página dos produtos. Responder essas dúvidas ajuda a aumentar a taxa de conversão da loja.
                      </p>

                      <div className="space-y-3">
                        <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 border-l-2 border-admin-gold pl-2">
                          Fluxo Operacional
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <MessageSquare className="w-4 h-4 text-emerald-500" />
                              Dúvidas Pendentes
                            </div>
                            <p className="text-xs text-zinc-400">
                              Questões enviadas por compradores em potencial sobre um produto específico (especificações, compatibilidade, prazos).
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Send className="w-4 h-4 text-admin-gold" />
                              Resposta Oficial
                            </div>
                            <p className="text-xs text-zinc-400">
                              Ao responder uma pergunta, ela se torna visível publicamente no app para que outros clientes que tenham a mesma dúvida possam ler imediatamente.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <Trash2 className="w-4 h-4 text-sky-500" />
                              Exclusão Preventiva
                            </div>
                            <p className="text-xs text-zinc-400">
                              Se a dúvida contiver linguagem ofensiva, links externos maliciosos ou for spam, você pode excluí-la de forma permanente.
                            </p>
                          </div>

                          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-white/5 space-y-1">
                            <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
                              <CheckCircle2 className="w-4 h-4 text-purple-500" />
                              Filtros Rápidos
                            </div>
                            <p className="text-xs text-zinc-400">
                              Você pode filtrar para ver apenas perguntas pendentes de resposta, facilitando o fluxo de atendimento diário.
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
                      className="px-5 py-2.5 rounded-xl bg-admin-gold text-black text-[10px] font-black uppercase tracking-widest hover:bg-admin-gold/90 transition-all"
                    >
                      Entendi
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>
    );
});

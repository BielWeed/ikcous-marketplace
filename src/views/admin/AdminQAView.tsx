import { useState, useEffect } from 'react';
import { MessageSquare, ArrowLeft, Trash2, HelpCircle, Send, Calendar, User, Filter, CheckCircle2, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useQuestions } from '@/hooks/useQuestions';
import type { Question } from '@/hooks/useQuestions';
import type { View } from '@/types';
import { toast } from 'sonner';
import { motion, AnimatePresence, type Variants } from 'framer-motion';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

interface AdminQAViewProps {
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
    hidden: { y: 20, opacity: 0 },
    visible: {
        y: 0,
        opacity: 1,
        transition: {
            type: "spring",
            stiffness: 100,
            damping: 15
        }
    }
};

export function AdminQAView({ onNavigate }: AdminQAViewProps) {
    const { questions, loading, getAllQuestions, addAnswer, deleteQuestion, subscribeToQuestions } = useQuestions();
    const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(null);
    const [answer, setAnswer] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [filter, setFilter] = useState<'pending' | 'all'>('pending');
    const [page, setPage] = useState(0);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [searchQuery, setSearchQuery] = useState('');
    const pageSize = 10;

    useEffect(() => {
        const load = async () => {
            const result = await getAllQuestions(page, pageSize, filter);
            if (result) setTotalQuestions(result.total);
        };
        load();
        const unsubscribe = subscribeToQuestions();
        return () => unsubscribe();
    }, [getAllQuestions, subscribeToQuestions, page, filter]);

    const handleSendAnswer = async () => {
        if (!selectedQuestion || !answer.trim()) return;

        setIsSubmitting(true);
        try {
            const success = await addAnswer({
                questionId: selectedQuestion.id,
                answer: answer
            });

            if (success) {
                toast.success('Resposta enviada com sucesso!');
                setSelectedQuestion(null);
                setAnswer('');
                getAllQuestions(page, pageSize, filter);
            }
        } catch (error) {
            console.error('Error answering:', error);
            toast.error('Erro ao processar resposta');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (globalThis.confirm('Tem certeza que deseja excluir esta pergunta?')) {
            await deleteQuestion(id);
            toast.success('Pergunta excluída');
            getAllQuestions(page, pageSize, filter);
        }
    };

    const totalPages = Math.ceil(totalQuestions / pageSize);

    const renderContent = () => {
        if (loading) {
            return (
                <motion.div
                    key="loading"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-24"
                >
                    <div className="relative w-16 h-16">
                        <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full" />
                        <div className="absolute inset-0 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                    <p className="mt-6 text-sm font-bold text-zinc-500 uppercase tracking-widest animate-pulse">
                        Carregando FAQ...
                    </p>
                </motion.div>
            );
        }

        if (questions.length === 0) {
            return (
                <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center justify-center py-24 px-6 bg-white/[0.02] border border-dashed border-white/10 rounded-[2.5rem]"
                >
                    <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center mb-6">
                        <MessageSquare className="w-10 h-10 text-emerald-400" />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Sem novas perguntas</h3>
                    <p className="text-zinc-500 text-sm max-w-xs text-center">
                        Todos os seus clientes estão bem informados. Ótimo trabalho!
                    </p>
                </motion.div>
            );
        }

        return (
            <motion.div
                key="list"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="grid gap-4"
            >
                {questions.map((q) => (
                    <motion.div
                        key={q.id}
                        variants={itemVariants}
                        layout
                        className="group relative bg-white/[0.03] hover:bg-white/[0.05] border border-white/10 rounded-[2rem] overflow-hidden transition-all duration-300"
                    >
                        <div className="p-6 md:p-8">
                            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
                                <div className="flex-1 space-y-4">
                                    {/* Meta Info */}
                                    <div className="flex flex-wrap items-center gap-3">
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                                            <User className="w-3.5 h-3.5 text-emerald-400" />
                                            <span className="text-[11px] font-bold text-zinc-300 uppercase leading-none mt-0.5">
                                                {q.customerName}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                                            <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                                            <span className="text-[11px] font-bold text-zinc-500 uppercase leading-none mt-0.5">
                                                {new Date(q.createdAt).toLocaleDateString('pt-BR')}
                                            </span>
                                        </div>
                                        {q.answers.length > 0 && (
                                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                                                <CheckCircle2 className="w-3.5 h-3.5" />
                                                <span className="text-[10px] font-bold uppercase tracking-wider leading-none mt-0.5">Respondida</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Question Content */}
                                    <div className="relative pl-6 border-l-2 border-emerald-500/30">
                                        <p className="text-lg md:text-xl font-medium text-zinc-100 italic leading-relaxed">
                                            "{q.question}"
                                        </p>
                                    </div>

                                    {/* Product Reference */}
                                    <div className="inline-flex items-center gap-3 p-2 pr-4 bg-white/5 border border-white/10 rounded-2xl group/product transition-all hover:bg-white/10">
                                        <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-zinc-800">
                                            <img
                                                src={q.productImage || 'https://placehold.co/100x100?text=S/I'}
                                                alt={q.productName}
                                                className="w-full h-full object-cover transition-transform group-hover/product:scale-110"
                                            />
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mb-1">Referente ao produto</span>
                                            <span className="text-xs font-bold text-zinc-200 uppercase truncate max-w-[200px]">{q.productName}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-2 md:flex-col shrink-0">
                                    <motion.button
                                        whileHover={{ scale: 1.05 }}
                                        whileTap={{ scale: 0.95 }}
                                        onClick={() => handleDelete(q.id)}
                                        className="w-12 h-12 flex items-center justify-center rounded-2xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-500/5 group/del"
                                    >
                                        <Trash2 className="w-5 h-5 transition-transform group-hover/del:scale-110" />
                                    </motion.button>

                                    {q.answers.length === 0 && (
                                        <motion.button
                                            whileHover={{ scale: 1.05 }}
                                            whileTap={{ scale: 0.95 }}
                                            onClick={() => setSelectedQuestion(q)}
                                            className="h-12 flex-1 md:w-12 items-center justify-center rounded-2xl bg-emerald-500 text-white border border-emerald-400 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 transition-all flex"
                                        >
                                            <MessageSquare className="w-5 h-5 shrink-0" />
                                            <span className="md:hidden ml-3 text-xs font-bold uppercase tracking-widest">Responder Agora</span>
                                        </motion.button>
                                    )}
                                </div>
                            </div>

                            {/* Display Answers if exist */}
                            <AnimatePresence>
                                {q.answers.length > 0 && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        className="mt-8 space-y-4"
                                    >
                                        {q.answers.map(ans => (
                                            <div key={ans.id} className="relative p-6 rounded-3xl bg-white/5 border border-white/10 group/ans overflow-hidden">
                                                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500/30" />
                                                <div className="flex items-center gap-2 mb-3">
                                                    <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                                                        <Send className="w-3 h-3" />
                                                    </div>
                                                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Resposta do Merchant</span>
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
                        <div className="absolute inset-x-0 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
                    </motion.div>
                ))}
            </motion.div>
        );
    };

    return (
        <div className="min-h-screen bg-[#09090b] text-zinc-100 selection:bg-emerald-500/30">
            {/* Header Sticky */}
            <header className="w-full">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <motion.button
                            whileHover={{ scale: 1.05, x: -2 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => onNavigate('admin-dashboard')}
                            className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-zinc-400 hover:text-white"
                        >
                            <ArrowLeft className="w-5 h-5" />
                        </motion.button>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                                Perguntas & Respostas
                                {' '}
                                <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-bold uppercase tracking-wider border border-emerald-500/20">
                                    Suporte
                                </span>
                            </h1>
                            <div className="flex items-center gap-3 mt-0.5">
                                <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                                    <HelpCircle className="w-3 h-3" />
                                    {totalQuestions} dúvidas registradas
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className="hidden md:flex items-center gap-3">
                        <div className="flex flex-col items-end">
                            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest leading-none mb-1">Status do SAC</span>
                            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                {' '}
                                Atendimento em Tempo Real
                            </span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
                {/* Control Bar */}
                <div className="flex flex-col md:flex-row gap-4 mb-8">
                    <div className="flex-1 relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-emerald-400 transition-colors" />
                        <label htmlFor="qa-search" className="sr-only">Buscar perguntas</label>
                        <input
                            type="text"
                            id="qa-search"
                            name="search"
                            placeholder="Buscar por cliente ou pergunta..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full h-12 pl-11 pr-4 bg-white/[0.03] border border-white/10 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all"
                        />
                    </div>

                    <div className="flex items-center gap-2 p-1 bg-white/[0.03] border border-white/10 rounded-2xl">
                        <button
                            onClick={() => setFilter('pending')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${filter === 'pending'
                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            <Calendar className="w-3.5 h-3.5" />
                            Pendentes
                        </button>
                        <button
                            onClick={() => setFilter('all')}
                            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all ${filter === 'all'
                                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                                : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                        >
                            <Filter className="w-3.5 h-3.5" />
                            Todas
                        </button>
                    </div>
                </div>

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
                                <span className="text-[11px] font-bold text-zinc-600 uppercase">de</span>
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
                                <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest block mb-2">Pergunta Original</span>
                                <p className="text-sm font-medium text-zinc-300 italic leading-relaxed relative z-10">
                                    "{selectedQuestion?.question}"
                                </p>
                            </div>

                            <div className="space-y-3">
                                <label htmlFor="merchant-answer" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Sua Mensagem Specialist</label>
                                <div className="relative">
                                    <textarea
                                        id="merchant-answer"
                                        value={answer}
                                        onChange={(e) => setAnswer(e.target.value)}
                                        placeholder="Dê uma resposta completa e persuasiva para encantar o cliente..."
                                        className="w-full h-48 px-6 py-6 bg-white/[0.03] border border-white/10 rounded-[2rem] text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/40 transition-all resize-none shadow-inner scrollbar-hide"
                                    />
                                    <div className="absolute bottom-4 right-6 flex items-center gap-2 pointer-events-none opacity-40">
                                        <Send className="w-4 h-4 text-emerald-400" />
                                        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Notificar Cliente</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row gap-4 pt-2">
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setSelectedQuestion(null)}
                                    className="flex-1 h-14 bg-white/5 text-zinc-400 rounded-2xl text-[11px] font-black uppercase tracking-widest border border-white/10 hover:bg-white/10 hover:text-white transition-all"
                                >
                                    Descartar
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={handleSendAnswer}
                                    disabled={isSubmitting || !answer.trim()}
                                    className="flex-[2] h-14 bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 border border-emerald-400 hover:bg-emerald-400 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3"
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
        </div>
    );
}


import { useEffect, useState } from 'react';
import { useQuestions } from '@/hooks/useQuestions';
import { Input } from '@/components/ui/input';
import { MessageCircle, Send, User, ShieldCheck, Clock, Reply, Sparkles } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from '@/hooks/useAuth';

interface ProductQAProps {
    productId: string;
}

export function ProductQA({ productId }: ProductQAProps) {
    const { questions, loading, getQuestionsByProduct, addQuestion, addAnswer } = useQuestions();
    const { user, isAdmin } = useAuth();
    const [newQuestion, setNewQuestion] = useState('');
    const [replyingTo, setReplyingTo] = useState<string | null>(null);
    const [replyText, setReplyText] = useState('');

    useEffect(() => {
        getQuestionsByProduct(productId);
    }, [productId, getQuestionsByProduct]);

    const handleAsk = async () => {
        if (!newQuestion.trim()) return;
        await addQuestion({ productId, question: newQuestion });
        setNewQuestion('');
    };

    const handleReply = async (questionId: string) => {
        if (!replyText.trim()) return;
        await addAnswer({ questionId, answer: replyText });
        setReplyText('');
        setReplyingTo(null);
        getQuestionsByProduct(productId);
    };

    return (
        <div className="space-y-8 max-w-2xl mx-auto">
            {/* Ask Section - Premium Card */}
            <div className="bg-zinc-950 rounded-[2.5rem] p-8 text-white relative overflow-hidden group border border-white/5 shadow-2xl">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-[60px]" />

                <div className="relative z-10">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-white/10 backdrop-blur-xl rounded-2xl flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform duration-500">
                            <MessageCircle className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-[0.2em]">Dúvidas?</h3>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Nossa equipe responde rápido</p>
                        </div>
                    </div>

                    <div className="relative">
                        <Input
                            value={newQuestion}
                            onChange={(e) => setNewQuestion(e.target.value)}
                            placeholder="Digite sua pergunta aqui..."
                            className="bg-white/5 border-white/10 h-14 rounded-2xl px-6 text-sm placeholder:text-zinc-600 focus:ring-primary/20 transition-all"
                        />
                        <button
                            onClick={handleAsk}
                            disabled={!newQuestion.trim()}
                            className="absolute right-2 top-2 h-10 w-10 bg-white text-zinc-900 rounded-xl flex items-center justify-center hover:bg-primary transition-all active:scale-90 disabled:opacity-20 shadow-lg"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Questions Feed */}
            <div className="space-y-6">
                {loading ? (
                    <div className="text-center py-10">
                        <div className="w-8 h-8 border-2 border-zinc-100 border-t-zinc-900 rounded-full animate-spin mx-auto mb-4" />
                        <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Sincronizando conversas...</p>
                    </div>
                ) : questions.length === 0 ? (
                    <div className="text-center py-16 bg-zinc-50 rounded-[3rem] border border-dashed border-zinc-200">
                        <MessageCircle className="w-12 h-12 text-zinc-200 mx-auto mb-4 opacity-50" />
                        <p className="text-zinc-900 font-black text-lg tracking-tighter">Sem perguntas ainda</p>
                        <p className="text-zinc-400 text-xs mt-1">Seja o primeiro a tirar uma dúvida!</p>
                    </div>
                ) : (
                    questions.map((q, index) => (
                        <div
                            key={q.id}
                            className="group animate-in fade-in slide-in-from-bottom-4 duration-500"
                            style={{ animationDelay: `${index * 100}ms` }}
                        >
                            <div className="flex gap-4">
                                {/* User Avatar */}
                                <div className="flex-shrink-0">
                                    <div className="w-10 h-10 rounded-2xl bg-zinc-100 flex items-center justify-center border border-zinc-200">
                                        <User className="w-5 h-5 text-zinc-400" />
                                    </div>
                                </div>

                                {/* Question Content */}
                                <div className="flex-1 space-y-4">
                                    <div className="bg-white border border-zinc-100 p-6 rounded-3xl rounded-tl-none shadow-premium-sm group-hover:shadow-premium-md transition-all duration-500 relative">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] font-black text-zinc-900 uppercase tracking-widest">{q.customerName}</span>
                                                {q.isVerified && (
                                                    <div className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100">
                                                        <ShieldCheck className="w-2.5 h-2.5" />
                                                        <span className="text-[7px] font-black uppercase tracking-tighter italic">Comprador Verificado</span>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1 text-zinc-400">
                                                <Clock className="w-3 h-3" />
                                                <span className="text-[9px] font-bold uppercase tracking-tighter">
                                                    {formatDistanceToNow(new Date(q.createdAt), { addSuffix: true, locale: ptBR })}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-zinc-900 text-[13px] font-medium leading-relaxed italic border-l-2 border-zinc-100 pl-4">{q.question}</p>
                                    </div>

                                    {/* Answers */}
                                    {q.answers.map((a) => (
                                        <div key={a.id} className="flex gap-3 ml-6 animate-in slide-in-from-left-4 duration-500">
                                            <div className="flex-shrink-0">
                                                <div className="w-10 h-10 rounded-2xl bg-zinc-900 flex items-center justify-center shadow-2xl border border-white/10 ring-4 ring-zinc-50">
                                                    <ShieldCheck className="w-5 h-5 text-primary" />
                                                </div>
                                            </div>
                                            <div className="flex-1 bg-zinc-900 text-white p-5 rounded-[2rem] rounded-tl-none border border-white/5 relative shadow-22xl group/answer">
                                                <div className="absolute -top-3 left-4 bg-primary text-zinc-900 px-3 py-1 rounded-full border-2 border-zinc-900 flex items-center gap-1.5 shadow-xl scale-90 group-hover:scale-100 transition-transform duration-500">
                                                    <Sparkles className="w-3 h-3" />
                                                    <span className="text-[8px] font-black uppercase tracking-[0.2em]">Equipe Ikcous</span>
                                                </div>
                                                <p className="text-zinc-100 text-[12px] leading-relaxed lowercase first-letter:uppercase pt-1">{a.answer}</p>
                                                <div className="flex justify-end mt-3 opacity-40 group-hover:opacity-100 transition-opacity">
                                                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true, locale: ptBR })}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}

                                    {/* Reply Button for Admin/Logged Users */}
                                    {(isAdmin || user) && (
                                        <div className="ml-14">
                                            {replyingTo === q.id ? (
                                                <div className="space-y-3 animate-in fade-in zoom-in-95 duration-200">
                                                    <div className="relative">
                                                        <Input
                                                            value={replyText}
                                                            onChange={(e) => setReplyText(e.target.value)}
                                                            placeholder="Escreva sua resposta oficial..."
                                                            className="h-10 text-xs bg-zinc-50 border-zinc-200 rounded-xl pr-10 focus:ring-zinc-900"
                                                            autoFocus
                                                        />
                                                        <button
                                                            onClick={() => handleReply(q.id)}
                                                            className="absolute right-1 top-1 h-8 w-8 bg-zinc-900 text-white rounded-lg flex items-center justify-center hover:bg-black transition-all"
                                                        >
                                                            <Send className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <button
                                                        onClick={() => setReplyingTo(null)}
                                                        className="text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-red-500 transition-colors"
                                                    >
                                                        Cancelar
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setReplyingTo(q.id)}
                                                    className="flex items-center gap-2 text-[10px] font-black text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-all group/reply"
                                                >
                                                    <Reply className="w-3 h-3 transition-transform group-hover/reply:-translate-x-1" />
                                                    Responder Pergunta
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

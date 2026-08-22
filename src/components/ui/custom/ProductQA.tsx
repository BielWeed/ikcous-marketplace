import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/useAuth";
import { useQuestions } from "@/hooks/useQuestions";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, Lock, MessageSquare, Reply, Send } from "lucide-react";
import { useEffect, useState } from "react";

import type { Question } from "@/hooks/useQuestions";
import type { View } from "@/types";

interface ProductQAProps {
  productId: string;
  onNavigate?: (view: View, id?: string) => void;
}

export function ProductQA({ productId, onNavigate }: ProductQAProps) {
  const {
    questions,
    loading,
    getQuestionsByProduct,
    addQuestion,
    addAnswer,
    subscribeToQuestions,
  } = useQuestions();
  const { user, profile, isAdmin } = useAuth();
  const currentUserAvatar =
    profile?.avatar_url || user?.user_metadata?.avatar_url;
  const [newQuestion, setNewQuestion] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    getQuestionsByProduct(productId);

    const unsubscribe = subscribeToQuestions(() => {
      getQuestionsByProduct(productId);
    }, productId);

    return () => {
      unsubscribe();
    };
  }, [productId, getQuestionsByProduct, subscribeToQuestions]);

  const handleAsk = async () => {
    if (!newQuestion.trim()) return;
    await addQuestion({ productId, question: newQuestion });
    setNewQuestion("");
  };

  const handleReply = async (questionId: string) => {
    if (!replyText.trim()) return;
    await addAnswer({ questionId, answer: replyText });
    setReplyText("");
    setReplyingTo(null);
    getQuestionsByProduct(productId);
  };

  // Achado da revisão da #100: esta caixa é a segunda chamadora de addAnswer
  // (a primeira é o modal do painel, AdminQAView.tsx), e ela nascia sempre
  // vazia -- inclusive em pergunta já respondida. Com a RPC fazendo upsert
  // por question_id (migration 20260812000000), enviar ali sobrescreve a
  // resposta anterior sem o admin ver o que está perdendo. O pré-preenchimento
  // só acontece AQUI, no clique que abre a caixa -- nunca em cada render,
  // senão o admin não consegue apagar o texto para escrever outra coisa.
  const openReplyBox = (q: Question) => {
    // answers vem ordenado ascendente por createdAt (useQuestions.ts) -- a
    // mais recente é a última posição, não a primeira. Ver correção #2 da
    // revisão da Trilha 3 (issue #100).
    setReplyText(q.answers.at(-1)?.answer ?? "");
    setReplyingTo(q.id);
  };

  const getInitials = (name: string) => {
    if (!name) return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (
      parts[0].charAt(0) + parts[parts.length - 1].charAt(0)
    ).toUpperCase();
  };

  const handleNavigateToAuth = () => {
    globalThis.history.pushState({ view: "auth" }, "", "/auth");
    globalThis.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h3 className="text-lg font-extrabold tracking-tight text-zinc-900">
          Perguntas e Respostas
        </h3>
        <p className="text-xs text-zinc-500">
          Tem alguma dúvida sobre o produto? Pergunte ao vendedor.
        </p>
      </div>

      {/* Ask Section */}
      {user ? (
        <div className="rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm transition-all duration-300 hover:shadow-md">
          <div className="mb-4 flex items-center gap-3">
            <Avatar className="size-9 border border-zinc-200/50 shadow-sm transition-transform duration-300 hover:scale-105">
              <AvatarImage
                src={currentUserAvatar || undefined}
                className="object-cover"
              />
              <AvatarFallback className="flex select-none items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-xs font-bold text-zinc-700">
                {getInitials(
                  profile?.full_name ||
                    user?.user_metadata?.full_name ||
                    user?.email ||
                    "",
                )}
              </AvatarFallback>
            </Avatar>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-900">
                Nova Pergunta
              </h4>
              <p className="text-[10px] text-zinc-400">
                Nossa equipe responde rápido
              </p>
            </div>
          </div>
          <div className="relative flex items-center">
            <input
              id="qa-new-question"
              name="newQuestion"
              type="text"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              placeholder="Escreva sua dúvida sobre o produto..."
              className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 px-4 py-3.5 pr-12 text-sm transition-all duration-300 placeholder:text-zinc-400 focus:border-primary focus:bg-white focus:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/10"
            />
            <button
              onClick={handleAsk}
              disabled={!newQuestion.trim()}
              className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition-all duration-300 hover:opacity-90 hover:shadow-md active:scale-95 disabled:pointer-events-none disabled:opacity-20"
              title="Enviar pergunta"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center rounded-3xl border border-zinc-100 bg-zinc-50/50 p-6 text-center shadow-sm">
          <div className="mb-3 flex size-10 items-center justify-center rounded-2xl border border-zinc-200/50 bg-zinc-100">
            <Lock className="size-4 text-zinc-400" />
          </div>
          <h4 className="text-sm font-bold text-zinc-950">
            Quer tirar uma dúvida?
          </h4>
          <p className="mb-4 mt-1 max-w-[280px] text-xs leading-relaxed text-zinc-500">
            Faça login ou cadastre-se para enviar perguntas sobre este produto e
            receber notificações da nossa equipe.
          </p>
          <button
            onClick={handleNavigateToAuth}
            className="rounded-full bg-primary px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
          >
            Entrar na Conta
          </button>
        </div>
      )}

      {/* Questions Feed */}
      <div className="space-y-4">
        {loading ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 size-6 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-900" />
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
              Sincronizando conversas...
            </p>
          </div>
        ) : questions.length === 0 ? (
          <div className="flex flex-col items-center rounded-3xl border border-zinc-100 bg-gradient-to-b from-zinc-50/50 to-zinc-100/10 px-6 py-12 text-center shadow-sm">
            <div className="relative mb-4 flex size-14 items-center justify-center">
              <div className="absolute inset-0 animate-pulse rounded-full bg-zinc-100/50" />
              <div className="flex size-10 items-center justify-center rounded-full border border-zinc-200/60 bg-white shadow-sm">
                <MessageSquare className="size-4 text-zinc-400" />
              </div>
            </div>
            <p className="text-sm font-bold tracking-tight text-zinc-900">
              Sem perguntas ainda
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Seja o primeiro a tirar uma dúvida!
            </p>
          </div>
        ) : (
          questions.map((q, index) => (
            <div
              key={q.id}
              className="space-y-4 rounded-3xl border border-zinc-100 bg-white p-5 shadow-sm transition-all duration-300 duration-500 animate-in fade-in slide-in-from-bottom-4 hover:shadow-md"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Question Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    onClick={() =>
                      onNavigate &&
                      q.userId &&
                      onNavigate("user-profile", q.userId)
                    }
                    role={onNavigate && q.userId ? "button" : undefined}
                    tabIndex={onNavigate && q.userId ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (
                        onNavigate &&
                        q.userId &&
                        (e.key === "Enter" || e.key === " ")
                      ) {
                        e.preventDefault();
                        onNavigate("user-profile", q.userId);
                      }
                    }}
                    className={
                      onNavigate && q.userId
                        ? "cursor-pointer select-none transition-transform duration-200 active:scale-95"
                        : ""
                    }
                  >
                    <Avatar className="size-9 border border-zinc-200/50 shadow-sm transition-transform duration-300 hover:scale-105">
                      <AvatarImage
                        src={q.customerAvatar || undefined}
                        className="object-cover"
                      />
                      <AvatarFallback className="flex select-none items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200 text-xs font-bold text-zinc-700">
                        {getInitials(q.customerName)}
                      </AvatarFallback>
                    </Avatar>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        onClick={() =>
                          onNavigate &&
                          q.userId &&
                          onNavigate("user-profile", q.userId)
                        }
                        role={onNavigate && q.userId ? "button" : undefined}
                        tabIndex={onNavigate && q.userId ? 0 : undefined}
                        onKeyDown={(e) => {
                          if (
                            onNavigate &&
                            q.userId &&
                            (e.key === "Enter" || e.key === " ")
                          ) {
                            e.preventDefault();
                            onNavigate("user-profile", q.userId);
                          }
                        }}
                        className={`text-sm font-bold tracking-tight text-zinc-900 ${onNavigate && q.userId ? "cursor-pointer hover:underline" : ""}`}
                      >
                        {q.customerName}
                      </span>
                      {q.isVerified && (
                        <span className="flex items-center gap-0.5 rounded-md border border-emerald-100/50 bg-emerald-50/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                          <Check className="size-2.5" />
                          Comprador
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                  {formatDistanceToNow(new Date(q.createdAt), {
                    addSuffix: true,
                    locale: ptBR,
                  })}
                </span>
              </div>

              {/* Question Text */}
              <p className="pl-12 text-xs font-medium leading-relaxed text-zinc-800 md:text-sm">
                {q.question}
              </p>

              {/* Answers */}
              {q.answers.length > 0 && (
                <div className="space-y-3 border-t border-zinc-100 pt-3">
                  {q.answers.map((a) => (
                    <div
                      key={a.id}
                      className="group/answer relative flex gap-3 rounded-2xl border border-zinc-100 bg-zinc-50/60 p-4 text-xs transition-all duration-300 hover:bg-zinc-50/90"
                    >
                      <div className="flex-shrink-0">
                        <Avatar className="size-7 border border-zinc-950/10 shadow-sm">
                          <AvatarFallback className="flex select-none items-center justify-center bg-primary text-[9px] font-black text-white">
                            IK
                          </AvatarFallback>
                        </Avatar>
                      </div>
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-black uppercase tracking-wider text-zinc-900">
                              Resposta da Equipe
                            </span>
                            <span className="flex size-3 select-none items-center justify-center rounded-full bg-primary text-[7px] font-bold text-white">
                              ✓
                            </span>
                          </div>
                          <span className="text-[8px] font-medium uppercase tracking-wider text-zinc-400">
                            {formatDistanceToNow(new Date(a.createdAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                        </div>
                        <p className="pl-0.5 font-medium italic leading-relaxed text-zinc-700">
                          "{a.answer}"
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Admin Reply Action */}
              {isAdmin && (
                <div className="flex flex-col gap-2 border-t border-zinc-50 pt-2">
                  {replyingTo === q.id ? (
                    <div className="space-y-2 duration-200 animate-in fade-in">
                      <div className="relative">
                        <input
                          id={`qa-reply-${q.id}`}
                          name="replyText"
                          type="text"
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Escreva sua resposta oficial..."
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 pr-10 text-xs transition-all placeholder:text-zinc-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          onClick={() => handleReply(q.id)}
                          disabled={!replyText.trim()}
                          title={
                            q.answers.length > 0
                              ? "Salvar edição"
                              : "Enviar resposta"
                          }
                          className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-lg bg-primary text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-20"
                        >
                          <Send className="size-3" />
                        </button>
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyText("");
                          }}
                          className="text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-colors hover:text-red-500"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openReplyBox(q)}
                      className="group/reply flex w-fit items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-zinc-400 transition-all hover:text-zinc-900"
                    >
                      <Reply className="size-3 transition-transform group-hover/reply:-translate-x-0.5" />
                      {q.answers.length > 0
                        ? "Editar Resposta"
                        : "Responder Pergunta"}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

import { LazyImage } from "@/components/LazyImage";
import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { DebouncedSearchInput } from "@/components/admin/DebouncedSearchInput";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useQuestions } from "@/hooks/useQuestions";
import type { Question } from "@/hooks/useQuestions";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import type { View } from "@/types";
import { AnimatePresence, type Variants, motion } from "framer-motion";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  HelpCircle,
  LayoutGrid,
  List,
  Loader2,
  MessageCircle,
  MessageSquare,
  Search,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, getAvatarGradient } from "@/lib/utils";

interface AdminQAViewProps {
  readonly onNavigate: (view: View) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants: Variants = {
  hidden: { y: 15, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 120,
      damping: 18,
    },
  },
};

let cachedQAStats: {
  total: number;
  pending: number;
  answered: number;
  rate: number;
} | null = null;

// Scroll cache is managed by useScrollRestoration hook centrally

export const AdminQAView = memo(function AdminQAView({
  active = true,
  onSetDirty,
}: AdminQAViewProps) {
  const {
    questions,
    loading,
    getAllQuestions,
    addAnswer,
    deleteQuestion,
    subscribeToQuestions,
    getQAStats,
  } = useQuestions();
  const isOffline = useOnlineStatus();

  // --- 1. STATES ---
  const [selectedQuestion, setSelectedQuestion] = useState<Question | null>(
    null,
  );
  const [answer, setAnswer] = useState("");
  const [activeDialogQuestion, setActiveDialogQuestion] =
    useState<Question | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filter, setFilter] = useLocalStorage<"pending" | "all">(
    "admin_qa_filter",
    "pending",
  );
  const [page, setPage] = useLocalStorage<number>("admin_qa_page", 0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    "admin_qa_search_query",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_qa_view_mode",
    "compact",
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(
    null,
  );
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [totalCount, setTotalCount] = useState(() => cachedQAStats?.total || 0);
  const [pendingCount, setPendingCount] = useState(
    () => cachedQAStats?.pending || 0,
  );
  const [answeredCount, setAnsweredCount] = useState(
    () => cachedQAStats?.answered || 0,
  );
  const [responseRate, setResponseRate] = useState(
    () => cachedQAStats?.rate || 0,
  );
  // A consulta de estatísticas falhou (e os números na tela podem ser
  // velhos — ou nunca terem chegado). Enquanto verdadeiro, os cartões não
  // podem dizer "Fila Limpa", "0%" nem "0 de 0": erro não é fila vazia.
  const [statsUnavailable, setStatsUnavailable] = useState(false);

  // --- 2. REFS ---
  const { ref: viewRef } = useScrollRestoration(
    "admin-qa",
    active ?? false,
    questions.length > 0,
  );
  const firstLoadRef = useRef(true);
  const questionsLengthRef = useRef(questions.length);
  const wasOfflineRef = useRef(isOffline);
  const onQuestionEventRef = useRef<() => void>(() => {});

  const pageSize = 10;

  // --- 3. CALLBACKS ---
  const fetchStats = useCallback(async () => {
    try {
      const stats = await getQAStats();
      if (stats.status === "error") {
        console.error("Error fetching QA stats:", stats.error);
        // Mantém os últimos números bons no cache, mas marca a tela:
        // apresentar zero aqui seria o defeito da "Fila Limpa" mentirosa.
        setStatsUnavailable(true);
        return;
      }
      cachedQAStats = stats;
      setTotalCount(stats.total);
      setPendingCount(stats.pending);
      setAnsweredCount(stats.answered);
      setResponseRate(stats.rate);
      setStatsUnavailable(false);
    } catch (error) {
      console.error("Error fetching QA stats:", error);
      setStatsUnavailable(true);
    }
  }, [getQAStats]);

  const loadQuestions = useCallback(
    (pageToFetch: number, silent = false) => {
      getAllQuestions(pageToFetch, pageSize, filter, searchQuery, silent)
        .then((result) => {
          if (result) {
            setTotalQuestions(result.total);
            const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
            if (pageToFetch > maxPage) {
              setPage(maxPage);
            }
          }
          firstLoadRef.current = false;
        })
        .catch(() => {
          firstLoadRef.current = false;
        });
    },
    [getAllQuestions, pageSize, filter, searchQuery, setPage],
  );

  // Keep ref up to date with latest loadQuestions and page state without recreating subcription effect
  onQuestionEventRef.current = () => {
    loadQuestions(page);
  };

  // --- 4. EFFECTS ---
  // Scroll position is handled by useScrollRestoration hook

  // Sync activeDialogQuestion when selectedQuestion changes with exit buffer
  useEffect(() => {
    if (selectedQuestion) {
      setActiveDialogQuestion(selectedQuestion);
    } else {
      const timer = setTimeout(() => {
        setActiveDialogQuestion(null);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [selectedQuestion]);

  const initialAnswerRef = useRef("");

  // Sincronizar preenchimento com selectedQuestion e resetar ao fechar
  useEffect(() => {
    if (selectedQuestion) {
      const isAnswered =
        selectedQuestion.answers && selectedQuestion.answers.length > 0;
      // answers vem ordenado ascendente por createdAt (useQuestions.ts) --
      // a mais recente é a última posição, não a primeira. Ver correção #2
      // da revisão da Trilha 3 (issue #100).
      const val = isAnswered
        ? (selectedQuestion.answers.at(-1)?.answer ?? "")
        : "";
      setAnswer(val);
      initialAnswerRef.current = val;
    } else {
      setAnswer("");
      initialAnswerRef.current = "";
    }
  }, [selectedQuestion]);

  // Comunicar estado dirty para o roteador global
  useEffect(() => {
    onSetDirty?.(answer.trim() !== initialAnswerRef.current.trim());
  }, [answer, onSetDirty]);

  // Reset modal and overlay states when view becomes inactive to avoid focus traps and scroll lock
  useEffect(() => {
    if (!active) {
      setSelectedQuestion(null);
      setAnswer("");
      setActiveDialogQuestion(null);
      setShowHelpModal(false);
      setConfirmDeleteId(null);
      setIsSubmitting(false);
    }
  }, [active]);

  // Fetch stats (optimized: only fetch when active/mounted or on explicit action, not on pagination/search filtering)
  useEffect(() => {
    if (active) {
      fetchStats();
    }
  }, [fetchStats, refreshTrigger, active]);

  // Sync questions length ref
  useEffect(() => {
    questionsLengthRef.current = questions.length;
  }, [questions.length]);

  // Auto-refresh when coming back online
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando dúvidas...", {
        icon: "⚡",
      });
      loadQuestions(page);
      fetchStats();
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, page, loadQuestions, fetchStats]);

  // Load initial data
  useEffect(() => {
    if (!active) return;
    loadQuestions(page, false);
  }, [page, filter, searchQuery, active, loadQuestions]);

  // Subscribe to realtime questions updates
  useEffect(() => {
    if (!active) return;
    const unsubscribe = subscribeToQuestions(() => {
      onQuestionEventRef.current();
    });
    return () => unsubscribe();
  }, [subscribeToQuestions, active]);

  const handleSendAnswer = async () => {
    if (isOffline) {
      toast.error("Você está offline", {
        description:
          "Não é possível enviar respostas sem conexão com a internet.",
      });
      return;
    }
    if (!selectedQuestion) return;

    const cleanAnswer = answer.replace(/<[^>]*>/g, "").trim();
    if (!cleanAnswer) {
      toast.error("A resposta não pode ser vazia.");
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await addAnswer(
        {
          questionId: selectedQuestion.id,
          answer: cleanAnswer,
        },
        { silent: true },
      );

      // Laudo 0109 (A-1): o hook com `silent` não toast e não lança — sem
      // este ramo, falha (rede, permissão, sessão vencida) deixava a tela
      // muda, com o diálogo aberto como se nada tivesse acontecido.
      if (!success) {
        toast.error("Não foi possível enviar a resposta. Tente de novo.");
        return;
      }

      toast.success("Resposta enviada com sucesso!");
      setSelectedQuestion(null);
      setAnswer("");
      setRefreshTrigger((prev) => prev + 1);
      getAllQuestions(page, pageSize, filter, searchQuery);
    } catch (error) {
      console.error("Error answering:", error);
      toast.error("Erro ao processar resposta");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseDialog = useCallback(() => {
    const isDirty = answer.trim() !== initialAnswerRef.current.trim();
    if (isDirty) {
      if (
        globalThis.confirm(
          "Você possui alterações não salvas que serão perdidas. Deseja realmente descartar e sair?",
        )
      ) {
        setSelectedQuestion(null);
      }
    } else {
      setSelectedQuestion(null);
    }
  }, [answer]);

  const handleDelete = async (id: string) => {
    if (isOffline) {
      toast.error("Você está offline", {
        description:
          "Não é possível excluir perguntas sem conexão com a internet.",
      });
      return;
    }
    // `deleteQuestion` devolve booleano (mesmo molde de `addAnswer`, usado
    // em `handleSendAnswer` acima) — sem checar, "Pergunta excluída" em
    // verde aparecia mesmo quando o apagamento falhava (rede, permissão,
    // sessão vencida), e a pergunta reaparecia na lista sem explicação.
    const success = await deleteQuestion(id, { silent: true });

    if (!success) {
      // Calar tambem e mentir: sem isto a lojista clicava "Sim", nada
      // acontecia, nenhum aviso aparecia e o dialogo ficava aberto. Ela
      // nao tinha como saber se falhou ou se o clique nao pegou.
      toast.error(
        "Nao foi possivel excluir a pergunta. Tente de novo em instantes.",
      );
      setConfirmDeleteId(null);
      return;
    }

    toast.success("Pergunta excluída");
    setConfirmDeleteId(null);
    setRefreshTrigger((prev) => prev + 1);
    getAllQuestions(page, pageSize, filter, searchQuery);
  };

  const totalPages = Math.ceil(totalQuestions / pageSize);

  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "pendentes",
        label: "Dúvidas Pendentes",
        icon: AlertCircle,
        iconClass:
          pendingCount > 0 ? "text-amber-400 animate-pulse" : "text-zinc-500",
        iconBg: "bg-amber-500/10 border-amber-500/20",
        hoverBorder:
          "hover:border-amber-500/30 hover:shadow-[0_0_30px_rgba(245,158,11,0.05)]",
        value: statsUnavailable ? "—" : pendingCount,
        accent: "text-amber-400",
        content: (
          <div className="mt-3 flex items-center gap-1.5 animate-in fade-in">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full bg-amber-500",
                pendingCount > 0 && "animate-pulse",
              )}
            />
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {statsUnavailable
                ? "Erro ao atualizar"
                : pendingCount > 0
                  ? "Ação Requerida"
                  : "Fila Limpa"}
            </span>
          </div>
        ),
        footer: "Clientes aguardando retorno",
      },
      {
        id: "taxa_resposta",
        label: "Taxa de Resposta",
        icon: MessageSquare,
        iconClass: "text-emerald-400",
        iconBg: "bg-emerald-500/10 border-emerald-500/20",
        hoverBorder:
          "hover:border-emerald-500/30 hover:shadow-[0_0_30px_rgba(16,185,129,0.05)]",
        value: statsUnavailable ? "—" : `${responseRate}%`,
        accent: "text-emerald-400",
        content: (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 animate-in fade-in">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${responseRate}%` }}
            />
          </div>
        ),
        footer: statsUnavailable
          ? "Não foi possível carregar agora"
          : `${answeredCount} de ${totalCount} respondidas`,
      },
      {
        id: "total",
        label: "Total de Perguntas",
        icon: MessageCircle,
        iconClass: "text-sky-400",
        iconBg: "bg-sky-500/10 border-sky-500/20",
        hoverBorder:
          "hover:border-sky-500/30 hover:shadow-[0_0_30px_rgba(14,165,233,0.05)]",
        value: statsUnavailable ? "—" : totalCount,
        accent: "text-sky-400",
        content: (
          <div className="mt-3 flex items-center gap-1.5 animate-in fade-in">
            <Clock className="size-3.5 text-zinc-500" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Desde o início
            </span>
          </div>
        ),
        footer: "Dúvidas totais enviadas",
      },
      {
        id: "conversao",
        label: "Conversão Comercial",
        icon: Sparkles,
        iconClass: "text-admin-gold fill-admin-gold",
        iconBg: "bg-admin-gold/10 border-admin-gold/20",
        hoverBorder:
          "hover:border-admin-gold/30 hover:shadow-[0_0_30px_rgba(212,175,55,0.05)]",
        // PAINEL-16: era "Impacto Alto" cravado — número que nunca muda ao
        // lado de três medidos. Sem métrica real de conversão, o honesto
        // é não inventar: o valor fica vazio e o rodapé explica o porquê.
        value: "", // B3 da 1a revisao: travessão contava como "não carregou" no teste (espera 3, ficava 4) — vazio não marca nada
        accent: "text-admin-gold",
        content: (
          <div className="mt-3 flex items-center gap-1.5 animate-in fade-in">
            <span className="size-1.5 animate-pulse rounded-full bg-admin-gold" />
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              Respostas Ajudam a Vender
            </span>
          </div>
        ),
        footer: "Q&A aumenta a confiança",
      },
    ],
    [statsUnavailable, pendingCount, responseRate, answeredCount, totalCount],
  );

  const renderSkeleton = () => (
    <div className="grid gap-4">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse space-y-4 rounded-[2rem] border border-white/5 bg-white/[0.02] p-6"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-white/5" />
              <div className="space-y-2">
                <div className="h-3 w-24 rounded bg-white/5" />
                <div className="h-2 w-16 rounded bg-white/5" />
              </div>
            </div>
            <div className="h-4 w-20 rounded-full bg-white/5" />
          </div>
          <div className="h-4 w-3/4 rounded bg-white/5" />
          <div className="h-10 w-full rounded-xl bg-white/5" />
        </div>
      ))}
    </div>
  );

  const renderCompactSkeleton = () => (
    <div className="divide-y divide-white/5 overflow-hidden rounded-3xl border border-white/5 bg-white/[0.02]">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-center justify-between gap-4 p-4"
        >
          <div className="flex flex-1 items-center gap-3">
            <div className="size-8 shrink-0 rounded-full bg-white/5" />
            <div className="max-w-lg flex-1 space-y-1.5">
              <div className="h-3 w-1/4 rounded bg-white/5" />
              <div className="h-2 w-3/4 rounded bg-white/5" />
            </div>
          </div>
          <div className="h-4 w-20 shrink-0 rounded-full bg-white/5" />
          <div className="flex gap-2">
            <div className="size-9 rounded-xl bg-white/5" />
            <div className="size-9 rounded-xl bg-white/5" />
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
      className="relative flex flex-col items-center justify-center overflow-hidden px-6 py-20"
    >
      <div className="pointer-events-none absolute h-[300px] w-[300px] rounded-full bg-emerald-500/5 blur-3xl" />

      <div className="group relative mb-6 flex size-20 items-center justify-center rounded-3xl border border-emerald-500/20 bg-emerald-500/10 shadow-2xl">
        <div className="absolute inset-0 rounded-3xl bg-emerald-500/20 opacity-50 blur-xl transition-opacity group-hover:opacity-80" />
        <MessageSquare className="relative z-10 size-10 text-emerald-400" />
        <Sparkles className="absolute -right-2 -top-2 size-5 animate-pulse text-admin-gold" />
      </div>

      <h3 className="mb-2 text-xl font-black uppercase tracking-tight text-white">
        Fila de Perguntas Limpa
      </h3>
      <p className="max-w-xs text-center text-xs font-medium leading-relaxed text-zinc-500">
        Todos os seus clientes estão bem informados e suas dúvidas foram
        respondidas. Ótimo trabalho de suporte!
      </p>
    </motion.div>
  );

  const renderCompactList = () => {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="divide-y divide-white/5 overflow-hidden rounded-3xl border border-white/5 bg-white/[0.01]"
      >
        {questions.map((q) => {
          const isAnswered = q.answers.length > 0;
          const initials = q.customerName
            ? q.customerName.charAt(0).toUpperCase()
            : "?";
          const avatarGrad = getAvatarGradient(q.customerName);
          const isConfirmingDelete = confirmDeleteId === q.id;
          const isExpandedRow = expandedQuestionId === q.id;

          return (
            <motion.div
              key={q.id}
              variants={itemVariants}
              layout
              className="content-visibility-auto group flex flex-col p-4 transition-all hover:bg-white/[0.02]"
            >
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                  onClick={() =>
                    setExpandedQuestionId(isExpandedRow ? null : q.id)
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedQuestionId(isExpandedRow ? null : q.id);
                    }
                  }}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-black text-white shrink-0 shadow-lg",
                      avatarGrad,
                    )}
                  >
                    {initials}
                  </div>

                  {/* Question and Meta */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="max-w-[150px] truncate text-xs font-bold text-white">
                        {q.customerName}
                      </span>
                      <span className="text-[10px] font-bold text-zinc-500">
                        {new Date(q.createdAt).toLocaleDateString("pt-BR")}
                      </span>
                      <span className="max-w-[180px] truncate rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold text-zinc-400">
                        {q.productName}
                      </span>
                    </div>
                    <p
                      className={cn(
                        "text-xs text-zinc-300 italic transition-all",
                        isExpandedRow ? "whitespace-pre-wrap" : "truncate pr-6",
                      )}
                    >
                      "{q.question}"
                    </p>
                  </div>
                </div>

                {/* Status & Actions */}
                <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                  <div
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedQuestionId(isExpandedRow ? null : q.id)
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedQuestionId(isExpandedRow ? null : q.id);
                      }
                    }}
                  >
                    {isAnswered ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-400">
                        <Check className="size-2.5" /> Respondida
                      </span>
                    ) : (
                      <span className="inline-flex animate-pulse items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-400">
                        <Clock className="size-2.5" /> Pendente
                      </span>
                    )}
                  </div>

                  {/* Actions Group */}
                  <div className="flex items-center gap-1.5">
                    {isConfirmingDelete ? (
                      <div className="flex items-center gap-1 rounded-xl border border-red-500/20 bg-red-950/40 p-0.5">
                        <button
                          onClick={() => handleDelete(q.id)}
                          className="rounded-lg bg-red-500 px-2.5 py-1 text-[9px] font-black text-white transition-colors hover:bg-red-400"
                        >
                          Sim
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1 text-[9px] font-bold text-zinc-400 transition-colors hover:text-white"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          disabled={isOffline}
                          onClick={() => setConfirmDeleteId(q.id)}
                          className="flex size-8 items-center justify-center rounded-xl border border-red-500/15 bg-red-500/10 text-red-400 transition-all hover:bg-red-500 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                          title="Excluir Pergunta"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                        {!isAnswered ? (
                          <button
                            disabled={isOffline}
                            onClick={() => setSelectedQuestion(q)}
                            className="flex h-8 items-center gap-1 rounded-xl bg-emerald-500 px-3 text-[10px] font-black uppercase tracking-wider text-white transition-all hover:bg-emerald-400 disabled:pointer-events-none disabled:opacity-40"
                          >
                            <MessageSquare className="size-3" /> Responder
                          </button>
                        ) : (
                          // Reabre o modal pré-preenchido; o handleSendAnswer chama a
                          // mesma RPC answer_question_atomic, que agora faz upsert por
                          // question_id (issue #100). Não há botão para APAGAR a
                          // resposta — ficou fora do escopo da #100 por decisão da
                          // trilha, registrada também no comentário da migration
                          // 20260812000000_upsert_answer_question_atomic.sql.
                          <button
                            disabled={isOffline}
                            onClick={() => {
                              setSelectedQuestion(q);
                              // a mais recente é a última posição, ver
                              // comentário acima (answers ordenado ascendente)
                              setAnswer(q.answers.at(-1)?.answer ?? "");
                            }}
                            className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                            title="Editar Resposta"
                          >
                            <MessageSquare className="size-3.5 text-emerald-400" />
                          </button>
                        )}
                        <button
                          onClick={() =>
                            setExpandedQuestionId(isExpandedRow ? null : q.id)
                          }
                          className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-all hover:bg-white/10 hover:text-white sm:flex"
                        >
                          {isExpandedRow ? (
                            <ChevronUp className="size-4" />
                          ) : (
                            <ChevronDown className="size-4" />
                          )}
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
                    className="mt-3 space-y-3 overflow-hidden pl-11"
                  >
                    <div className="rounded-2xl border border-white/5 bg-white/[0.01] p-4">
                      <span className="mb-1 block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                        Pergunta Completa
                      </span>
                      <p className="text-xs italic text-zinc-300">
                        "{q.question}"
                      </p>
                    </div>

                    {isAnswered && (
                      <div className="relative overflow-hidden rounded-2xl border border-emerald-500/10 bg-emerald-500/[0.02] p-4">
                        <div className="absolute left-0 top-0 h-full w-[2px] bg-emerald-500/30" />
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className="block text-[9px] font-black uppercase tracking-widest text-emerald-400">
                            Resposta da Loja
                          </span>
                          <span className="text-[8px] font-bold text-zinc-500">
                            {new Date(
                              q.answers.at(-1)!.createdAt,
                            ).toLocaleDateString("pt-BR")}
                          </span>
                        </div>
                        <p className="text-xs font-medium leading-relaxed text-zinc-300">
                          {q.answers.at(-1)!.answer}
                        </p>
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
          const initials = q.customerName
            ? q.customerName.charAt(0).toUpperCase()
            : "?";
          const avatarGrad = getAvatarGradient(q.customerName);
          const isConfirmingDelete = confirmDeleteId === q.id;

          return (
            <motion.div
              key={q.id}
              variants={itemVariants}
              layout
              className="content-visibility-auto group relative overflow-hidden rounded-[2rem] border border-white/5 bg-[#121214]/60 shadow-xl transition-all duration-300 hover:border-white/10 hover:bg-[#161619]/80 hover:shadow-[0_10px_30px_rgba(0,0,0,0.4)]"
            >
              <div className="bg-radial-gradient pointer-events-none absolute inset-0 from-emerald-500/[0.01] via-transparent to-transparent" />

              <div className="relative z-10 p-6 md:p-8">
                <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
                  <div className="flex-1 space-y-5">
                    {/* Meta Info */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                        <div
                          className={cn(
                            "w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center text-[9px] font-black text-white",
                            avatarGrad,
                          )}
                        >
                          {initials}
                        </div>
                        <span className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-wider text-zinc-300">
                          {q.customerName}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                        <Calendar className="size-3.5 text-zinc-500" />
                        <span className="mt-0.5 text-[10px] font-black uppercase leading-none tracking-wider text-zinc-500">
                          {new Date(q.createdAt).toLocaleDateString("pt-BR")}
                        </span>
                      </div>

                      {isAnswered ? (
                        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-emerald-400 shadow-lg shadow-emerald-500/5">
                          <CheckCircle2 className="size-3.5" />
                          <span className="mt-0.5 text-[9px] font-black uppercase leading-none tracking-wider">
                            Respondida
                          </span>
                        </div>
                      ) : (
                        <div className="flex animate-pulse items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1.5 text-amber-400 shadow-lg shadow-amber-500/5">
                          <Clock className="size-3.5" />
                          <span className="mt-0.5 text-[9px] font-black uppercase leading-none tracking-wider">
                            Pendente
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Question Content */}
                    <div className="relative flex min-h-[60px] items-center border-l border-emerald-500/30 pl-6">
                      <div className="pointer-events-none absolute -left-2 -top-4 select-none font-serif text-7xl leading-none text-white/[0.02] transition-colors group-hover:text-emerald-500/5">
                        “
                      </div>
                      <p className="text-base font-medium italic leading-relaxed text-zinc-200 md:text-lg">
                        "{q.question}"
                      </p>
                    </div>

                    {/* Product Reference */}
                    <div className="group/product inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-1.5 pr-4 transition-all hover:border-emerald-500/20 hover:bg-white/10">
                      <div className="relative size-9 shrink-0 overflow-hidden rounded-xl bg-zinc-800">
                        <LazyImage
                          src={
                            q.productImage ||
                            "https://placehold.co/100x100?text=S/I"
                          }
                          alt={q.productName || "Produto"}
                          className="size-full object-cover transition-transform duration-500 group-hover/product:scale-110"
                        />
                      </div>
                      <div className="flex min-w-0 flex-col">
                        <span className="mb-1 text-[8px] font-black uppercase leading-none tracking-widest text-zinc-500">
                          Referente ao produto
                        </span>
                        <span className="max-w-[220px] truncate text-xs font-black uppercase text-zinc-300">
                          {q.productName}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center justify-end gap-3 md:flex-col">
                    {isConfirmingDelete ? (
                      <div className="flex w-28 flex-col gap-1 rounded-2xl border border-red-500/20 bg-red-950/40 p-2 text-center">
                        <span className="mb-1 text-[8px] font-black uppercase tracking-wider text-red-400">
                          Excluir?
                        </span>
                        <button
                          onClick={() => handleDelete(q.id)}
                          className="w-full rounded-xl bg-red-500 py-1.5 text-[10px] font-black text-white transition-colors hover:bg-red-400"
                        >
                          Sim, Excluir
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="mt-0.5 w-full py-1 text-[10px] font-bold text-zinc-400 transition-colors hover:text-white"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          disabled={isOffline}
                          onClick={() => setConfirmDeleteId(q.id)}
                          className="group/del flex size-12 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/5 transition-all hover:bg-red-500 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                          title="Excluir Pergunta"
                        >
                          <Trash2 className="size-5 transition-transform group-hover/del:scale-110" />
                        </button>

                        {!isAnswered && (
                          <button
                            disabled={isOffline}
                            onClick={() => setSelectedQuestion(q)}
                            className="group/rep flex h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400 bg-emerald-500 px-6 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:pointer-events-none disabled:opacity-40"
                          >
                            <MessageSquare className="size-4 shrink-0 transition-transform group-hover/rep:rotate-12" />
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
                      className="mt-6 space-y-4 border-t border-white/5 pt-6"
                    >
                      {q.answers.map((ans) => (
                        <div
                          key={ans.id}
                          className="group/ans relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] p-5"
                        >
                          <div className="absolute left-0 top-0 h-full w-[3px] bg-emerald-500/40" />
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex size-5 items-center justify-center rounded-lg bg-emerald-500/25 text-emerald-400">
                                <Send className="size-2.5" />
                              </div>
                              <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">
                                Resposta da Loja
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="mr-1 text-[9px] font-bold text-zinc-500">
                                {new Date(ans.createdAt).toLocaleDateString(
                                  "pt-BR",
                                )}
                              </span>
                              <button
                                disabled={isOffline}
                                onClick={() => {
                                  setSelectedQuestion(q);
                                  setAnswer(ans.answer);
                                }}
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-black text-zinc-400 transition-all hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
                              >
                                Editar
                              </button>
                            </div>
                          </div>
                          <p className="text-sm font-medium leading-relaxed text-zinc-300">
                            {ans.answer}
                          </p>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-500/10 to-transparent" />
            </motion.div>
          );
        })}
      </motion.div>
    );
  };

  const renderContent = () => {
    if (loading && questions.length === 0) {
      return (
        <motion.div
          key="loading"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="py-12"
        >
          {viewMode === "compact" ? renderCompactSkeleton() : renderSkeleton()}
        </motion.div>
      );
    }

    if (questions.length === 0) {
      return renderEmptyState();
    }

    return (
      <div
        className={cn(
          "transition-opacity duration-300",
          loading && "opacity-50 pointer-events-none",
        )}
      >
        {viewMode === "compact" ? renderCompactList() : renderDetailedList()}
      </div>
    );
  };

  return (
    <div
      ref={viewRef}
      className="h-auto bg-[#09090b] pb-admin lg:pb-12 text-zinc-100 duration-200 animate-in fade-in selection:bg-emerald-500/30"
    >
      {/* Header Sticky */}
      <div className="sticky top-0 z-50 bg-[#09090b]/80 p-2 pb-0 backdrop-blur-md sm:p-4">
        <div className="admin-glass rounded-2xl border border-white/5 p-3 shadow-2xl sm:rounded-[2rem] sm:p-4">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            {/* Title & Stats */}
            <div className="flex w-full flex-wrap items-center justify-between gap-3 lg:w-auto lg:justify-start">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  {/* Onda 3 da reforma visual (03/09): título com fórmula
                      própria (text-lg, duas cores) saiu; entrou o
                      AdminPageHeader, igual ao de Pedidos/Produtos/Clientes. */}
                  <AdminPageHeader titulo="Perguntas">
                    <button
                      type="button"
                      onClick={() => setShowHelpModal(true)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/5 bg-zinc-900/60 text-zinc-500 transition-all duration-300 hover:border-white/10 hover:text-white active:scale-95"
                      title="Guia de Q&A e Ajuda"
                    >
                      <HelpCircle className="size-4.5" />
                    </button>
                  </AdminPageHeader>
                </div>
              </div>

              {/* Compact Stats Badges */}
              <div className="flex items-center gap-1.5">
                <div
                  className="shrink-0 rounded-lg border border-admin-gold/20 bg-admin-gold/10 px-2 py-0.5"
                  title="Total de perguntas"
                >
                  <p className="text-[9px] font-black uppercase tracking-widest text-admin-gold sm:text-[10px]">
                    {totalCount}
                  </p>
                </div>
                {pendingCount > 0 && (
                  <div
                    className="flex shrink-0 animate-pulse items-center gap-1 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-0.5"
                    title="Pendentes"
                  >
                    <span className="size-1 rounded-full bg-amber-500" />
                    <span className="text-[9px] font-black tracking-widest text-amber-400 sm:text-[10px]">
                      {pendingCount} PENDENTES
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Search & Main Filter */}
            <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:w-auto lg:max-w-2xl lg:flex-1 lg:justify-end">
              <div className="group relative min-w-0 flex-1">
                <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
                  {loading || isTyping ? (
                    <Loader2 className="size-3.5 animate-spin text-admin-gold" />
                  ) : (
                    <Search className="size-3.5 text-zinc-500 transition-colors group-focus-within:text-admin-gold" />
                  )}
                </div>
                <label htmlFor="qa-search" className="sr-only">
                  Buscar perguntas
                </label>
                <DebouncedSearchInput
                  id="qa-search"
                  name="search"
                  placeholder="Buscar por cliente ou pergunta..."
                  className="w-full rounded-xl border border-zinc-800 bg-black/40 py-2 pl-9 pr-3 text-xs font-bold text-white transition-all placeholder:text-zinc-600 focus:border-admin-gold/50 focus:bg-zinc-950/60 focus:outline-none focus:ring-2 focus:ring-admin-gold/20"
                  value={searchQuery}
                  onChange={(val) => {
                    setSearchQuery(val);
                    setPage(0);
                  }}
                  onTyping={setIsTyping}
                  delay={300}
                />
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-black/40 p-0.5">
                  <button
                    onClick={() => {
                      setFilter("pending");
                      setPage(0);
                    }}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                      filter === "pending"
                        ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/20"
                        : "text-zinc-500 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    Pendentes
                  </button>
                  <button
                    onClick={() => {
                      setFilter("all");
                      setPage(0);
                    }}
                    className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-widest transition-all ${
                      filter === "all"
                        ? "bg-admin-gold text-black shadow-lg shadow-admin-gold/20"
                        : "text-zinc-500 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    Todas
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setViewMode((prev) =>
                      prev === "detailed" ? "compact" : "detailed",
                    )
                  }
                  className="group flex size-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-black/40 shadow-lg transition-all hover:border-admin-gold/50 hover:bg-zinc-900 active:scale-95 sm:size-9"
                  title={
                    viewMode === "detailed"
                      ? "Visualização Compacta"
                      : "Visualização Detalhada"
                  }
                >
                  {viewMode === "detailed" ? (
                    <LayoutGrid className="size-3.5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  ) : (
                    <List className="size-3.5 text-zinc-500 transition-colors group-hover:text-admin-gold" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Dashboard Section */}
      <div className="mx-auto mt-6 max-w-7xl space-y-4 px-4">
        <AdminKpiCarousel
          active={active}
          cards={kpiCards}
          loading={loading && !cachedQAStats}
          title="Métricas de Suporte (SAC)"
        />
      </div>

      <main className="mx-auto mt-8 max-w-7xl px-4">
        <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>

        {/* Pagination Modern */}
        {!loading && totalPages > 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-between gap-6 px-4 py-12 sm:flex-row"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                Página
              </span>
              <div className="flex items-center gap-1">
                <span className="flex size-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs font-black text-emerald-400">
                  {page + 1}
                </span>
                <span className="text-[11px] font-bold uppercase text-zinc-650">
                  de
                </span>
                <span className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-xs font-black text-zinc-300">
                  {totalPages}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  setPage((prev) => Math.max(0, prev - 1));
                  const mainEl =
                    e.currentTarget.closest(".admin-scroll-container") ||
                    document.querySelector(".active-scroll-container") ||
                    document.querySelector("main");
                  if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
                }}
                disabled={page === 0}
                className="group flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-6 text-zinc-400 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-5 transition-transform group-hover:-translate-x-1" />
                <span className="mt-0.5 text-[10px] font-black uppercase tracking-widest">
                  Anterior
                </span>
              </button>
              <button
                onClick={(e) => {
                  setPage((prev) => Math.min(totalPages - 1, prev + 1));
                  const mainEl =
                    e.currentTarget.closest(".admin-scroll-container") ||
                    document.querySelector(".active-scroll-container") ||
                    document.querySelector("main");
                  if (mainEl) mainEl.scrollTo({ top: 0, behavior: "smooth" });
                }}
                disabled={page === totalPages - 1}
                className="group flex h-12 items-center gap-3 rounded-2xl border border-emerald-400 bg-emerald-500 px-6 font-black text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400 disabled:pointer-events-none disabled:opacity-30"
              >
                <span className="mt-0.5 text-[10px] uppercase tracking-widest">
                  Seguinte
                </span>
                <ChevronRight className="size-5 transition-transform group-hover:translate-x-1" />
              </button>
            </div>
          </motion.div>
        )}
      </main>

      {/* Answer Modal Premium */}
      <Dialog
        open={!!selectedQuestion}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
        }}
      >
        <DialogContent className="overflow-hidden rounded-[2.5rem] border-white/10 bg-[#09090b] p-0 shadow-2xl sm:max-w-xl">
          {activeDialogQuestion && (
            <div className="p-8 md:p-10">
              <DialogHeader className="mb-8">
                <div className="mb-6 flex size-16 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                  <MessageSquare className="size-8 text-emerald-400" />
                </div>
                <DialogTitle className="flex items-center gap-3 text-2xl font-black uppercase tracking-tight text-white">
                  Enviar Resposta
                </DialogTitle>
                <DialogDescription className="mt-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-500">
                  Atendimento ao cliente • {activeDialogQuestion.customerName}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-8">
                <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-white/[0.02] p-6">
                  <div className="absolute right-0 top-0 p-4 opacity-10">
                    <MessageSquare className="size-12" />
                  </div>
                  <span className="mb-2 block text-[9px] font-black uppercase tracking-widest text-zinc-500">
                    Pergunta Original
                  </span>
                  <p className="relative z-10 text-sm font-medium italic leading-relaxed text-zinc-300">
                    "{activeDialogQuestion.question}"
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="ml-1 flex items-center justify-between">
                    <label
                      htmlFor="merchant-answer"
                      className="text-[10px] font-black uppercase tracking-widest text-zinc-500"
                    >
                      Sua Mensagem Specialist
                    </label>
                    <span className="text-[10px] font-bold text-zinc-500">
                      {answer.length} caracteres
                    </span>
                  </div>
                  <div className="relative">
                    <textarea
                      id="merchant-answer"
                      name="answer"
                      autoComplete="off"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      disabled={isOffline}
                      placeholder={
                        isOffline
                          ? "Você está offline. Não é possível responder no momento."
                          : "Dê uma resposta completa e persuasiva para encantar o cliente..."
                      }
                      className="scrollbar-hide h-48 w-full resize-none rounded-[2rem] border border-white/10 bg-white/[0.03] p-6 text-sm text-white shadow-inner transition-all focus:border-emerald-500/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-40"
                    />
                    <div className="pointer-events-none absolute bottom-4 right-6 flex items-center gap-2 opacity-40">
                      <Send className="size-4 text-emerald-400" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-white">
                        Notificar Cliente
                      </span>
                    </div>
                  </div>
                </div>

                {isOffline && (
                  <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-red-400">
                    <AlertCircle className="size-4 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Modo Offline Ativo
                    </span>
                  </div>
                )}

                <div className="flex flex-col gap-4 pt-2 sm:flex-row">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleCloseDialog}
                    className="h-14 flex-1 rounded-2xl border border-white/10 bg-white/5 text-[11px] font-black uppercase tracking-widest text-zinc-400 transition-colors duration-200 hover:bg-white/10 hover:text-white"
                  >
                    Descartar
                  </motion.button>
                  <motion.button
                    whileHover={isOffline ? {} : { scale: 1.02 }}
                    whileTap={isOffline ? {} : { scale: 0.98 }}
                    onClick={handleSendAnswer}
                    disabled={isSubmitting || !answer.trim() || isOffline}
                    className="flex h-14 flex-[2] items-center justify-center gap-3 rounded-2xl border border-emerald-400 bg-emerald-500 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition-colors duration-200 hover:bg-emerald-400 disabled:pointer-events-none disabled:opacity-30"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      <>
                        <Send className="size-4" />
                        <span>Publicar Resposta</span>
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Dúvidas (Q&A)"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-zinc-400">
            A Central de Perguntas & Respostas funciona como um canal de suporte
            assíncrono (SAC) diretamente na página dos produtos. Responder essas
            dúvidas ajuda a aumentar a taxa de conversão da loja.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-admin-gold pl-2 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
              Fluxo Operacional
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <MessageSquare className="size-4 text-emerald-500" />
                  Dúvidas Pendentes
                </div>
                <p className="text-xs text-zinc-400">
                  Questões enviadas por compradores em potencial sobre um
                  produto específico (especificações, compatibilidade, prazos).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Send className="size-4 text-admin-gold" />
                  Resposta Oficial
                </div>
                <p className="text-xs text-zinc-400">
                  Ao responder uma pergunta, ela se torna visível publicamente
                  no app para que outros clientes que tenham a mesma dúvida
                  possam ler imediatamente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <Trash2 className="size-4 text-sky-500" />
                  Exclusão Preventiva
                </div>
                <p className="text-xs text-zinc-400">
                  Se a dúvida contiver linguagem ofensiva, links externos
                  maliciosos ou for spam, você pode excluí-la de forma
                  permanente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-white/5 bg-zinc-900/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
                  <CheckCircle2 className="size-4 text-purple-500" />
                  Filtros Rápidos
                </div>
                <p className="text-xs text-zinc-400">
                  Você pode filtrar para ver apenas perguntas pendentes de
                  resposta, facilitando o fluxo de atendimento diário.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});

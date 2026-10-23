import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { FolhaDeResposta } from "@/components/admin/atendimento/FolhaDeResposta";
import {
  Avatar,
  AvisoDeProblema,
  BOTAO_DE_ICONE,
  BOTAO_DE_ICONE_EXCLUIR,
  BOTAO_NEUTRO,
  BarraDeProporcao,
  BuscaEModo,
  CartaoDeNumero,
  ConfirmarExclusao,
  FiltroEmSegmentos,
  Paginador,
  ResumoRecolhivel,
  VazioDaLista,
  rolarAoTopo,
} from "@/components/admin/atendimento/controles";
import { AlternadorDeTelas } from "@/components/admin/primitivos/AlternadorDeTelas";
import { EstadoComPonto } from "@/components/admin/primitivos/EstadoComPonto";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useQuestions } from "@/hooks/useQuestions";
import type { Question } from "@/hooks/useQuestions";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  MessageSquare,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface AdminQAViewProps {
  readonly onNavigate: (view: View) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
}

let cachedQAStats: {
  total: number;
  pending: number;
  answered: number;
  rate: number;
} | null = null;

// Scroll cache is managed by useScrollRestoration hook centrally

export const AdminQAView = memo(function AdminQAView({
  active = true,
  onNavigate,
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
  const formularioAtual = useRef({ selectedQuestion, answer });
  useEffect(() => {
    formularioAtual.current = { selectedQuestion, answer };
  }, [selectedQuestion, answer]);
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
  // "compact": cada cartão fecha os detalhes (a seta abre); "detailed": tudo
  // aberto de uma vez. Mesma chave de antes — a escolha da lojista continua.
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
  // velhos — ou nunca terem chegado). Enquanto verdadeiro, o filtro, o resumo
  // e os cartões não podem dizer "0", "0%" nem "0 de 0": erro não é fila vazia.
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
          if (result && !result.falhou) {
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
    if (!selectedQuestion || isSubmitting) return;

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
      setRefreshTrigger((prev) => prev + 1);
      loadQuestions(page);
      // O sucesso pertence ao texto enviado, não a outro diálogo ou rascunho.
      if (
        formularioAtual.current.selectedQuestion === selectedQuestion &&
        formularioAtual.current.answer === answer
      ) {
        setSelectedQuestion(null);
        setAnswer("");
      }
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
    loadQuestions(page);
  };

  const totalPages = Math.ceil(totalQuestions / pageSize);
  const detalhado = viewMode === "detailed";
  const buscaAtiva = searchQuery.trim().length > 0;

  // Números do filtro e do resumo: "—" quando a consulta falhou (zero seria
  // mentira) e o número de verdade quando ela respondeu.
  const numeroOuTraco = (n: number) => (statsUnavailable ? "—" : n);

  const escolherFiltro = (novo: "pending" | "all") => {
    setFilter(novo);
    setPage(0);
  };

  const limparBusca = () => {
    setSearchQuery("");
    setPage(0);
  };

  const resumoNaLinha = statsUnavailable ? (
    <>
      <span className="shrink-0 text-base font-bold text-white">
        — respondidas
      </span>
      <span className="min-w-0 text-sm text-red-300">Erro ao atualizar</span>
    </>
  ) : (
    <>
      <span className="shrink-0 text-base font-bold tabular-nums text-white">
        {responseRate}% respondidas
      </span>
      <BarraDeProporcao percentual={responseRate} />
      <span className="shrink-0 text-sm tabular-nums text-zinc-300">
        {answeredCount} de {totalCount}
      </span>
    </>
  );

  const renderSkeleton = () => (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Carregando…</span>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-36 animate-pulse rounded-2xl border border-solid border-admin-border bg-admin-surface"
        />
      ))}
    </div>
  );

  const renderEmptyState = () => {
    if (buscaAtiva) {
      return (
        <VazioDaLista
          icone={Search}
          titulo="Nenhuma pergunta encontrada"
          frase={`Nada para “${searchQuery.trim()}”. Confira a escrita ou limpe a busca.`}
          acao={{ rotulo: "Limpar busca", aoClicar: limparBusca }}
        />
      );
    }
    // Erro de estatística não é fila vazia: sem os números não dá para dizer
    // que a fila está limpa.
    if (statsUnavailable) {
      return (
        <VazioDaLista
          icone={AlertCircle}
          titulo="Não deu para confirmar a fila"
          frase="Não foi possível carregar os números agora. Confira a internet e tente de novo."
          acao={{
            rotulo: "Tentar de novo",
            aoClicar: () => {
              fetchStats();
              loadQuestions(page);
            },
          }}
        />
      );
    }
    if (filter === "pending") {
      return (
        <VazioDaLista
          icone={Check}
          titulo="Fila de perguntas limpa"
          frase="Todos os clientes estão bem informados e as dúvidas foram respondidas."
        />
      );
    }
    return (
      <VazioDaLista
        icone={MessageSquare}
        titulo="Nenhuma pergunta ainda"
        frase="As dúvidas que os clientes deixarem nas páginas dos produtos aparecem aqui."
      />
    );
  };

  const corDoRespondida = classeDoTexto("positivo");

  const renderQuestion = (q: Question) => {
    const isAnswered = q.answers.length > 0;
    const isConfirmingDelete = confirmDeleteId === q.id;
    const aberto = detalhado || expandedQuestionId === q.id;
    const alternar = () => setExpandedQuestionId(aberto ? null : q.id);

    return (
      <li
        key={q.id}
        className="rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5"
      >
        <div className="flex items-start gap-3">
          <Avatar nome={q.customerName} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 truncate text-base font-semibold text-white">
                {q.customerName}
              </p>
              {isAnswered ? (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 text-sm font-semibold ${corDoRespondida}`}
                >
                  <Check aria-hidden="true" className="size-4" />
                  Respondida
                </span>
              ) : (
                <EstadoComPonto
                  tom="atencao"
                  texto="Pendente"
                  className="shrink-0 text-sm"
                />
              )}
            </div>
            <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-zinc-300">
              <span className="shrink-0 tabular-nums">
                {new Date(q.createdAt).toLocaleDateString("pt-BR")}
              </span>
              {q.productName && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="min-w-0 truncate">{q.productName}</span>
                </>
              )}
            </p>
          </div>
        </div>

        <p
          className={cn(
            "mt-3 break-words text-base italic text-zinc-100",
            aberto ? "whitespace-pre-wrap" : "line-clamp-2",
          )}
        >
          “{q.question}”
        </p>

        {aberto && isAnswered && (
          <div className="mt-3 space-y-2">
            {q.answers.map((ans) => (
              <div
                key={ans.id}
                className="rounded-xl border border-l-[3px] border-solid border-admin-border border-l-admin-border-strong bg-admin-bg p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300">
                    <MessageSquare aria-hidden="true" className="size-4" />
                    Resposta da loja
                  </span>
                  <span className="text-sm tabular-nums text-zinc-400">
                    {new Date(ans.createdAt).toLocaleDateString("pt-BR")}
                  </span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-base text-zinc-100">
                  {ans.answer}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3">
          {isConfirmingDelete ? (
            <ConfirmarExclusao
              frase="Excluir esta pergunta? Não dá para desfazer."
              aoCancelar={() => setConfirmDeleteId(null)}
              aoConfirmar={() => handleDelete(q.id)}
            />
          ) : (
            <div className="flex items-center gap-2">
              {/* Reabre a folha pré-preenchida; o handleSendAnswer chama a
                  mesma RPC answer_question_atomic, que faz upsert por
                  question_id (issue #100). Não há botão para APAGAR só a
                  resposta — ficou fora do escopo da #100 por decisão da
                  trilha (migration 20260812000000). */}
              <button
                type="button"
                disabled={isOffline}
                onClick={() => setSelectedQuestion(q)}
                className={cn(BOTAO_NEUTRO, "min-w-0 flex-1")}
              >
                <MessageSquare aria-hidden="true" className="size-4" />
                {isAnswered ? "Editar resposta" : "Responder"}
              </button>
              <button
                type="button"
                disabled={isOffline}
                onClick={() => setConfirmDeleteId(q.id)}
                aria-label="Excluir pergunta"
                title="Excluir Pergunta"
                className={BOTAO_DE_ICONE_EXCLUIR}
              >
                <Trash2 aria-hidden="true" className="size-5" />
              </button>
              {!detalhado && (
                <button
                  type="button"
                  onClick={alternar}
                  aria-expanded={aberto}
                  aria-label="Mostrar detalhes"
                  className={BOTAO_DE_ICONE}
                >
                  {aberto ? (
                    <ChevronUp aria-hidden="true" className="size-5" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-5" />
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    );
  };

  const renderContent = () => {
    if (loading && questions.length === 0) {
      return renderSkeleton();
    }

    if (questions.length === 0) {
      return renderEmptyState();
    }

    return (
      <ul
        className={cn(
          "space-y-3 transition-opacity duration-300",
          loading && "pointer-events-none opacity-50",
        )}
      >
        {questions.map(renderQuestion)}
      </ul>
    );
  };

  return (
    <div
      ref={viewRef}
      className="h-auto bg-admin-bg pb-admin text-zinc-100 lg:pb-12"
    >
      {/* O título da tela continua existindo para o leitor de tela (h1), mas
          some da vista: o alternador logo abaixo já diz "Perguntas". */}
      <div className="sr-only">
        <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-qa"]} />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3">
        {/* Perguntas e Avaliações dividem uma porta só (Clientes): o
            alternador leva de uma à outra, e a ajuda mora ao lado. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AlternadorDeTelas atual="admin-qa" onNavigate={onNavigate} />
          </div>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
            title="Guia das perguntas e ajuda"
          >
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-surface text-zinc-200 transition-colors group-hover:bg-admin-raised"
            >
              <HelpCircle className="size-5" />
            </span>
          </button>
        </div>

        <BuscaEModo
          id="qa-search"
          rotulo="Buscar perguntas"
          placeholder="Buscar por cliente ou pergunta..."
          valor={searchQuery}
          aoMudar={(val) => {
            setSearchQuery(val);
            setPage(0);
          }}
          aoDigitar={setIsTyping}
          buscando={loading || isTyping}
          detalhado={detalhado}
          aoTrocarModo={() =>
            setViewMode((prev) =>
              prev === "detailed" ? "compact" : "detailed",
            )
          }
        />

        <FiltroEmSegmentos
          rotulo="Filtrar perguntas"
          valor={filter}
          aoEscolher={escolherFiltro}
          opcoes={[
            {
              valor: "pending",
              rotulo: "Pendentes",
              contagem: numeroOuTraco(pendingCount),
              tomDaContagem:
                !statsUnavailable && pendingCount > 0 ? "atencao" : undefined,
            },
            {
              valor: "all",
              rotulo: "Todas",
              contagem: numeroOuTraco(totalCount),
            },
          ]}
        />

        <ResumoRecolhivel
          nome="Resumo das perguntas"
          colunas={3}
          linha={resumoNaLinha}
        >
          <CartaoDeNumero
            rotulo={
              <EstadoComPonto
                tom={
                  !statsUnavailable && pendingCount > 0 ? "atencao" : "neutro"
                }
                texto="Pendentes"
                className="font-medium"
              />
            }
            valor={numeroOuTraco(pendingCount)}
            rodape={statsUnavailable ? "Erro ao atualizar" : "a responder"}
          />
          <CartaoDeNumero
            rotulo="Respondidas"
            valor={statsUnavailable ? "—" : `${responseRate}%`}
            extra={
              statsUnavailable ? undefined : (
                <BarraDeProporcao percentual={responseRate} />
              )
            }
            rodape={
              statsUnavailable
                ? "Não foi possível carregar agora"
                : `${answeredCount} de ${totalCount}`
            }
          />
          <CartaoDeNumero
            rotulo="Total"
            valor={numeroOuTraco(totalCount)}
            rodape={statsUnavailable ? "Erro ao atualizar" : "desde o início"}
          />
        </ResumoRecolhivel>
        {/* O quarto cartão ("Conversão Comercial") saiu: nunca teve métrica
            real (PAINEL-16 já o tinha deixado sem valor). */}
      </div>

      <main className="mx-auto mt-4 w-full max-w-3xl px-4">
        {isOffline && (
          <div className="mb-3">
            <AvisoDeProblema>
              Sem conexão. Responder e excluir voltam quando a internet voltar.
            </AvisoDeProblema>
          </div>
        )}

        {renderContent()}

        {!loading && totalPages > 1 && (
          <Paginador
            pagina={page}
            totalDePaginas={totalPages}
            aoMudar={(nova, origem) => {
              setPage(nova);
              rolarAoTopo(origem);
            }}
          />
        )}
      </main>

      {/* Folha de resposta: sobe de baixo e respeita o teclado do celular. */}
      <FolhaDeResposta
        aberta={!!selectedQuestion}
        aoFechar={handleCloseDialog}
        cliente={activeDialogQuestion?.customerName ?? ""}
        produto={activeDialogQuestion?.productName}
        pergunta={activeDialogQuestion?.question ?? ""}
        resposta={answer}
        aoMudarResposta={setAnswer}
        aoPublicar={handleSendAnswer}
        enviando={isSubmitting}
        semConexao={isOffline}
      />

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Como funcionam as perguntas"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-300">
            Aqui você responde as dúvidas que os clientes deixam na página dos
            produtos, sem precisar de conversa ao vivo. Responder essas dúvidas
            ajuda a vender mais.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-solid border-admin-border-strong pl-2 text-[11px] font-black uppercase tracking-wider text-zinc-300">
              Fluxo Operacional
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <MessageSquare aria-hidden="true" className="size-4" />
                  Dúvidas Pendentes
                </div>
                <p className="text-sm text-zinc-300">
                  Questões enviadas por compradores em potencial sobre um
                  produto específico (especificações, compatibilidade, prazos).
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Send aria-hidden="true" className="size-4" />
                  Resposta Oficial
                </div>
                <p className="text-sm text-zinc-300">
                  Ao responder uma pergunta, ela se torna visível publicamente
                  no app para que outros clientes que tenham a mesma dúvida
                  possam ler imediatamente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Trash2 aria-hidden="true" className="size-4" />
                  Exclusão Preventiva
                </div>
                <p className="text-sm text-zinc-300">
                  Se a dúvida contiver linguagem ofensiva, links externos
                  maliciosos ou for spam, você pode excluí-la de forma
                  permanente.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Check aria-hidden="true" className="size-4" />
                  Filtros Rápidos
                </div>
                <p className="text-sm text-zinc-300">
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

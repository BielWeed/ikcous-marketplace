import { AdminHelpModal } from "@/components/admin/AdminHelpModal";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  Avatar,
  AvisoDeProblema,
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import { useStore } from "@/contexts/StoreContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useReviews } from "@/hooks/useReviews";
import { useScrollRestoration } from "@/hooks/useScrollRestoration";
import { supabase } from "@/lib/supabase";
import { classeDoTexto } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { View } from "@/types";
import { haptic } from "@/utils/haptic";
import {
  HelpCircle,
  MessageSquare,
  Send,
  ShieldCheck,
  Star,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// Respostas rápidas do formulário: os mesmos textos de antes; os rótulos
// perderam o emoji (a tela é neutra).
const RESPOSTAS_RAPIDAS = [
  {
    label: "Agradecer feedback",
    text: "Muito obrigado pela sua avaliação! Feedbacks como o seu nos motivam a continuar oferecendo a melhor qualidade.",
  },
  {
    label: "Dar suporte",
    text: "Olá! Lamentamos muito que sua experiência não tenha sido ideal. Já estamos cientes do seu relato e entraremos em contato via WhatsApp para resolver isso o quanto antes.",
  },
  {
    label: "Feedback positivo",
    text: "Que excelente notícia! Ficamos muito satisfeitos em saber que o produto atendeu suas expectativas. Conte sempre conosco!",
  },
  {
    label: "Esclarecer produto",
    text: "Agradecemos o seu comentário. Gostaríamos de ressaltar que as instruções de uso estão no manual do produto. Qualquer dúvida adicional, estamos à disposição no suporte.",
  },
] as const;

interface AdminReviewsViewProps {
  readonly onNavigate: (view: View) => void;
  readonly active?: boolean;
  readonly onSetDirty?: (dirty: boolean) => void;
}

// Sem avaliação nenhuma a taxa é INDEFINIDA, não zero e não cem — o "—" marca isso.
// Com avaliação, zero medido continua sendo "0%" (não vira "—").
function formatRate(
  count: number,
  total: number,
): { text: string; width: number } {
  if (total <= 0) return { text: "—", width: 0 };
  const percent = Math.round((count / total) * 100);
  return { text: `${percent}%`, width: percent };
}

export const AdminReviewsView = memo(function AdminReviewsView({
  active = true,
  onNavigate,
  onSetDirty,
}: AdminReviewsViewProps) {
  const {
    adminReviews,
    loading,
    erroDaListagemAdmin,
    getAllReviews,
    deleteReview,
    aprovarReview,
    addMerchantReply,
    subscribeToReviews,
  } = useReviews();
  const isOffline = useOnlineStatus();
  const { config, isLoaded: configLoaded, updateConfig } = useStore();
  const [isUpdatingConfig, setIsUpdatingConfig] = useState(false);

  const handleToggleReviews = async (checked: boolean) => {
    if (isOffline) {
      toast.error("Você está offline");
      return;
    }
    haptic.light();
    setIsUpdatingConfig(true);
    try {
      // O toast de erro sai de dentro do `updateConfig`; aqui só não se segue
      // em frente (ADMIN-010, #94).
      const salvou = await updateConfig({ enableReviews: checked });
      if (!salvou) return;
      toast.success(
        checked
          ? "Sistema de avaliações habilitado"
          : "Sistema de avaliações desabilitado",
      );
    } catch (err) {
      console.error(err);
      toast.error("Erro ao atualizar a configuração");
    } finally {
      setIsUpdatingConfig(false);
    }
  };

  const [page, setPage] = useLocalStorage<number>("admin_reviews_page", 0);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [totalReviews, setTotalReviews] = useState(0);
  const pageSize = 10;

  const { ref: viewRef } = useScrollRestoration(
    "admin-reviews",
    active ?? false,
    adminReviews.length > 0,
  );

  const [searchQuery, setSearchQuery] = useLocalStorage<string>(
    "admin_reviews_search_query",
    "",
  );
  const [isTyping, setIsTyping] = useState(false);
  const [ratingFilter, setRatingFilter] = useLocalStorage<number | "all">(
    "admin_reviews_rating_filter",
    "all",
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const replyText = replyingTo ? (rascunhos[replyingTo] ?? "") : "";
  const editorAtualRef = useRef<string | null>(null);
  const envioDeRespostaRef = useRef(false);
  const publicandoRef = useRef<Set<string>>(new Set());
  const [publicando, setPublicando] = useState<ReadonlySet<string>>(new Set());
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [globalVerifiedCount, setGlobalVerifiedCount] = useState(0);
  const [globalRepliedCount, setGlobalRepliedCount] = useState(0);
  // Globais de verdade (achado 5 + migration 20261002000000): média e total
  // que NÃO seguem o filtro — os cartões "Global/no total" leem daqui.
  // "—" quando a RPC antiga ainda esta no ar (sem as chaves global_*):
  // zero antes do apply e indistinguivel de loja sem avaliacao NENHUMA
  // (CORRIGE 2 da revisao 2305 — a mesma honestidade do formatRate).
  const [globaisDisponiveis, setGlobaisDisponiveis] = useState(true);
  const [globalTotal, setGlobalTotal] = useState(0);
  const [globalAvgRating, setGlobalAvgRating] = useState("0.0");
  // Laudo 0109 (A-4): contagem REAL da fila de moderação, direto do banco —
  // a lista carrega uma página (10 por página) e não enxerga pendentes das
  // outras; o cartão que contava a página dizia "fila vazia" em plena fila.
  const [pendentesNoBanco, setPendentesNoBanco] = useState(0);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [viewMode, setViewMode] = useLocalStorage<"detailed" | "compact">(
    "admin_reviews_view_mode",
    "compact",
  );

  const triggerRefresh = () => setRefreshTrigger((prev) => prev + 1);

  const setReplyText = (texto: string) => {
    if (!replyingTo || envioDeRespostaRef.current) return;
    setRascunhos((anteriores) => ({ ...anteriores, [replyingTo]: texto }));
  };

  const abrirResposta = (id: string) => {
    if (envioDeRespostaRef.current) return;
    if (isOffline) {
      toast.error("Você está offline", {
        description: "Não é possível responder avaliações sem conexão.",
      });
      return;
    }
    editorAtualRef.current = id;
    setReplyingTo(id);
  };

  const fecharResposta = () => {
    if (envioDeRespostaRef.current) return;
    editorAtualRef.current = null;
    setReplyingTo(null);
  };

  const enviarResposta = async (id: string) => {
    if (envioDeRespostaRef.current || !replyText.trim()) return;
    if (isOffline) {
      haptic.error();
      toast.error("Você está offline", {
        description: "Não é possível responder avaliações sem conexão.",
      });
      return;
    }
    envioDeRespostaRef.current = true;
    setIsSubmittingReply(true);
    haptic.light();
    try {
      const success = await addMerchantReply(id, replyText);
      if (success) {
        haptic.success();
        setRascunhos((anteriores) => ({ ...anteriores, [id]: "" }));
        // Uma resposta tardia só fecha o editor que fez o envio.
        if (editorAtualRef.current === id) {
          editorAtualRef.current = null;
          setReplyingTo(null);
        }
        triggerRefresh();
      } else {
        haptic.error();
      }
    } finally {
      envioDeRespostaRef.current = false;
      setIsSubmittingReply(false);
    }
  };

  // Removed ref tracking for filter changes in favor of direct state resets

  const firstLoadRef = useRef(true);
  const reviewsLengthRef = useRef(adminReviews.length);

  useEffect(() => {
    reviewsLengthRef.current = adminReviews.length;
  }, [adminReviews.length]);

  // Cada leitura leva um número de rodada: a resposta superada por uma mais
  // nova (o realtime dispara outra enquanto esta ainda espera) é descartada,
  // senão a mais velha, chegando por último, sobrescreve os totais. Mesmo
  // padrão de AdminCustomersView.
  const rodadaRef = useRef(0);

  const loadReviews = useCallback(
    async (pageToFetch: number, silent = false) => {
      const rodada = ++rodadaRef.current;
      try {
        const result = await getAllReviews(pageToFetch, pageSize, {
          rating: ratingFilter,
          search: searchQuery,
          silent,
        });
        if (rodada !== rodadaRef.current) return;
        if (result) {
          setTotalReviews(result.total);
          setGlobalVerifiedCount(result.globalVerifiedCount || 0);
          setGlobalRepliedCount(result.globalRepliedCount || 0);
          // L4: default PESSIMISTA - caminho sem o campo (fallback
          // nao-admin, catch) e "nao sei", nunca zero confiante.
          setGlobaisDisponiveis(result.globaisDisponiveis === true);
          setGlobalTotal(result.globalTotal || 0);
          setGlobalAvgRating(result.globalAverageRating?.toFixed(1) || "0.0");

          const maxPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (pageToFetch > maxPage) {
            setPage(maxPage);
          }
        }

        // Mesmo recarregamento da lista: aprovar/recusar/apagar passam por
        // aqui (triggerRefresh), então a contagem do cartão acompanha. Erro
        // na contagem mantém o valor anterior — zero confiante mentiria.
        const { count, error } = await supabase
          .from("reviews" as any)
          .select("*", { count: "exact", head: true })
          .eq("status", "pendente");
        if (rodada !== rodadaRef.current) return;
        if (!error && typeof count === "number") {
          setPendentesNoBanco(count);
        }
      } catch (err) {
        console.error("[AdminReviewsView] Failed to load reviews:", err);
      } finally {
        firstLoadRef.current = false;
      }
    },
    [getAllReviews, pageSize, ratingFilter, searchQuery, setPage],
  );

  useEffect(() => {
    if (!active) return;
    loadReviews(page, false);

    const unsubscribe = subscribeToReviews(() => {
      loadReviews(page, true);
    });

    return () => {
      unsubscribe();
    };
  }, [
    page,
    ratingFilter,
    searchQuery,
    active,
    loadReviews,
    refreshTrigger,
    subscribeToReviews,
  ]);

  // Auto-refresh when coming back online
  const wasOfflineRef = useRef(isOffline);
  useEffect(() => {
    if (wasOfflineRef.current && !isOffline && active) {
      toast.success("Conexão restabelecida. Atualizando avaliações...", {
        icon: "⚡",
      });
      loadReviews(page);
    }
    wasOfflineRef.current = isOffline;
  }, [isOffline, active, page, loadReviews]);

  // Comunicar estado dirty para o roteador global
  useEffect(() => {
    onSetDirty?.(
      active &&
        Object.values(rascunhos).some((texto) => texto.trim().length > 0),
    );
  }, [active, rascunhos, onSetDirty]);

  // Reset helper modals when tab becomes inactive to prevent focus traps
  useEffect(() => {
    if (!active) {
      setShowHelpModal(false);
      setConfirmDeleteId(null);
      editorAtualRef.current = null;
      setReplyingTo(null);
      onSetDirty?.(false);
    }
    return () => {
      onSetDirty?.(false);
    };
  }, [active, onSetDirty]);

  const totalPages = Math.ceil(totalReviews / pageSize);

  const mediaGlobalExibida = globaisDisponiveis
    ? globalAvgRating.replace(".", ",")
    : "—";
  const totalGlobalExibido = globaisDisponiveis ? globalTotal : "—";
  // Global Dynamic metrics for display
  // Denominadores GLOBAIS (achado 5): as taxas usam o total sem filtro —
  // filtro vazio nunca mais fabrica "100%" de zero.
  const verifiedRate = formatRate(globalVerifiedCount, globalTotal);
  const responseRate = formatRate(globalRepliedCount, globalTotal);

  const handleDelete = async (id: string) => {
    if (isOffline) {
      haptic.error();
      toast.error("Você está offline", {
        description:
          "Não é possível excluir avaliações sem conexão com a internet.",
      });
      return;
    }
    haptic.medium();
    // Laudo 0109 (A-10): o hook devolve booleano — vibração de sucesso e
    // recarga só quando a exclusão de verdade aconteceu.
    const ok = await deleteReview(id);
    setConfirmDeleteId(null);
    if (!ok) return; // o toast de erro já foi dado no hook (useReviews)
    // A avaliação saiu: o rascunho dela não pode manter a tela "com alterações".
    setRascunhos((anteriores) => {
      if (!(id in anteriores)) return anteriores;
      const { [id]: _removido, ...restantes } = anteriores;
      return restantes;
    });
    haptic.success();
    if (adminReviews.length === 1 && page > 0) {
      setPage((p) => p - 1);
    } else {
      triggerRefresh();
    }
  };

  const handleAprovar = async (reviewId: string) => {
    if (isOffline) {
      haptic.error();
      toast.error("Você está offline", {
        description:
          "Não é possível publicar avaliações sem conexão. A fila fica salva.",
      });
      return;
    }
    // Toque duplo: a segunda chamada chegaria antes de o React repintar o
    // botão parado, então a trava é um ref (síncrono), não só o estado.
    if (publicandoRef.current.has(reviewId)) return;
    publicandoRef.current.add(reviewId);
    setPublicando(new Set(publicandoRef.current));
    haptic.light();
    try {
      const ok = await aprovarReview(reviewId);
      if (!ok) {
        // O hook já deu o toast de erro; aqui só não comemora nem recarrega.
        haptic.error();
        return;
      }
      haptic.success();
      triggerRefresh();
    } catch (err) {
      haptic.error();
      console.error("Erro ao publicar avaliação:", err);
      toast.error("Erro ao publicar avaliação.");
    } finally {
      publicandoRef.current.delete(reviewId);
      setPublicando(new Set(publicandoRef.current));
    }
  };

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString("pt-BR");

  const detalhado = viewMode === "detailed";
  const filtroAtivo = searchQuery.trim().length > 0 || ratingFilter !== "all";
  const corDaNotaBaixa = classeDoTexto("negativo");
  const corDoSelo = classeDoTexto("positivo");

  const limparBuscaEFiltros = () => {
    setSearchQuery("");
    setRatingFilter("all");
    setPage(0);
  };

  // Estrelas: cheias para a nota, só contorno para o resto. Nota 1 ou 2 é
  // negativa e leva o vermelho (texto/glifo, nunca bloco); o resto é neutro.
  const renderStars = (rating: number) => (
    <span
      role="img"
      aria-label={`Nota ${rating} de 5`}
      className="inline-flex shrink-0 gap-0.5"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={cn(
            "size-4",
            i <= rating
              ? cn(
                  "fill-current",
                  rating <= 2 ? corDaNotaBaixa : "text-zinc-100",
                )
              : "text-zinc-400",
          )}
        />
      ))}
    </span>
  );

  const resumoNaLinha = (
    <>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-base font-bold tabular-nums text-white">
        <Star aria-hidden="true" className="size-5 fill-current" />
        {mediaGlobalExibida}
      </span>
      <span className="text-sm tabular-nums text-zinc-300">
        · {totalGlobalExibido} avaliações
      </span>
      {pendentesNoBanco > 0 && (
        <EstadoComPonto
          tom="atencao"
          texto={`${pendentesNoBanco} na fila`}
          className="shrink-0 text-sm"
        />
      )}
    </>
  );

  const renderSkeleton = () => (
    <div aria-busy="true" className="space-y-3">
      <span className="sr-only">Carregando…</span>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          aria-hidden="true"
          className="h-40 animate-pulse rounded-2xl border border-solid border-admin-border bg-admin-surface"
        />
      ))}
    </div>
  );

  const renderEmpty = () =>
    filtroAtivo ? (
      <VazioDaLista
        icone={Star}
        titulo="Nenhuma avaliação encontrada"
        frase="Nada com essa busca ou essa nota. Tente outra ou limpe os filtros."
        acao={{
          rotulo: "Limpar busca e filtros",
          aoClicar: limparBuscaEFiltros,
        }}
      />
    ) : (
      <VazioDaLista
        icone={Star}
        titulo="Sem avaliações ainda"
        frase="As avaliações dos clientes vão aparecer aqui assim que começarem a chegar."
      />
    );

  const renderFormularioDeResposta = (reviewId: string) => (
    <div className="space-y-3">
      <div className="space-y-2">
        <span className="block text-sm font-medium text-zinc-300">
          Resposta rápida
        </span>
        <div className="grid grid-cols-2 gap-2">
          {RESPOSTAS_RAPIDAS.map((sugestao) => (
            <button
              key={sugestao.label}
              type="button"
              onClick={() =>
                // Não apaga o que a lojista já digitou: a sugestão entra no fim.
                setReplyText(
                  replyText.trim()
                    ? `${replyText.trimEnd()} ${sugestao.text}`
                    : sugestao.text,
                )
              }
              disabled={isOffline || isSubmittingReply}
              className={cn(BOTAO_NEUTRO, "px-2")}
            >
              {sugestao.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        onFocus={(e) => {
          // O teclado do celular se sobrepõe à página: traz o campo à vista.
          const campo = e.currentTarget;
          window.setTimeout(
            () => campo.scrollIntoView?.({ block: "center" }),
            300,
          );
        }}
        aria-label="Sua resposta"
        placeholder={
          isOffline
            ? "Você está offline. Não é possível responder no momento."
            : "Escreva uma resposta atenciosa para este cliente..."
        }
        className="h-32 w-full resize-none rounded-2xl border border-solid border-admin-border-strong bg-admin-bg p-3.5 text-base text-white placeholder:text-zinc-400 focus:outline-none focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
        disabled={isSubmittingReply || isOffline}
      />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={fecharResposta}
          disabled={isSubmittingReply}
          className={cn(BOTAO_NEUTRO, "flex-1 bg-transparent")}
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => enviarResposta(reviewId)}
          disabled={isSubmittingReply || !replyText.trim() || isOffline}
          className={cn(BOTAO_NEUTRO, "flex-[2]")}
        >
          <Send aria-hidden="true" className="size-4" />
          {isSubmittingReply ? "Publicando..." : "Publicar resposta"}
        </button>
      </div>
    </div>
  );

  const renderReview = (review: (typeof adminReviews)[number]) => {
    const pendente = review.status === "pendente";
    return (
      <li
        key={review.id}
        className="rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5"
      >
        <div className="flex items-start gap-3">
          <Avatar nome={review.customerName} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                <p className="min-w-0 truncate text-base font-semibold text-white">
                  {review.customerName}
                </p>
                {review.verified && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 text-sm font-medium ${corDoSelo}`}
                  >
                    <ShieldCheck aria-hidden="true" className="size-4" />
                    Verificada
                  </span>
                )}
              </div>
              {pendente && (
                <EstadoComPonto
                  tom="atencao"
                  texto="Em moderação"
                  className="shrink-0 text-sm"
                />
              )}
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-zinc-300">
                <span className="shrink-0 tabular-nums">
                  {formatDate(review.createdAt)}
                </span>
                {review.productName && (
                  <>
                    <span aria-hidden="true">•</span>
                    <span className="min-w-0 truncate">
                      {review.productName}
                    </span>
                  </>
                )}
              </p>
              {renderStars(review.rating)}
            </div>
          </div>
        </div>

        <p
          className={cn(
            "mt-3 break-words text-base italic text-zinc-100",
            detalhado ? "whitespace-pre-wrap" : "line-clamp-3",
          )}
        >
          {review.comment
            ? `“${review.comment}”`
            : "Avaliação só com estrelas."}
        </p>

        {review.helpful > 0 && (
          <p
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-zinc-300"
            title="Clientes que acharam esta avaliação útil"
          >
            <ThumbsUp aria-hidden="true" className="size-3.5" />
            <span className="tabular-nums">{review.helpful}</span>
            <span className="sr-only">acharam útil</span>
          </p>
        )}

        {review.merchantReply && (
          <div className="mt-3 rounded-xl border border-l-[3px] border-solid border-admin-border border-l-admin-border-strong bg-admin-bg p-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300">
              <MessageSquare aria-hidden="true" className="size-4" />
              Resposta da loja
            </span>
            <p
              className={cn(
                "mt-1.5 break-words text-base text-zinc-100",
                detalhado ? "whitespace-pre-wrap" : "line-clamp-2",
              )}
            >
              {review.merchantReply}
            </p>
          </div>
        )}

        <div className="mt-3">
          {confirmDeleteId === review.id ? (
            <ConfirmarExclusao
              frase="Excluir esta avaliação? Não dá para desfazer."
              aoCancelar={() => setConfirmDeleteId(null)}
              aoConfirmar={() => handleDelete(review.id)}
            />
          ) : replyingTo === review.id ? (
            renderFormularioDeResposta(review.id)
          ) : (
            <div className="flex items-center gap-2">
              {/* Item 7 do laudo de 29/08: o botão manual "Verificar
                  Compra/Remover Verificação" SAIU — o selo é derivado da
                  compra com dinheiro reconhecido pelas triggers da
                  20261030000000, e interruptor manual voltaria a significar
                  "alguém clicou". O selo ao lado lê a MESMA coluna `verified`.
                  Item 8: a fila de moderação é real — pendente ganha o botão
                  de publicar. */}
              {pendente && (
                <button
                  type="button"
                  onClick={() => {
                    handleAprovar(review.id);
                  }}
                  disabled={isOffline || publicando.has(review.id)}
                  aria-label="Aprovar e Publicar"
                  title="Aprovar e Publicar"
                  className={cn(BOTAO_NEUTRO, "min-w-0 flex-1")}
                >
                  <ShieldCheck
                    aria-hidden="true"
                    className={`size-4 ${corDoSelo}`}
                  />
                  Aprovar
                </button>
              )}
              {!review.merchantReply && (
                <button
                  type="button"
                  disabled={isOffline || isSubmittingReply}
                  onClick={() => abrirResposta(review.id)}
                  className={cn(BOTAO_NEUTRO, "min-w-0 flex-1")}
                >
                  <MessageSquare aria-hidden="true" className="size-4" />
                  Responder
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirmDeleteId(review.id)}
                disabled={isOffline}
                aria-label="Excluir avaliação"
                title="Excluir avaliação"
                className={cn(BOTAO_DE_ICONE_EXCLUIR, "ml-auto")}
              >
                <Trash2 aria-hidden="true" className="size-5" />
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const carregando =
    (loading || firstLoadRef.current) && adminReviews.length === 0;

  return (
    <div
      ref={viewRef}
      className="h-auto bg-admin-bg pb-admin text-zinc-100 lg:pb-12"
    >
      {/* O título da tela continua existindo para o leitor de tela (h1), mas
          some da vista: o alternador logo abaixo já diz "Avaliações". */}
      <div className="sr-only">
        <AdminPageHeader titulo={NOMES_DO_PAINEL["admin-reviews"]} />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3">
        {/* Perguntas e Avaliações dividem uma porta só (Clientes): o
            alternador leva de uma à outra, e a ajuda mora ao lado. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <AlternadorDeTelas atual="admin-reviews" onNavigate={onNavigate} />
          </div>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95"
            title="Guia de Avaliações e Ajuda"
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
          id="reviews-search"
          rotulo="Buscar avaliações"
          placeholder="Buscar por cliente ou produto..."
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
          rotulo="Filtrar por nota"
          valor={ratingFilter}
          aoEscolher={(nova) => {
            setRatingFilter(nova);
            setPage(0);
          }}
          opcoes={[
            { valor: "all", rotulo: "Todas", larga: true },
            ...[5, 4, 3, 2, 1].map((star) => ({
              valor: star as number | "all",
              rotulo: (
                <>
                  {star}
                  <Star aria-hidden="true" className="size-3.5 fill-current" />
                </>
              ),
              nome: star === 1 ? "1 estrela" : `${star} estrelas`,
            })),
          ]}
        />

        <ResumoRecolhivel
          nome="Métricas de Avaliações"
          colunas={2}
          linha={resumoNaLinha}
        >
          <CartaoDeNumero
            rotulo="Média global"
            // Global de verdade (achado 5): a média não segue o filtro — lê o
            // campo global da RPC (20261002000000).
            valor={
              <>
                {mediaGlobalExibida}
                {globaisDisponiveis && (
                  <span className="mt-0.5">
                    {renderStars(Math.round(Number(globalAvgRating) || 0))}
                  </span>
                )}
              </>
            }
            rodape="nota dos compradores"
          />
          <CartaoDeNumero
            rotulo="Total recebido"
            // Global de verdade (achado 5): é o total sem filtro — o filtrado
            // continua governando o paginador.
            valor={totalGlobalExibido}
            // Item 8 + laudo 0109 (A-4): a moderação é REAL e a contagem é do
            // BANCO — pendentesNoBanco —, não da página carregada.
            rodape={
              pendentesNoBanco > 0 ? (
                <EstadoComPonto
                  tom="atencao"
                  texto={`${pendentesNoBanco} para aprovar`}
                  className="font-medium"
                />
              ) : (
                "Nenhuma na fila"
              )
            }
          />
          <CartaoDeNumero
            rotulo="Taxa de resposta"
            valor={responseRate.text}
            extra={<BarraDeProporcao percentual={responseRate.width} />}
            rodape={`${globalRepliedCount} respondidas no total`}
          />
          <CartaoDeNumero
            rotulo="Compras verificadas"
            valor={verifiedRate.text}
            extra={<BarraDeProporcao percentual={verifiedRate.width} />}
            rodape={`${globalVerifiedCount} verificadas no total`}
          />
        </ResumoRecolhivel>

        {configLoaded && (
          <div className="rounded-2xl border border-solid border-admin-border bg-admin-surface px-3.5 py-1.5">
            <div className="flex items-center justify-between gap-3">
              <Label
                htmlFor="enable-reviews-switch"
                className="flex min-h-11 min-w-0 cursor-pointer items-center text-base font-semibold text-white"
              >
                Mostrar avaliações na loja
              </Label>
              <div className="flex shrink-0 items-center gap-1">
                <EstadoComPonto
                  tom={config.enableReviews ? "positivo" : "neutro"}
                  texto={config.enableReviews ? "Ativo" : "Inativo"}
                  className="text-sm"
                />
                <label
                  htmlFor="enable-reviews-switch"
                  className="flex size-11 cursor-pointer items-center justify-center"
                >
                  <Switch
                    id="enable-reviews-switch"
                    checked={config.enableReviews}
                    onCheckedChange={handleToggleReviews}
                    className="data-[state=checked]:bg-foreground data-[state=unchecked]:bg-admin-border-strong"
                    disabled={isOffline || isUpdatingConfig}
                  />
                </label>
              </div>
            </div>
            {!config.enableReviews && (
              <p className="pb-2 text-sm text-zinc-300">
                Ligue para os clientes verem notas e comentários nas páginas dos
                produtos.
              </p>
            )}
          </div>
        )}
      </div>

      <main className="mx-auto mt-4 w-full max-w-3xl px-4">
        {isOffline && (
          <div className="mb-3">
            <AvisoDeProblema>
              Sem conexão. Aprovar, responder e excluir voltam quando a internet
              voltar.
            </AvisoDeProblema>
          </div>
        )}

        {erroDaListagemAdmin && (
          <div className="mb-3">
            <AvisoDeProblema
              acao={
                <button
                  type="button"
                  onClick={triggerRefresh}
                  disabled={loading}
                  className={cn(BOTAO_NEUTRO, "self-start")}
                >
                  Tentar de novo
                </button>
              }
            >
              {erroDaListagemAdmin} Confira a internet e tente de novo.
            </AvisoDeProblema>
          </div>
        )}

        {carregando ? (
          renderSkeleton()
        ) : adminReviews.length === 0 ? (
          !erroDaListagemAdmin && renderEmpty()
        ) : (
          <ul className="space-y-3">{adminReviews.map(renderReview)}</ul>
        )}

        {totalPages > 1 && (
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

      {/* Modal de Ajuda */}
      <AdminHelpModal
        isOpen={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        title="Guia de Moderação de Avaliações"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-zinc-300">
            Esta tela permite auditar e moderar o feedback dos clientes sobre as
            compras. A moderação de avaliações garante que o feed de depoimentos
            se mantenha limpo, verídico e útil para novos compradores.
          </p>

          <div className="space-y-3">
            <h4 className="border-l-2 border-solid border-admin-border-strong pl-2 text-[11px] font-black uppercase tracking-wider text-zinc-300">
              Principais Recursos
            </h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Star aria-hidden="true" className="size-4 fill-current" />
                  Nota por Estrelas (1-5)
                </div>
                <p className="text-sm text-zinc-300">
                  O nível de satisfação do cliente. A média global de estrelas é
                  calculada na parte superior de forma dinâmica.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  Compra Verificada
                </div>
                <p className="text-sm text-zinc-300">
                  Indica que a compra foi paga com pagamento reconhecido pela
                  plataforma. O selo é automático: nasce da confirmação do
                  pagamento — não existe interruptor para marcar ou desmarcar.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <MessageSquare aria-hidden="true" className="size-4" />
                  Resposta Oficial da Loja
                </div>
                <p className="text-sm text-zinc-300">
                  Você pode responder diretamente ao comentário do cliente com
                  atalhos de resposta rápidas predefinidas para dar suporte.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <Trash2 aria-hidden="true" className="size-4" />
                  Exclusão Preventiva
                </div>
                <p className="text-sm text-zinc-300">
                  Avaliações com linguagem imprópria ou spam podem ser
                  permanentemente removidas do sistema clicando no ícone de
                  lixeira.
                </p>
              </div>

              <div className="space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4 sm:col-span-2">
                <div className="flex items-center gap-2 text-sm font-bold text-white">
                  <ThumbsUp aria-hidden="true" className="size-4" />
                  Mostrar avaliações na loja
                </div>
                <p className="text-sm text-zinc-300">
                  O interruptor mostra ou esconde as notas e os comentários nas
                  páginas dos produtos. Com ele ligado, os clientes podem dar
                  notas de 1 a 5 estrelas e escrever depoimentos — isso ajuda a
                  construir confiança para novos compradores. Aqui no painel
                  você lê, responde e decide quais avaliações serão publicadas.
                </p>
              </div>
            </div>
          </div>
        </div>
      </AdminHelpModal>
    </div>
  );
});

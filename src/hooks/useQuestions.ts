import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { supabase } from "@/lib/supabase";
import {
  cachedQuestionsData,
  setCachedQuestionsData,
} from "@/utils/admin_cache";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface Question {
  id: string;
  userId: string;
  productId: string;
  productName?: string;
  productImage?: string;
  customerName: string;
  customerAvatar?: string;
  question: string;
  createdAt: string;
  isVerified?: boolean;
  answers: Answer[];
}

export interface Answer {
  id: string;
  questionId: string;
  answer: string;
  createdAt: string;
  role?: string;
}

/**
 * Resultado de `getQAStats` com o estado da consulta explícito.
 *
 * O cliente do Supabase não lança exceção: quando a consulta falha, ele
 * devolve `{ count: null, error }`. Tratar essa falha com `|| 0` fazia o
 * "não sei" (erro) vestir a fantasia do "não há nenhum" (zero real) — e o
 * cartão de Perguntas anunciava "Fila Limpa" com cliente esperando resposta.
 * Os três estados (falha, com perguntas, vazia de verdade) precisam chegar
 * distinguíveis a quem consome.
 */
export type QAStatsResult =
  | {
      status: "ok";
      total: number;
      pending: number;
      answered: number;
      rate: number;
    }
  | { status: "error"; error: unknown };

const QUESTIONS_CACHE_KEY_PREFIX = "ikcous_questions_cache_";
const memoryQuestionsCache = new Map<string, Question[]>();

const getQuestionsCache = (productId: string): Question[] | null => {
  if (memoryQuestionsCache.has(productId)) {
    return memoryQuestionsCache.get(productId)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${QUESTIONS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryQuestionsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse questions cache", e);
    }
  }
  return null;
};

const updateQuestionsCache = (productId: string, newQuestions: Question[]) => {
  memoryQuestionsCache.set(productId, newQuestions);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        `${QUESTIONS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newQuestions),
      );
    } catch (e) {
      console.error("Failed to update questions cache", e);
    }
  }
};

const bc =
  typeof window !== "undefined"
    ? new BroadcastChannel("ikcous_questions_sync")
    : null;

export function useQuestions() {
  const { user, isAdmin } = useAuth();
  const { isLeader } = useLeaderElection();
  const [questions, setQuestions] = useState<Question[]>(() => {
    return isAdmin && cachedQuestionsData ? cachedQuestionsData : [];
  });
  const [loading, setLoading] = useState(() => isAdmin && !cachedQuestionsData);
  // Falha de fetch ≠ produto sem perguntas: sem este estado, o catch abaixo
  // deixava questions=[] e a tela convidava a cliente a "ser o primeiro" a
  // perguntar num produto que podia ter dez perguntas respondidas.
  const [error, setError] = useState<string | null>(null);
  const latestProductIdRef = useRef<string | null>(null);
  const productQuestionsAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const allQuestionsAbortControllerRef = useRef<AbortController | null>(null);

  const getQuestionsByProduct = useCallback(
    async (productId: string) => {
      latestProductIdRef.current = productId;

      // 1. SWR Cache Sync
      const cached = getQuestionsCache(productId);
      if (cached) {
        setQuestions(cached);
        setLoading(false);
      } else {
        setQuestions([]); // Clear previous product questions if not cached
        setLoading(true);
      }

      if (productQuestionsAbortControllerRef.current) {
        productQuestionsAbortControllerRef.current.abort();
      }
      productQuestionsAbortControllerRef.current = new AbortController();
      const signal = productQuestionsAbortControllerRef.current.signal;

      try {
        const selectQuery = isAdmin
          ? `
          *,
          user:public_profiles(full_name, avatar_url),
          product:produtos(nome, imagem_url),
          answers:answers(*)
        `
          : `
          *,
          user:public_profiles(full_name, avatar_url),
          answers:answers(*)
        `;

        const { data, error } = await supabase
          .from("questions" as any)
          .select(selectQuery)
          .eq("product_id", productId)
          .order("created_at", { ascending: false })
          .abortSignal(signal);

        if (error) throw error;
        if (!data) return;

        // Fetch product info if guest/non-admin
        let productInfo: { nome: string; imagem_url: string } | null = null;
        if (!isAdmin) {
          const query = supabase
            .from("vw_produtos_public" as any)
            .select("nome, imagem_url")
            .eq("id", productId)
            .maybeSingle();
          const { data: prodData } = await (query as any).abortSignal(signal);
          if (prodData) {
            productInfo = prodData as any;
          }
        }

        // Fetch verified status for these users/product
        const userIds = data.map((q: any) => q.user_id);
        let orders: any[] | null = null;
        if (userIds.length > 0) {
          const query = supabase
            .from("marketplace_orders")
            .select(
              "user_id, status, marketplace_order_items!inner(product_id)",
            )
            .in("user_id", userIds)
            .eq("status", "delivered")
            .eq("marketplace_order_items.product_id", productId);
          const { data: ordersData, error: ordersError } = await (
            query as any
          ).abortSignal(signal);

          if (ordersError) {
            const isAbort =
              ordersError.name === "AbortError" ||
              ordersError.message?.includes("aborted") ||
              ordersError.hint?.includes("aborted") ||
              ordersError.details?.includes("aborted");
            if (!isAbort) {
              console.error("Error fetching verified status:", ordersError);
            }
          } else {
            orders = ordersData;
          }
        }

        const verifiedUsers = new Set(orders?.map((o) => o.user_id) || []);

        const formattedQuestions: Question[] = data.map((item: any) => ({
          id: item.id,
          userId: item.user_id,
          productId: item.product_id,
          productName: isAdmin ? item.product?.nome : productInfo?.nome,
          productImage: isAdmin
            ? item.product?.imagem_url
            : productInfo?.imagem_url,
          customerName: item.user?.full_name || "Usuário Anônimo",
          customerAvatar: item.user?.avatar_url || undefined,
          question: item.question,
          createdAt: item.created_at,
          isVerified: verifiedUsers.has(item.user_id),
          answers: (item.answers || [])
            .map((ans: any) => ({
              id: ans.id,
              questionId: ans.question_id,
              answer: ans.answer,
              createdAt: ans.created_at,
            }))
            .sort(
              (a: any, b: any) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            ),
        }));

        if (latestProductIdRef.current === productId) {
          setQuestions(formattedQuestions);
          setError(null);
        }
        updateQuestionsCache(productId, formattedQuestions);
      } catch (error: any) {
        if (
          error?.name === "AbortError" ||
          error?.message === "Fetch is aborted" ||
          error?.message?.includes("aborted")
        ) {
          return;
        }
        console.error("Error fetching questions:", error);
        toast.error("Erro ao carregar perguntas.");
        if (latestProductIdRef.current === productId) {
          setError("Não conseguimos carregar as perguntas deste produto.");
        }
      } finally {
        if (latestProductIdRef.current === productId) {
          setLoading(false);
        }
      }
    },
    [isAdmin],
  );

  const addQuestion = useCallback(
    async (question: { productId: string; question: string }) => {
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          toast.error("Você precisa estar logado para perguntar.");
          return null;
        }

        const { data, error } = await supabase
          .from("questions" as any)
          .insert({
            product_id: question.productId,
            user_id: user.id,
            question: question.question,
          })
          .select()
          .single();

        if (error) throw error;

        toast.success("Pergunta enviada com sucesso!");
        await getQuestionsByProduct(question.productId);
        return data;
      } catch (error: any) {
        console.error("Error adding question:", error);
        toast.error("Erro ao enviar pergunta.");
        return null;
      }
    },
    [getQuestionsByProduct, user],
  );

  const addAnswer = useCallback(
    async (
      answer: { questionId: string; answer: string },
      options?: { silent?: boolean },
    ) => {
      if (!isAdmin) {
        if (!options?.silent) toast.error("Permissão negada");
        return false;
      }
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          if (!options?.silent) toast.error("Login necessário.");
          return false;
        }

        // Execute Atomic Answer & Log via RPC. A mesma chamada serve para
        // responder E para "editar": desde a migration 20260812000000
        // (issue #100) a RPC faz upsert por question_id no banco, então não
        // há — e não deve haver — um segundo caminho de UPDATE aqui no
        // front. Apagar uma resposta pela UI continua fora do escopo.
        const { error } = await (supabase.rpc as any)(
          "answer_question_atomic",
          {
            p_question_id: answer.questionId,
            p_answer: answer.answer,
          },
        );

        if (error) throw error;
        if (!options?.silent) toast.success("Resposta enviada!");
        return true;
      } catch (err: any) {
        console.error(err);
        if (!options?.silent) toast.error("Erro ao responder");
        return false;
      }
    },
    [user, isAdmin],
  );

  const getAllQuestions = useCallback(
    async (
      page = 0,
      pageSize = 20,
      filter: "all" | "pending" = "all",
      search?: string,
      silent = false,
    ) => {
      if (allQuestionsAbortControllerRef.current) {
        allQuestionsAbortControllerRef.current.abort();
      }
      allQuestionsAbortControllerRef.current = new AbortController();
      const signal = allQuestionsAbortControllerRef.current.signal;

      try {
        if (!silent) {
          setLoading(true);
        }

        // High Optimization: If Admin, run single unified RPC on Supabase
        if (isAdmin) {
          const { data, error } = await (supabase.rpc as any)(
            "get_admin_questions_paged",
            {
              p_search: search || "",
              p_filter: filter,
              p_page: page,
              p_page_size: pageSize,
            },
          ).abortSignal(signal);

          if (error) throw error;

          const rpcData = data as any;
          const questionsList = rpcData?.data || [];
          const totalCount = rpcData?.total_count || 0;

          const formatted: Question[] = questionsList.map((item: any) => ({
            id: item.id,
            userId: item.user_id,
            productId: item.product_id,
            productName: item.product?.nome || "Produto removido",
            productImage: item.product?.imagem_url,
            customerName: item.user?.full_name || "Usuário Anônimo",
            customerAvatar: item.user?.avatar_url || undefined,
            question: item.question,
            createdAt: item.created_at,
            isVerified: item.is_verified ?? false,
            answers: (item.answers || [])
              .map((ans: any) => ({
                id: ans.id,
                questionId: ans.question_id,
                answer: ans.answer,
                createdAt: ans.created_at,
              }))
              .sort(
                (a: any, b: any) =>
                  new Date(a.createdAt).getTime() -
                  new Date(b.createdAt).getTime(),
              ),
          }));

          if (isAdmin) {
            setCachedQuestionsData(formatted);
          }
          setQuestions(formatted);
          return { questions: formatted, total: totalCount };
        }

        // Guest/Non-admin fallback flow (original)
        let query: any = supabase.from(
          "vw_questions_with_answers_count" as any,
        );

        if (search) {
          // Sanitizar a query para remover caracteres que quebram o parser do PostgREST no .or()
          const sanitizedSearch = search.replace(/[()[\],.:\\]/g, "");
          const q = `%${sanitizedSearch}%`;

          // Pre-fetch profiles and products matching the search query to bypass PostgREST join OR limitation
          // Limited to 25 to prevent URL length overflow (HTTP 414) in PostgREST
          const { data: profiles } = await supabase
            .from("public_profiles")
            .select("id")
            .ilike("full_name", q)
            .limit(25)
            .abortSignal(signal);
          const profileIds = profiles?.map((p: any) => p.id) || [];
          const profileFilter =
            profileIds.length > 0
              ? profileIds
              : ["00000000-0000-0000-0000-000000000000"];

          const { data: products } = await supabase
            .from("vw_produtos_public" as any)
            .select("id")
            .ilike("nome", q)
            .limit(25)
            .abortSignal(signal);
          const productIds = products?.map((p: any) => p.id) || [];
          const productFilter =
            productIds.length > 0
              ? productIds
              : ["00000000-0000-0000-0000-000000000000"];

          const selectFields = `
                  *,
                  user:public_profiles(full_name, avatar_url),
                  answers:answers(*)
                `;

          query = query
            .select(selectFields, { count: "exact" })
            .or(
              `question.ilike.${q},user_id.in.(${profileFilter.join(",")}),product_id.in.(${productFilter.join(",")})`,
            );
        } else {
          const selectFields = `
                  *,
                  user:public_profiles(full_name, avatar_url),
                  answers:answers(*)
                `;

          query = query.select(selectFields, { count: "exact" });
        }

        if (filter === "pending") {
          query = query.eq("answers_count", 0);
        }

        const { data, error, count } = await query
          .order("created_at", { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1)
          .abortSignal(signal);

        if (error) throw error;

        const productMap = new Map<
          string,
          { nome: string; imagem_url: string }
        >();
        if (data && data.length > 0) {
          const productIds = Array.from(
            new Set(data.map((q: any) => q.product_id)),
          );
          const { data: prodData } = await supabase
            .from("vw_produtos_public" as any)
            .select("id, nome, imagem_url")
            .in("id", productIds)
            .abortSignal(signal);
          if (prodData) {
            prodData.forEach((p: any) => {
              productMap.set(p.id, { nome: p.nome, imagem_url: p.imagem_url });
            });
          }
        }

        const formatted: Question[] = (data || []).map((item: any) => {
          const prod = productMap.get(item.product_id);
          return {
            id: item.id,
            userId: item.user_id,
            productId: item.product_id,
            productName: prod?.nome || "Produto removido",
            productImage: prod?.imagem_url,
            customerName: item.user?.full_name || "Usuário Anônimo",
            customerAvatar: item.user?.avatar_url || undefined,
            question: item.question,
            createdAt: item.created_at,
            answers: (item.answers || [])
              .map((ans: any) => ({
                id: ans.id,
                questionId: ans.question_id,
                answer: ans.answer,
                createdAt: ans.created_at,
              }))
              .sort(
                (a: any, b: any) =>
                  new Date(a.createdAt).getTime() -
                  new Date(b.createdAt).getTime(),
              ),
          };
        });

        setQuestions(formatted);
        return { questions: formatted, total: count || 0 };
      } catch (error: any) {
        if (
          error?.name === "AbortError" ||
          error?.message === "Fetch is aborted" ||
          error?.message?.includes("aborted")
        ) {
          return { questions: [], total: 0 };
        }
        console.error("Error fetching all questions:", error);
        toast.error("Erro ao carregar perguntas.");
        return { questions: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    [isAdmin],
  );

  const deleteQuestion = useCallback(
    async (questionId: string, options?: { silent?: boolean }) => {
      if (!isAdmin) {
        if (!options?.silent) toast.error("Permissão negada");
        return false;
      }
      try {
        const { error } = await supabase
          .from("questions" as any)
          .delete()
          .eq("id", questionId);

        if (error) throw error;
        setQuestions((prev) => prev.filter((q) => q.id !== questionId));
        if (!options?.silent) toast.success("Pergunta removida.");
        return true;
      } catch (error) {
        console.error("Error deleting question:", error);
        if (!options?.silent) toast.error("Erro ao remover pergunta.");
        return false;
      }
    },
    [isAdmin],
  );

  const subscribeToQuestions = useCallback(
    (onChange?: () => void, productId?: string) => {
      const channelId = productId
        ? `questions_prod_${productId}`
        : "questions_all";

      let channel: any = null;
      let listener: any = null;

      if (isLeader) {
        console.log(
          `[Realtime-Questions] Leader tab subscribing to: ${channelId}`,
        );
        channel = supabase
          .channel(channelId)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "questions",
              ...(productId ? { filter: `product_id=eq.${productId}` } : {}),
            },
            (payload) => {
              console.log(
                "[Realtime-Questions] Question change:",
                payload.eventType,
              );
              bc?.postMessage({ type: "questions_change", productId, payload });
              if (onChange) {
                onChange();
              } else if (productId) {
                getQuestionsByProduct(productId);
              } else {
                getAllQuestions();
              }
            },
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "answers",
            },
            (payload) => {
              console.log(
                "[Realtime-Questions] Answer change:",
                payload.eventType,
              );
              // PAINEL-11: canal de answers SEM filtro de produto — resposta
              // de QUALQUER produto chega aqui. O broadcast anterior etiquetava
              // com o productId LOCAL (errado para outros produtos); agora vai
              // sem productId (sinal genérico que todas as abas aceitam).
              bc?.postMessage({ type: "questions_change", payload });
              if (onChange) {
                onChange();
              } else if (productId) {
                getQuestionsByProduct(productId);
              } else {
                getAllQuestions();
              }
            },
          );

        channel.subscribe((status: any, err?: any) => {
          if (status === "SUBSCRIBED") {
            console.log("[Realtime-Questions] Active: %s", channelId);
          } else if (status === "CHANNEL_ERROR") {
            const errMessage =
              err?.message || (typeof err === "string" ? err : "");
            const isNormalClose =
              errMessage.includes("1000") || errMessage.includes("normal");
            const isAbnormalClose =
              errMessage.includes("1006") || errMessage.includes("abnormal");
            if (isNormalClose) {
              console.log(
                "[Realtime-Questions] Channel closed normally in %s (socket closed: 1000)",
                channelId,
              );
            } else if (isAbnormalClose) {
              console.warn(
                "[Realtime-Questions] Channel closed abnormally in %s (socket closed: 1006). SDK will auto-reconnect.",
                channelId,
              );
            } else {
              console.error(
                "[Realtime-Questions] Error in %s:",
                channelId,
                err?.message || err,
              );
            }
          }
        });
      } else {
        console.log(
          "[Realtime-Questions] Secondary tab listening via BroadcastChannel: %s",
          channelId,
        );
        if (bc) {
          listener = (event: MessageEvent) => {
            if (
              event.data?.type === "questions_change" &&
              // PAINEL-11: answers chegam SEM productId (canal sem filtro) —
              // aceitar tanto com (questions, filtrado) quanto sem (answers)
              event.data?.productId === undefined ||
              event.data?.productId === productId
            ) {
              console.log(
                "[Realtime-Questions-Secondary] Received change signal from Leader tab",
              );
              if (onChange) {
                onChange();
              } else if (productId) {
                getQuestionsByProduct(productId);
              } else {
                getAllQuestions();
              }
            }
          };
          bc.addEventListener("message", listener);
        }
      }

      return () => {
        if (channel) {
          console.log(`[Realtime-Questions] Cleaning up channel: ${channelId}`);
          supabase.removeChannel(channel).catch(() => {});
        }
        if (listener && bc) {
          console.log(
            `[Realtime-Questions] Cleaning up BroadcastChannel listener: ${channelId}`,
          );
          bc.removeEventListener("message", listener);
        }
      };
    },
    [isLeader, getQuestionsByProduct, getAllQuestions],
  );

  useEffect(() => {
    return () => {
      if (productQuestionsAbortControllerRef.current) {
        productQuestionsAbortControllerRef.current.abort();
      }
      if (allQuestionsAbortControllerRef.current) {
        allQuestionsAbortControllerRef.current.abort();
      }
    };
  }, []);

  const getQAStats = useCallback(async (): Promise<QAStatsResult> => {
    const [totalRes, pendingRes] = await Promise.all([
      supabase
        .from("vw_questions_with_answers_count" as any)
        .select("*", { count: "exact", head: true }),
      supabase
        .from("vw_questions_with_answers_count" as any)
        .select("*", { count: "exact", head: true })
        .eq("answers_count", 0),
    ]);

    // Falha de consulta NÃO é zero: sem este guarda, `{ count: null, error }`
    // virava `total = 0` e `pending = 0` — "Fila Limpa" mentirosa na tela.
    if (totalRes.error) return { status: "error", error: totalRes.error };
    if (pendingRes.error) return { status: "error", error: pendingRes.error };

    // Aqui só chega consulta que respondeu; count nulo sem error não ocorre
    // no supabase-js, e `??` mantém o zero legítimo exatamente como era.
    const total = totalRes.count ?? 0;
    const pending = pendingRes.count ?? 0;
    const answered = Math.max(0, total - pending);
    const rate = total > 0 ? Math.round((answered / total) * 100) : 0;

    return {
      status: "ok",
      total,
      pending,
      answered,
      rate,
    };
  }, []);

  return {
    questions,
    loading,
    error,
    getQuestionsByProduct,
    getAllQuestions,
    addQuestion,
    addAnswer,
    deleteQuestion,
    subscribeToQuestions,
    getQAStats,
  };
}

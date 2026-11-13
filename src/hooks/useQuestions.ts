import { useAuth } from "@/hooks/useAuth";
import { useLeaderElection } from "@/hooks/useLeaderElection";
import { marcarOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { criarCanalDeAbas } from "@/lib/canal-de-abas";
import {
  PREFIXO_DE_PERGUNTAS,
  gravarCopiaPorProduto,
} from "@/lib/copias-por-produto";
import {
  PRAZO_DAS_ACOES_DO_PEDIDO_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { TETO_DA_RESPOSTA_DA_LOJA } from "@/lib/teto-da-resposta-da-loja";
import type { Database } from "@/types/database.types";
import {
  cachedQuestionsData,
  lerGeracaoDosCachesDeAdmin,
  setCachedQuestionsData,
} from "@/utils/admin_cache";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface Question {
  id: string;
  // I-3 (brief hub-0809-g 08/09/2026): sem sessão, o autor não vem mais do
  // banco (`vw_questions_public` nunca teve `user_id`) — o visitante
  // continua vendo a pergunta, só sem o id de quem escreveu.
  userId?: string;
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

const QUESTIONS_CACHE_KEY_PREFIX = PREFIXO_DE_PERGUNTAS;
const memoryQuestionsCache = new Map<string, Question[]>();

// d5 (caça 03/11/2026): o cache é separado por VISÃO. A logada guarda `userId`
// e o selo "Comprador"; a pública nasce sem os dois de propósito. Com uma chave
// só, o visitante recebia — antes da rede, ou sem rede — o que a pessoa que
// acabou de sair tinha na tela. A chave antiga (sem sufixo) deixa de ser lida.
const chaveDoCache = (productId: string, anonimo: boolean) =>
  `${productId}:${anonimo ? "pub" : "auth"}`;

const getQuestionsCache = (
  productId: string,
  anonimo: boolean,
): Question[] | null => {
  const chave = chaveDoCache(productId, anonimo);
  if (memoryQuestionsCache.has(chave)) {
    return memoryQuestionsCache.get(chave)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${QUESTIONS_CACHE_KEY_PREFIX}${chave}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryQuestionsCache.set(chave, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse questions cache", e);
    }
  }
  return null;
};

const updateQuestionsCache = (
  productId: string,
  anonimo: boolean,
  newQuestions: Question[],
) => {
  const chave = chaveDoCache(productId, anonimo);
  memoryQuestionsCache.set(chave, newQuestions);
  if (typeof window !== "undefined") {
    try {
      gravarCopiaPorProduto(
        QUESTIONS_CACHE_KEY_PREFIX,
        `${QUESTIONS_CACHE_KEY_PREFIX}${chave}`,
        JSON.stringify(newQuestions),
      );
    } catch (e) {
      console.error("Failed to update questions cache", e);
    }
  }
};

const bc = criarCanalDeAbas("ikcous_questions_sync");

/**
 * C4 (laudo novos-ângulos 01/09): decide se um evento de resposta acorda a
 * página de produto aberta. A tabela `answers` não tem `product_id`, então
 * o filtro é pelas perguntas QUE A PÁGINA JÁ CARREGOU: resposta de pergunta
 * de fora não refaz a leitura.
 *
 * Passam de propósito (conservador — um refetch a mais é melhor que uma
 * resposta que não aparece):
 * - evento sem `question_id`: DELETE real replica só a PK no `old`;
 * - página que ainda não carregou as próprias perguntas (conjunto nulo).
 */
const respostaAcordaAPagina = (
  questionId: string | undefined,
  perguntasDoProduto: Set<string> | null,
): boolean => {
  if (questionId === undefined) return true;
  if (perguntasDoProduto === null) return true;
  return perguntasDoProduto.has(questionId);
};

export function useQuestions() {
  const { user, isAdmin, profile } = useAuth();
  const { isLeader } = useLeaderElection();
  const [questions, setQuestions] = useState<Question[]>(() => {
    return isAdmin && cachedQuestionsData ? cachedQuestionsData : [];
  });
  const [loading, setLoading] = useState(() => isAdmin && !cachedQuestionsData);
  // Falha de fetch ≠ produto sem perguntas: sem este estado, o catch abaixo
  // deixava questions=[] e a tela convidava a cliente a "ser o primeiro" a
  // perguntar num produto que podia ter dez perguntas respondidas.
  const [error, setError] = useState<string | null>(null);
  // Mesmo contrato do `erroDaListagemAdmin` de useReviews: a busca da LISTA do
  // painel falhou. Sem isto a tela mostrava a lista da busca anterior, ou
  // "Fila de perguntas limpa" com pergunta esperando resposta.
  const [erroDaListagemAdmin, setErroDaListagemAdmin] = useState<string | null>(
    null,
  );
  const latestProductIdRef = useRef<string | null>(null);
  // C4 (laudo 0109): ids das perguntas do produto que ESTA instância
  // carregou por último — é o conjunto contra o qual o canal de `answers`
  // é filtrado. `null` = página ainda não carregou (deixa passar).
  const questionIdsDoProdutoRef = useRef<Set<string> | null>(null);
  const productQuestionsAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const allQuestionsAbortControllerRef = useRef<AbortController | null>(null);

  const getQuestionsByProduct = useCallback(
    async (productId: string, opcoes?: { silencioso?: boolean }) => {
      latestProductIdRef.current = productId;
      // Ressalva 1 da revisão da frente C4: durante a recarga o conjunto é
      // o ANTIGO — uma resposta a pergunta criada depois da última carga
      // seria descartada e ficaria invisível até o próximo evento. Anulando
      // o conjunto, a janela de carga inteira vira "passa tudo": a mesma
      // semântica conservadora de página que ainda não carregou.
      questionIdsDoProdutoRef.current = null;

      // 1. SWR Cache Sync
      const cached = getQuestionsCache(productId, !user);
      if (cached) {
        setQuestions(cached);
        setLoading(false);
      } else if (!opcoes?.silencioso) {
        setQuestions([]); // Clear previous product questions if not cached
        setLoading(true);
      }

      if (productQuestionsAbortControllerRef.current) {
        productQuestionsAbortControllerRef.current.abort();
      }
      productQuestionsAbortControllerRef.current = new AbortController();
      const signal = productQuestionsAbortControllerRef.current.signal;

      // I-3 (brief hub-0809-g 08/09/2026): sem sessão, a leitura vai pela
      // vitrine pública (`vw_questions_public`, migration 20261110000000) —
      // ela nunca teve `user_id` para vazar. O selo "Comprador" NÃO vem da
      // view (correção B2 do laudo Opus PR#484, 08/09/2026): calculá-lo lá
      // dentro exigia um `EXISTS` sobre `marketplace_orders`/
      // `marketplace_order_items` rodando com o crachá do dono da view — e
      // isso atravessava a RLS de pedidos, que hoje NEGA `anon` nas duas
      // tabelas (sem policy para o papel). O visitante nunca via o selo
      // antes desta frente (a consulta que o calcula sempre devolvia zero
      // linhas para ele); o selo sem sessão fica sempre `false`, mesmo
      // comportamento de hoje. As respostas da loja vêm de uma segunda
      // consulta em `answers` (tabela já 100% pública, inalterada nesta
      // frente). Quem está logado (inclusive admin) continua na tabela, sem
      // mudança — o selo dele segue calculado pelo caminho de sempre.
      const anonimo = !user;

      try {
        if (anonimo) {
          const { data, error } = await aguardarComPrazo(
            Promise.resolve(
              supabase
                .from("vw_questions_public" as any)
                .select("*")
                .eq("product_id", productId)
                .order("created_at", { ascending: false })
                .abortSignal(signal),
            ),
            15000,
            erroDeConsultaSemResposta,
          );

          if (error) throw error;
          if (!data) return;

          let productInfo: { nome: string; imagem_url: string } | null = null;
          const query = supabase
            .from("vw_produtos_public" as any)
            .select("nome, imagem_url")
            .eq("id", productId)
            .maybeSingle();
          const { data: prodData } = await aguardarComPrazo(
            Promise.resolve((query as any).abortSignal(signal)),
            15000,
            erroDeConsultaSemResposta,
          );
          if (prodData) {
            productInfo = prodData as any;
          }

          const questionIds = data.map((q: any) => q.id);
          const answersByQuestion = new Map<string, any[]>();
          // Cada endereço leva no máximo cem ids.
          for (let i = 0; i < questionIds.length; i += 100) {
            const { data: answersData, error: answersError } =
              await aguardarComPrazo(
                Promise.resolve(
                  supabase
                    .from("answers" as any)
                    .select("id, question_id, answer, created_at")
                    .in("question_id", questionIds.slice(i, i + 100))
                    .abortSignal(signal),
                ),
                15000,
                erroDeConsultaSemResposta,
              );
            if (answersError) throw answersError;
            if (answersData) {
              for (const ans of answersData as any[]) {
                const lista = answersByQuestion.get(ans.question_id) || [];
                lista.push(ans);
                answersByQuestion.set(ans.question_id, lista);
              }
            }
          }

          const formattedQuestions: Question[] = data.map((item: any) => ({
            id: item.id,
            userId: undefined,
            productId: item.product_id,
            productName: productInfo?.nome,
            productImage: productInfo?.imagem_url,
            customerName: item.author_name || "Usuário Anônimo",
            customerAvatar: item.author_avatar_url || undefined,
            question: item.question,
            createdAt: item.created_at,
            // B2 (laudo Opus PR#484, 08/09/2026): `vw_questions_public` não
            // tem `is_verified_buyer` — o selo do visitante fica sempre
            // desligado, reproduzindo o que a RLS de pedidos já nega hoje
            // ao anônimo (ver o comentário acima da bifurcação `anonimo`).
            isVerified: false,
            answers: (answersByQuestion.get(item.id) || [])
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
            questionIdsDoProdutoRef.current = new Set(
              formattedQuestions.map((q) => q.id),
            );
            setQuestions(formattedQuestions);
            setError(null);
          }
          updateQuestionsCache(productId, true, formattedQuestions);
          return;
        }

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

        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("questions" as any)
              .select(selectQuery)
              .eq("product_id", productId)
              .order("created_at", { ascending: false })
              .abortSignal(signal),
          ),
          15000,
          erroDeConsultaSemResposta,
        );

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
          const { data: prodData } = await aguardarComPrazo(
            Promise.resolve((query as any).abortSignal(signal)),
            15000,
            erroDeConsultaSemResposta,
          );
          if (prodData) {
            productInfo = prodData as any;
          }
        }

        // Fetch verified status for these users/product
        const userIds = [...new Set(data.map((q: any) => q.user_id))];
        const orders: any[] = [];
        for (let i = 0; i < userIds.length; i += 100) {
          try {
            const query = supabase
              .from("marketplace_orders")
              .select(
                "user_id, status, marketplace_order_items!inner(product_id)",
              )
              .in("user_id", userIds.slice(i, i + 100))
              .eq("status", "delivered")
              .eq("marketplace_order_items.product_id", productId);
            const { data: ordersData, error: ordersError } =
              await aguardarComPrazo(
                Promise.resolve((query as any).abortSignal(signal)),
                15000,
                erroDeConsultaSemResposta,
              );

            if (ordersError) throw ordersError;
            orders.push(...(ordersData || []));
          } catch (erro) {
            const ordersError = erro as {
              name?: string;
              message?: string;
              hint?: string;
              details?: string;
            };
            const isAbort =
              ordersError.name === "AbortError" ||
              ordersError.message?.includes("aborted") ||
              ordersError.hint?.includes("aborted") ||
              ordersError.details?.includes("aborted");
            if (!isAbort) {
              console.error("Error fetching verified status:", ordersError);
            }
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

        // C4 (laudo 0109): atualiza o conjunto que filtra o canal de
        // `answers` — incluindo perguntas recém-criadas pela própria
        // página (o refetch depois de `addQuestion` repassa por aqui).
        //
        // R-2 (laudo varredura 01/09): DENTRO da mesma guarda do
        // `setQuestions`. Sem a guarda, uma carga velha (A, abortada por
        // outra mais recente B) que terminasse DEPOIS da B sobrescrevia o
        // conjunto com os ids DELA enquanto a tela mostrava as perguntas
        // de B — resposta a pergunta de B parava de acordar a página e
        // resposta a pergunta de A acordava a tela errada. Estado
        // consistente: o conjunto é sempre o da carga que governa a tela.
        if (latestProductIdRef.current === productId) {
          questionIdsDoProdutoRef.current = new Set(
            formattedQuestions.map((q) => q.id),
          );
          setQuestions(formattedQuestions);
          setError(null);
        }
        updateQuestionsCache(productId, false, formattedQuestions);
      } catch (error: any) {
        if (
          error?.name === "AbortError" ||
          error?.message === "Fetch is aborted" ||
          error?.message?.includes("aborted")
        ) {
          return;
        }
        console.error("Error fetching questions:", error);
        if (!opcoes?.silencioso) toast.error("Erro ao carregar perguntas.");
        // R-2 (laudo varredura 01/09): a carga que falhou, se ainda é a
        // governante, deixa o conjunto NULO — o filtro passa tudo
        // (comportamento conservador de "ainda não carregou": um refetch a
        // mais é melhor que uma resposta invisível). Sob a MESMA guarda do
        // setError: a falha de uma carga VELHA (a tela já recarregou com
        // outra carga) não pode destruir o conjunto que a carga nova
        // acabou de gravar.
        if (latestProductIdRef.current === productId) {
          questionIdsDoProdutoRef.current = null;
          if (!opcoes?.silencioso)
            setError("Não conseguimos carregar as perguntas deste produto.");
        }
      } finally {
        if (latestProductIdRef.current === productId) {
          setLoading(false);
        }
      }
    },
    // B1 (laudo Opus PR#484, 08/09/2026): `user?.id`, não `user`. O ramo só
    // lê `!user`; o objeto `user` do AuthContext ganha identidade nova a
    // cada `setUser` (login/logout, mas também renovação de token), o que
    // dava a `getQuestionsByProduct` uma identidade nova a cada render —
    // derrubando e recriando à toa o canal de realtime do consumidor
    // (`ProductQA.tsx`) e quebrando o duble de teste que usa um objeto
    // literal novo por chamada. `user?.id` é a chave estável; incluir
    // `user` inteiro reintroduziria o bug (mesma disciplina de
    // `useDataVault.ts:35`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, user?.id],
  );

  const addQuestion = useCallback(
    async (question: { productId: string; question: string }) => {
      const desmarcar = marcarOperacaoSensivel("envio-de-pergunta");
      const idsAntesDoEnvio = new Set(
        (getQuestionsCache(question.productId, false) || []).map((q) => q.id),
      );
      try {
        // ZENITH v21.7: Rely on AuthContext's verified user
        if (!user) {
          toast.error("Você precisa estar logado para perguntar.");
          return null;
        }

        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("questions" as any)
              .insert({
                product_id: question.productId,
                user_id: user.id,
                question: question.question,
              })
              .select()
              .single(),
          ),
          15000,
          erroDeConsultaSemResposta,
        );

        if (error) throw error;

        toast.success("Pergunta enviada com sucesso!");
        // A gravação já foi confirmada: mostre-a mesmo sem rede para reler.
        const gravada =
          data as unknown as Database["public"]["Tables"]["questions"]["Row"];
        const nova: Question = {
          id: gravada.id,
          userId: user.id,
          productId: question.productId,
          customerName: profile?.full_name || "Usuário Anônimo",
          question: gravada.question,
          createdAt: gravada.created_at,
          answers: [],
        };
        const listaAnterior = getQuestionsCache(question.productId, false);
        const atualizadas = [
          nova,
          ...(listaAnterior || []).filter((q) => q.id !== nova.id),
        ];
        // Sem uma carga completa, [nova] é só a confirmação local, não a lista do produto.
        if (listaAnterior !== null)
          updateQuestionsCache(question.productId, false, atualizadas);
        if (
          !latestProductIdRef.current ||
          latestProductIdRef.current === question.productId
        ) {
          setQuestions(atualizadas);
          if (listaAnterior !== null) setError(null);
        }
        void getQuestionsByProduct(question.productId, { silencioso: true });
        return data;
      } catch (error: any) {
        console.error("Error adding question:", error);
        toast.error(
          ehConsultaSemResposta(error)
            ? "A conexão está lenta. Sua pergunta pode ter sido recebida. Confira antes de tentar de novo."
            : "Erro ao enviar pergunta.",
        );
        if (ehConsultaSemResposta(error)) {
          await getQuestionsByProduct(question.productId, {
            silencioso: true,
          });
          const conferidas = getQuestionsCache(question.productId, false);
          // Só a linha confirmada pelo servidor limpa o rascunho no formulário.
          return (
            conferidas?.find(
              (q) =>
                q.userId === user?.id &&
                q.question === question.question &&
                !idsAntesDoEnvio.has(q.id),
            ) ?? null
          );
        }
        return null;
      } finally {
        desmarcar();
      }
    },
    [getQuestionsByProduct, user, profile?.full_name],
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
        if (!user?.id) {
          if (!options?.silent) toast.error("Login necessário.");
          return false;
        }

        // A resposta vira texto público: o teto vale aqui também, porque o
        // `maxLength` do campo não segura texto colado nem resposta antiga
        // maior. Recusa sem chamar o servidor — e avisa até no modo
        // silencioso, onde a tela só diria "confira na lista" (o problema é o
        // texto, não a rede).
        if (answer.answer.length > TETO_DA_RESPOSTA_DA_LOJA) {
          toast.error(
            `A resposta passou de ${TETO_DA_RESPOSTA_DA_LOJA} caracteres. Encurte o texto e envie de novo.`,
          );
          return false;
        }

        // Execute Atomic Answer & Log via RPC. A mesma chamada serve para
        // responder E para "editar": desde a migration 20260812000000
        // (issue #100) a RPC faz upsert por question_id no banco, então não
        // há — e não deve haver — um segundo caminho de UPDATE aqui no
        // front. Apagar uma resposta pela UI continua fora do escopo.
        const { error } = await aguardarComPrazo(
          Promise.resolve(
            (supabase.rpc as any)("answer_question_atomic", {
              p_question_id: answer.questionId,
              p_answer: answer.answer,
            }),
          ) as Promise<{ error: unknown }>,
          PRAZO_DAS_ACOES_DO_PEDIDO_MS,
          () => erroDeConsultaSemResposta(),
        );

        if (error) throw error;
        if (!options?.silent) toast.success("Resposta enviada!");
        return true;
      } catch (err: any) {
        console.error(err);
        // Mesmo no modo silencioso, o prazo exige avisar que a gravação
        // pode ter ocorrido; não é seguro oferecer apenas "tente de novo".
        if (ehConsultaSemResposta(err))
          toast.error(
            "Sem resposta da rede. Confira na lista antes de tentar de novo.",
          );
        else if (!options?.silent) toast.error("Erro ao responder");
        return false;
      }
    },
    [user?.id, isAdmin],
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
      const geracao = lerGeracaoDosCachesDeAdmin();

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

          if (geracao !== lerGeracaoDosCachesDeAdmin()) return;
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
          setErroDaListagemAdmin(null);
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
        setErroDaListagemAdmin(null);
        return { questions: formatted, total: count || 0 };
      } catch (error: any) {
        // Carga cancelada (a próxima já saiu) não é falha: a que a substituiu
        // é quem decide o que a tela mostra.
        if (
          error?.name === "AbortError" ||
          error?.message === "Fetch is aborted" ||
          error?.message?.includes("aborted")
        ) {
          return { questions: [], total: 0, falhou: true };
        }
        console.error("Error fetching all questions:", error);
        // Releitura de bastidor: a última lista boa continua na tela e no cache.
        if (silent) return { questions: [], total: 0, falhou: true };
        toast.error("Erro ao carregar perguntas.");
        // A lista e o cache da leitura anterior saem, para a falha não parecer
        // o resultado de outro filtro/busca (contrato do useReviews).
        setQuestions([]);
        if (isAdmin) setCachedQuestionsData(null);
        setErroDaListagemAdmin("Não foi possível carregar as perguntas.");
        return { questions: [], total: 0, falhou: true };
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
        // `.select("id")`: 0 linhas apagadas (política de acesso) vem como sucesso.
        const { data: apagadas, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("questions" as any)
              .delete()
              .eq("id", questionId)
              .select("id"),
          ),
          PRAZO_DAS_ACOES_DO_PEDIDO_MS,
          () => erroDeConsultaSemResposta(),
        );

        if (error) throw error;
        if (!apagadas?.length) throw new Error("Nenhuma pergunta apagada.");
        setQuestions((prev) => prev.filter((q) => q.id !== questionId));
        // Ressalva 2 da revisão C4: pergunta excluída sai do conjunto —
        // resposta futura a ela (excluída em cascata ou órfã) não gera
        // refetch inútil.
        questionIdsDoProdutoRef.current?.delete(questionId);
        if (!options?.silent) toast.success("Pergunta removida.");
        return true;
      } catch (error) {
        console.error("Error deleting question:", error);
        if (ehConsultaSemResposta(error))
          toast.error(
            "Sem resposta da rede. Confira na lista antes de tentar de novo.",
          );
        else if (!options?.silent) toast.error("Erro ao remover pergunta.");
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
              // sem productId (sinal genérico que todas as abas aceitam), com
              // o question_id do evento para cada aba aplicar a guarda.
              const questionIdDoEvento =
                (payload as any).new?.question_id ??
                (payload as any).old?.question_id ??
                undefined;
              bc?.postMessage({
                type: "questions_change",
                questionId: questionIdDoEvento,
                payload,
              });
              // C4 (laudo 0109): página de produto só refaz a leitura quando
              // a resposta é de pergunta DESTE produto.
              if (
                !respostaAcordaAPagina(
                  questionIdDoEvento,
                  questionIdsDoProdutoRef.current,
                )
              ) {
                return;
              }
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
              (event.data?.type === "questions_change" &&
                // PAINEL-11: answers chegam SEM productId (canal sem filtro) —
                // aceitar tanto com (questions, filtrado) quanto sem (answers)
                event.data?.productId === undefined) ||
              event.data?.productId === productId
            ) {
              // C4 (laudo 0109): a MESMA guarda do canal do líder vale na aba
              // secundária — respostas de perguntas de outro produto não
              // acordam esta página. Mensagens sem question_id (canal de
              // questions, DELETE real) passam como sempre.
              if (
                productId &&
                !respostaAcordaAPagina(
                  event.data?.questionId,
                  questionIdsDoProdutoRef.current,
                )
              ) {
                return;
              }
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
    erroDaListagemAdmin,
    getQuestionsByProduct,
    getAllQuestions,
    addQuestion,
    addAnswer,
    deleteQuestion,
    subscribeToQuestions,
    getQAStats,
  };
}

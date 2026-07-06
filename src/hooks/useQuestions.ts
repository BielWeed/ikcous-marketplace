import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

export interface Question {
    id: string;
    userId: string;
    productId: string;
    productName?: string;
    productImage?: string;
    customerName: string;
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

const QUESTIONS_CACHE_KEY_PREFIX = 'ikcous_questions_cache_';
const memoryQuestionsCache = new Map<string, Question[]>();

const getQuestionsCache = (productId: string): Question[] | null => {
  if (memoryQuestionsCache.has(productId)) {
    return memoryQuestionsCache.get(productId)!;
  }
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(`${QUESTIONS_CACHE_KEY_PREFIX}${productId}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryQuestionsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error('Failed to parse questions cache', e);
    }
  }
  return null;
};

const updateQuestionsCache = (productId: string, newQuestions: Question[]) => {
  memoryQuestionsCache.set(productId, newQuestions);
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(`${QUESTIONS_CACHE_KEY_PREFIX}${productId}`, JSON.stringify(newQuestions));
    } catch (e) {
      console.error('Failed to update questions cache', e);
    }
  }
};

export function useQuestions() {
    const { user, isAdmin } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(false);
    const latestProductIdRef = useRef<string | null>(null);
    const productQuestionsAbortControllerRef = useRef<AbortController | null>(null);
    const allQuestionsAbortControllerRef = useRef<AbortController | null>(null);

    const getQuestionsByProduct = useCallback(async (productId: string) => {
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
          user:public_profiles(full_name),
          product:produtos(nome, imagem_url),
          answers:answers(*)
        `
                : `
          *,
          user:public_profiles(full_name),
          answers:answers(*)
        `;

            const { data, error } = await supabase
                .from('questions' as any)
                .select(selectQuery)
                .eq('product_id', productId)
                .order('created_at', { ascending: false })
                .abortSignal(signal);

            if (error) throw error;
            if (!data) return;

            // Fetch product info if guest/non-admin
            let productInfo: { nome: string; imagem_url: string } | null = null;
            if (!isAdmin) {
                const query = supabase
                    .from('vw_produtos_public' as any)
                    .select('nome, imagem_url')
                    .eq('id', productId)
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
                    .from('marketplace_orders')
                    .select('user_id, status, marketplace_order_items!inner(product_id)')
                    .in('user_id', userIds)
                    .eq('status', 'delivered')
                    .eq('marketplace_order_items.product_id', productId);
                const { data: ordersData, error: ordersError } = await (query as any).abortSignal(signal);

                if (ordersError) {
                    console.error('Error fetching verified status:', ordersError);
                } else {
                    orders = ordersData;
                }
            }

            const verifiedUsers = new Set(orders?.map(o => o.user_id) || []);

            const formattedQuestions: Question[] = data.map((item: any) => ({
                id: item.id,
                userId: item.user_id,
                productId: item.product_id,
                productName: isAdmin ? item.product?.nome : productInfo?.nome,
                productImage: isAdmin ? item.product?.imagem_url : productInfo?.imagem_url,
                customerName: item.user?.full_name || 'Usuário Anônimo',
                question: item.question,
                createdAt: item.created_at,
                isVerified: verifiedUsers.has(item.user_id),
                answers: (item.answers || []).map((ans: any) => ({
                    id: ans.id,
                    questionId: ans.question_id,
                    answer: ans.answer,
                    createdAt: ans.created_at,
                })).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            }));

            if (latestProductIdRef.current === productId) {
                setQuestions(formattedQuestions);
            }
            updateQuestionsCache(productId, formattedQuestions);
        } catch (error: any) {
            if (error?.name === 'AbortError' || error?.message === 'Fetch is aborted' || error?.message?.includes('aborted')) {
                return;
            }
            console.error('Error fetching questions:', error);
            toast.error('Erro ao carregar perguntas.');
        } finally {
            if (latestProductIdRef.current === productId) {
                setLoading(false);
            }
        }
    }, [isAdmin]);

    const addQuestion = useCallback(async (question: { productId: string, question: string }) => {
        try {
            // ZENITH v21.7: Rely on AuthContext's verified user
            if (!user) {
                toast.error('Você precisa estar logado para perguntar.');
                return null;
            }

            const { data, error } = await supabase
                .from('questions' as any)
                .insert({
                    product_id: question.productId,
                    user_id: user.id,
                    question: question.question,
                })
                .select()
                .single();

            if (error) throw error;

            toast.success('Pergunta enviada com sucesso!');
            await getQuestionsByProduct(question.productId);
            return data;
        } catch (error: any) {
            console.error('Error adding question:', error);
            toast.error('Erro ao enviar pergunta.');
            return null;
        }
    }, [getQuestionsByProduct, user]);

    const addAnswer = useCallback(async (answer: { questionId: string, answer: string }, options?: { silent?: boolean }) => {
        if (!isAdmin) {
            if (!options?.silent) toast.error('Permissão negada');
            return false;
        }
        try {
            // ZENITH v21.7: Rely on AuthContext's verified user
            if (!user) {
                if (!options?.silent) toast.error('Login necessário.');
                return false;
            }

            // Execute Atomic Answer & Log via RPC
            const { error } = await (supabase.rpc as any)('answer_question_atomic', {
                p_question_id: answer.questionId,
                p_answer: answer.answer
            });

            if (error) throw error;
            if (!options?.silent) toast.success('Resposta enviada!');
            return true;
        } catch (err: any) {
            console.error(err);
            if (!options?.silent) toast.error("Erro ao responder");
            return false;
        }
    }, [user, isAdmin]);

    const getAllQuestions = useCallback(async (page: number = 0, pageSize: number = 20, filter: 'all' | 'pending' = 'all', search?: string, silent = false) => {
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
                const { data, error } = await (supabase.rpc as any)('get_admin_questions_paged', {
                    p_search: search || '',
                    p_filter: filter,
                    p_page: page,
                    p_page_size: pageSize
                }).abortSignal(signal);

                if (error) throw error;
                
                const rpcData = data as any;
                const questionsList = rpcData?.data || [];
                const totalCount = rpcData?.total_count || 0;

                const formatted: Question[] = questionsList.map((item: any) => ({
                    id: item.id,
                    userId: item.user_id,
                    productId: item.product_id,
                    productName: item.product?.nome || 'Produto removido',
                    productImage: item.product?.imagem_url,
                    customerName: item.user?.full_name || 'Usuário Anônimo',
                    question: item.question,
                    createdAt: item.created_at,
                    isVerified: item.is_verified ?? false,
                    answers: (item.answers || []).map((ans: any) => ({
                        id: ans.id,
                        questionId: ans.question_id,
                        answer: ans.answer,
                        createdAt: ans.created_at,
                    })).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                }));

                setQuestions(formatted);
                return { questions: formatted, total: totalCount };
            }

            // Guest/Non-admin fallback flow (original)
            let query: any = supabase
                .from('vw_questions_with_answers_count' as any);

            if (search) {
                const q = `%${search}%`;
                
                // Pre-fetch profiles and products matching the search query to bypass PostgREST join OR limitation
                // Limited to 25 to prevent URL length overflow (HTTP 414) in PostgREST
                const { data: profiles } = await supabase
                  .from('public_profiles')
                  .select('id')
                  .ilike('full_name', q)
                  .limit(25)
                  .abortSignal(signal);
                const profileIds = profiles?.map((p: any) => p.id) || [];
                const profileFilter = profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000'];

                const { data: products } = await supabase
                  .from('vw_produtos_public' as any)
                  .select('id')
                  .ilike('nome', q)
                  .limit(25)
                  .abortSignal(signal);
                const productIds = products?.map((p: any) => p.id) || [];
                const productFilter = productIds.length > 0 ? productIds : ['00000000-0000-0000-0000-000000000000'];

                const selectFields = `
                  *,
                  user:public_profiles(full_name),
                  answers:answers(*)
                `;

                query = query.select(selectFields, { count: 'exact' })
                .or(`question.ilike.${q},user_id.in.(${profileFilter.join(',')}),product_id.in.(${productFilter.join(',')})`);
            } else {
                const selectFields = `
                  *,
                  user:public_profiles(full_name),
                  answers:answers(*)
                `;

                query = query.select(selectFields, { count: 'exact' });
            }

            if (filter === 'pending') {
                query = query.eq('answers_count', 0);
            }

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1)
                .abortSignal(signal);

            if (error) throw error;

            const productMap = new Map<string, { nome: string; imagem_url: string }>();
            if (data && data.length > 0) {
                const productIds = Array.from(new Set(data.map((q: any) => q.product_id)));
                const { data: prodData } = await supabase
                    .from('vw_produtos_public' as any)
                    .select('id, nome, imagem_url')
                    .in('id', productIds)
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
                    productName: prod?.nome || 'Produto removido',
                    productImage: prod?.imagem_url,
                    customerName: item.user?.full_name || 'Usuário Anônimo',
                    question: item.question,
                    createdAt: item.created_at,
                    answers: (item.answers || []).map((ans: any) => ({
                        id: ans.id,
                        questionId: ans.question_id,
                        answer: ans.answer,
                        createdAt: ans.created_at,
                    })).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                };
            });

            setQuestions(formatted);
            return { questions: formatted, total: count || 0 };
        } catch (error: any) {
            if (error?.name === 'AbortError' || error?.message === 'Fetch is aborted' || error?.message?.includes('aborted')) {
                return { questions: [], total: 0 };
            }
            console.error('Error fetching all questions:', error);
            toast.error('Erro ao carregar perguntas.');
            return { questions: [], total: 0 };
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    const deleteQuestion = useCallback(async (questionId: string, options?: { silent?: boolean }) => {
        if (!isAdmin) {
            if (!options?.silent) toast.error('Permissão negada');
            return;
        }
        try {
            const { error } = await supabase
                .from('questions' as any)
                .delete()
                .eq('id', questionId);

            if (error) throw error;
            setQuestions(prev => prev.filter(q => q.id !== questionId));
            if (!options?.silent) toast.success('Pergunta removida.');
        } catch (error) {
            console.error('Error deleting question:', error);
            if (!options?.silent) toast.error('Erro ao remover pergunta.');
        }
    }, [isAdmin]);

    const subscribeToQuestions = useCallback((onChange?: () => void, productId?: string) => {
        const channelId = productId ? `questions_prod_${productId}` : `questions_all`;
        console.log(`[Realtime] Subscribing to questions/answers: ${channelId}`);
        
        const channel = supabase
            .channel(channelId)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'questions',
                    ...(productId ? { filter: `product_id=eq.${productId}` } : {})
                },
                (payload) => {
                    console.log('[Realtime] Question change:', payload.eventType);
                    if (onChange) {
                        onChange();
                    } else if (productId) {
                        getQuestionsByProduct(productId);
                    } else {
                        getAllQuestions();
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'answers'
                },
                (payload) => {
                    console.log('[Realtime] Answer change:', payload.eventType);
                    if (onChange) {
                        onChange();
                    } else if (productId) {
                        getQuestionsByProduct(productId);
                    } else {
                        getAllQuestions();
                    }
                }
            );

        channel.subscribe((status, err) => {
            if (status === 'SUBSCRIBED') {
                console.log(`[Realtime] Active: ${channelId}`);
            } else if (status === 'CHANNEL_ERROR') {
                console.error(`[Realtime] Error in ${channelId}:`, err?.message || err);
            }
        });

        return () => {
            console.log(`[Realtime] Cleaning up ${channelId}`);
            supabase.removeChannel(channel).catch(() => {});
        };
    }, [getQuestionsByProduct, getAllQuestions]);

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

    return {
        questions,
        loading,
        getQuestionsByProduct,
        getAllQuestions,
        addQuestion,
        addAnswer,
        deleteQuestion,
        subscribeToQuestions
    };
}

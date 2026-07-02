import { useState, useCallback, useRef } from 'react';
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
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (!data) return;

            // Fetch product info if guest/non-admin
            let productInfo: { nome: string; imagem_url: string } | null = null;
            if (!isAdmin) {
                const { data: prodData } = await supabase
                    .from('vw_produtos_public' as any)
                    .select('nome, imagem_url')
                    .eq('id', productId)
                    .maybeSingle();
                if (prodData) {
                    productInfo = prodData as any;
                }
            }

            // Fetch verified status for these users/product
            const userIds = data.map((q: any) => q.user_id);
            let orders: any[] | null = null;
            if (userIds.length > 0) {
                const { data: ordersData, error: ordersError } = await supabase
                    .from('marketplace_orders')
                    .select('user_id, status, marketplace_order_items!inner(product_id)')
                    .in('user_id', userIds)
                    .eq('status', 'delivered')
                    .eq('marketplace_order_items.product_id', productId);

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

    const addAnswer = useCallback(async (answer: { questionId: string, answer: string }) => {
        if (!isAdmin) {
            toast.error('Permissão negada');
            return false;
        }
        try {
            // ZENITH v21.7: Rely on AuthContext's verified user
            if (!user) {
                toast.error('Login necessário.');
                return false;
            }

            // Execute Atomic Answer & Log via RPC
            const { error } = await (supabase.rpc as any)('answer_question_atomic', {
                p_question_id: answer.questionId,
                p_answer: answer.answer
            });

            if (error) throw error;
            toast.success('Resposta enviada!');
            return true;
        } catch (err: any) {
            console.error(err);
            toast.error("Erro ao responder");
            return false;
        }
    }, [user, isAdmin]);

    const getAllQuestions = useCallback(async (page: number = 0, pageSize: number = 20, filter: 'all' | 'pending' = 'all', search?: string) => {
        try {
            setLoading(true);
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
                  .limit(25);
                const profileIds = profiles?.map((p: any) => p.id) || [];
                const profileFilter = profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000'];

                const { data: products } = await supabase
                  .from((isAdmin ? 'produtos' : 'vw_produtos_public') as any)
                  .select('id')
                  .ilike('nome', q)
                  .limit(25);
                const productIds = products?.map((p: any) => p.id) || [];
                const productFilter = productIds.length > 0 ? productIds : ['00000000-0000-0000-0000-000000000000'];

                const selectFields = isAdmin
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

                query = query.select(selectFields, { count: 'exact' })
                .or(`question.ilike.${q},user_id.in.(${profileFilter.join(',')}),product_id.in.(${productFilter.join(',')})`);
            } else {
                const selectFields = isAdmin
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

                query = query.select(selectFields, { count: 'exact' });
            }

            if (filter === 'pending') {
                query = query.eq('answers_count', 0);
            }

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            const productMap = new Map<string, { nome: string; imagem_url: string }>();
            if (!isAdmin && data && data.length > 0) {
                const productIds = Array.from(new Set(data.map((q: any) => q.product_id)));
                const { data: prodData } = await supabase
                    .from('vw_produtos_public' as any)
                    .select('id, nome, imagem_url')
                    .in('id', productIds);
                if (prodData) {
                    prodData.forEach((p: any) => {
                        productMap.set(p.id, { nome: p.nome, imagem_url: p.imagem_url });
                    });
                }
            }

            const formatted: Question[] = (data || []).map((item: any) => {
                const prod = isAdmin ? item.product : productMap.get(item.product_id);
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
            console.error('Error fetching all questions:', error);
            toast.error('Erro ao carregar perguntas.');
            return { questions: [], total: 0 };
        } finally {
            setLoading(false);
        }
    }, [isAdmin]);

    const deleteQuestion = useCallback(async (questionId: string) => {
        if (!isAdmin) {
            toast.error('Permissão negada');
            return;
        }
        try {
            const { error } = await supabase
                .from('questions' as any)
                .delete()
                .eq('id', questionId);

            if (error) throw error;
            setQuestions(prev => prev.filter(q => q.id !== questionId));
            toast.success('Pergunta removida.');
        } catch (error) {
            console.error('Error deleting question:', error);
            toast.error('Erro ao remover pergunta.');
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

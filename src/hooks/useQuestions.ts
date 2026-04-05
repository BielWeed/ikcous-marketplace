import { useState, useCallback } from 'react';
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

export function useQuestions() {
    const { user } = useAuth();
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(false);

    const getQuestionsByProduct = useCallback(async (productId: string) => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('questions' as any)
                .select(`
          *,
          user:public_profiles(full_name),
          product:produtos(nome, imagem_url),
          answers:answers(*)
        `)
                .eq('product_id', productId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            if (!data) return;

            // Fetch verified status for these users/product
            const userIds = data.map((q: any) => q.user_id);
            const { data: orders, error: ordersError } = await supabase
                .from('marketplace_orders')
                .select('user_id, status, order_items!inner(product_id)')
                .in('user_id', userIds)
                .eq('status', 'delivered')
                .eq('order_items.product_id', productId);

            if (ordersError) {
                console.error('Error fetching verified status:', ordersError);
            }

            const verifiedUsers = new Set(orders?.map(o => o.user_id) || []);

            const formattedQuestions: Question[] = data.map((item: any) => ({
                id: item.id,
                userId: item.user_id,
                productId: item.product_id,
                productName: item.product?.nome,
                productImage: item.product?.imagem_url,
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

            setQuestions(formattedQuestions);
        } catch (error: any) {
            console.error('Error fetching questions:', error);
            toast.error('Erro ao carregar perguntas.');
        } finally {
            setLoading(false);
        }
    }, []);

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
    }, [user]);

    const getAllQuestions = useCallback(async (page: number = 0, pageSize: number = 20, filter: 'all' | 'pending' = 'all') => {
        try {
            setLoading(true);
            let query = supabase
                .from('questions' as any)
                .select(`
                  *,
                  user:public_profiles(full_name),
                  product:produtos(nome, imagem_url),
                  answers:answers(*)
                `, { count: 'exact' });

            if (filter === 'pending') {
                // Return questions that have no answers. 
                // Using .is('answers.id', null) with a LEFT JOIN (default) filters for questions with zero answers.
                query = query.is('answers.id', null);
            }

            const { data, error, count } = await query
                .order('created_at', { ascending: false })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            const formatted: Question[] = (data || []).map((item: any) => ({
                id: item.id,
                userId: item.user_id,
                productId: item.product_id,
                productName: item.product?.nome || 'Produto removido',
                productImage: item.product?.imagem_url,
                customerName: item.user?.full_name || 'Usuário Anônimo',
                question: item.question,
                createdAt: item.created_at,
                answers: (item.answers || []).map((ans: any) => ({
                    id: ans.id,
                    questionId: ans.question_id,
                    answer: ans.answer,
                    createdAt: ans.created_at,
                })).sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            }));

            setQuestions(formatted);
            return { questions: formatted, total: count || 0 };
        } catch (error: any) {
            console.error('Error fetching all questions:', error);
            toast.error('Erro ao carregar perguntas.');
            return { questions: [], total: 0 };
        } finally {
            setLoading(false);
        }
    }, []);

    const deleteQuestion = useCallback(async (questionId: string) => {
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
    }, []);

    const subscribeToQuestions = useCallback((productId?: string) => {
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
                    if (productId) {
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
                    if (productId) {
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

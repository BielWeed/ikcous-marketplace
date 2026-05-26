import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { Category } from '@/types';

let cachedCategories: Category[] | null = null;
const CACHE_KEY = 'ikcous_categories_cache';

const updateCache = (newCategories: Category[]) => {
    cachedCategories = newCategories;
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(newCategories));
    } catch (e) {
        console.error('Failed to update categories cache', e);
    }
};

export function useCategories() {
    const [categories, setCategories] = useState<Category[]>(() => {
        if (cachedCategories) return cachedCategories;
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(CACHE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    cachedCategories = parsed;
                    return parsed;
                }
            } catch (e) {
                console.error('Failed to parse categories cache', e);
            }
        }
        return [];
    });

    const [isLoading, setIsLoading] = useState(() => {
        return cachedCategories ? false : true;
    });

    const fetchCategories = useCallback(async (isSilent = false) => {
        try {
            if (!isSilent) {
                setIsLoading(true);
            }
            const { data, error } = await supabase
                .from('categorias')
                .select('*')
                .order('nome');

            if (error) throw error;

            const adaptedCategories: Category[] = (data || []).map((item) => ({
                id: item.id,
                name: item.nome,
                slug: item.slug || '',
                description: item.descricao || '',
                isActive: item.ativo ?? true,
                createdAt: item.created_at
            }));

            setCategories(adaptedCategories);
            updateCache(adaptedCategories);
        } catch (error) {
            console.error('Error fetching categories:', error);
            toast.error('Erro ao carregar categorias');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const hasCache = !!cachedCategories;
        fetchCategories(hasCache);
    }, [fetchCategories]);

    const generateSlug = (name: string) => {
        return name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)+/g, '');
    };

    const addCategory = useCallback(async (category: Omit<Category, 'id' | 'createdAt' | 'slug'>) => {
        const tempId = `temp-${Date.now()}`;
        const slug = generateSlug(category.name);
        const newCategory: Category = {
            id: tempId,
            name: category.name,
            slug,
            description: category.description,
            isActive: category.isActive,
            createdAt: new Date().toISOString()
        };

        setCategories(prev => {
            const next = [...prev, newCategory];
            updateCache(next);
            return next;
        });

        try {
            const { data, error } = await supabase
                .from('categorias')
                .insert({
                    nome: category.name,
                    slug,
                    descricao: category.description,
                    ativo: category.isActive
                })
                .select()
                .single();

            if (error) throw error;

            setCategories(prev => {
                const final = prev.map(c => c.id === tempId ? {
                    id: data.id,
                    name: data.nome,
                    slug: data.slug || '',
                    description: data.descricao || '',
                    isActive: data.ativo ?? true,
                    createdAt: data.created_at
                } : c);
                updateCache(final);
                return final;
            });

            toast.success('Categoria criada com sucesso!');
            return data;
        } catch (error) {
            setCategories(prev => {
                const reverted = prev.filter(c => c.id !== tempId);
                updateCache(reverted);
                return reverted;
            });
            console.error('Error adding category:', error);
            toast.error('Erro ao criar categoria');
            throw error;
        }
    }, []);

    const updateCategory = useCallback(async (id: string, updates: Partial<Omit<Category, 'id' | 'createdAt' | 'slug'>>) => {
        let previousCategories: Category[] = [];
        setCategories(prev => {
            previousCategories = [...prev];
            const next = prev.map(c => {
                if (c.id === id) {
                    const nextItem = { ...c, ...updates };
                    if (updates.name) nextItem.slug = generateSlug(updates.name);
                    return nextItem;
                }
                return c;
            });
            updateCache(next);
            return next;
        });

        try {
            const updateData: any = {};
            if (updates.name) {
                updateData.nome = updates.name;
                updateData.slug = generateSlug(updates.name);
            }
            if (updates.description !== undefined) updateData.descricao = updates.description;
            if (updates.isActive !== undefined) updateData.ativo = updates.isActive;

            const { error } = await supabase
                .from('categorias')
                .update(updateData)
                .eq('id', id);

            if (error) throw error;
            toast.success('Categoria atualizada com sucesso!');
        } catch (error) {
            setCategories(() => {
                updateCache(previousCategories);
                return previousCategories;
            });
            console.error('Error updating category:', error);
            toast.error('Erro ao atualizar categoria');
            throw error;
        }
    }, []);

    const deleteCategory = useCallback(async (id: string) => {
        let previousCategories: Category[] = [];
        setCategories(prev => {
            previousCategories = [...prev];
            const next = prev.filter(c => c.id !== id);
            updateCache(next);
            return next;
        });

        try {
            const { error } = await supabase
                .from('categorias')
                .delete()
                .eq('id', id);

            if (error) throw error;
            toast.success('Categoria removida com sucesso!');
        } catch (error) {
            setCategories(() => {
                updateCache(previousCategories);
                return previousCategories;
            });
            console.error('Error deleting category:', error);
            toast.error('Erro ao remover categoria');
            throw error;
        }
    }, []);

    return {
        categories,
        isLoading,
        fetchCategories,
        addCategory,
        updateCategory,
        deleteCategory
    };
}

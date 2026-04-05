import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { Category } from '@/types';

export function useCategories() {
    const [categories, setCategories] = useState<Category[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchCategories = useCallback(async () => {
        try {
            setIsLoading(true);
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
        } catch (error) {
            console.error('Error fetching categories:', error);
            toast.error('Erro ao carregar categorias');
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (categories.length === 0) {
            fetchCategories();
        }
    }, [fetchCategories, categories.length]);

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

        setCategories(prev => [...prev, newCategory]);

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

            setCategories(prev => prev.map(c => c.id === tempId ? {
                id: data.id,
                name: data.nome,
                slug: data.slug || '',
                description: data.descricao || '',
                isActive: data.ativo ?? true,
                createdAt: data.created_at
            } : c));

            toast.success('Categoria criada com sucesso!');
            return data;
        } catch (error) {
            setCategories(prev => prev.filter(c => c.id !== tempId));
            console.error('Error adding category:', error);
            toast.error('Erro ao criar categoria');
            throw error;
        }
    }, []);

    const updateCategory = useCallback(async (id: string, updates: Partial<Omit<Category, 'id' | 'createdAt' | 'slug'>>) => {
        const previousCategories = [...categories];

        setCategories(prev => prev.map(c => {
            if (c.id === id) {
                const next = { ...c, ...updates };
                if (updates.name) next.slug = generateSlug(updates.name);
                return next;
            }
            return c;
        }));

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
            setCategories(previousCategories);
            console.error('Error updating category:', error);
            toast.error('Erro ao atualizar categoria');
            throw error;
        }
    }, [categories]);

    const deleteCategory = useCallback(async (id: string) => {
        const previousCategories = [...categories];
        setCategories(prev => prev.filter(c => c.id !== id));

        try {
            const { error } = await supabase
                .from('categorias')
                .delete()
                .eq('id', id);

            if (error) throw error;
            toast.success('Categoria removida com sucesso!');
        } catch (error) {
            setCategories(previousCategories);
            console.error('Error deleting category:', error);
            toast.error('Erro ao remover categoria');
            throw error;
        }
    }, [categories]);

    return {
        categories,
        isLoading,
        fetchCategories,
        addCategory,
        updateCategory,
        deleteCategory
    };
}

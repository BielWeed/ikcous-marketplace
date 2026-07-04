import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { DataVault } from '@/lib/dataVault';
import { useSyncListener } from '@/hooks/useDataVault';
import type { Category } from '@/types';
// Module-level cache to persist data across component mounts
let globalCategoriesCache: Category[] | null = null;
let categoriesFetchPromise: Promise<Category[]> | null = null;
let lastCategoriesFetchTime = 0;
const FETCH_THROTTLE = 60000; // 1 minute throttle for network checks

export function useCategories() {
    const vaultRef = useRef<DataVault | null>(null);
    const [categories, setCategories] = useState<Category[]>(globalCategoriesCache || []);
    const [isLoading, setIsLoading] = useState(!globalCategoriesCache);

    // Persist to DataVault (non-blocking helper)
    const persistToVault = useCallback((items: Category[]) => {
        vaultRef.current?.replaceAll('categories', items).then(() => {
            vaultRef.current?.setLastSync('categories');
        }).catch(() => {});
    }, []);

    // Load from DataVault on mount (instant, <5ms)
    useEffect(() => {
        let cancelled = false;
        const initVaultAndLoad = async () => {
            try {
                const vault = await DataVault.init();
                vaultRef.current = vault;
                if (!globalCategoriesCache) {
                    const cached = await vault.getAll<Category>('categories');
                    if (cached.length > 0 && !cancelled) {
                        globalCategoriesCache = cached;
                        setCategories(cached);
                        setIsLoading(false);
                    }
                }
            } catch (err) {
                console.error('[useCategories] DataVault load failed:', err);
            }
        };
        initVaultAndLoad();
        return () => { cancelled = true; };
    }, []);

    const fetchCategories = useCallback(async (isSilent = false, forceRefresh = false) => {
        if (categoriesFetchPromise && !forceRefresh) {
            try {
                const data = await categoriesFetchPromise;
                setCategories(data);
                setIsLoading(false);
            } catch { /* fallback */ }
            return;
        }

        try {
            if (!isSilent) {
                setIsLoading(true);
            }
            
            const queryPromise = (async () => {
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
                globalCategoriesCache = adaptedCategories;
                lastCategoriesFetchTime = Date.now();
                persistToVault(adaptedCategories);
                return adaptedCategories;
            })();

            categoriesFetchPromise = queryPromise;
            const data = await queryPromise;
            setCategories(data);
        } catch (error) {
            console.error('Error fetching categories:', error);
            toast.error('Erro ao carregar categorias');
        } finally {
            setIsLoading(false);
            categoriesFetchPromise = null;
        }
    }, [persistToVault]);

    useEffect(() => {
        const hasCache = categories.length > 0;
        if (!hasCache) {
            fetchCategories(false);
        } else if (Date.now() - lastCategoriesFetchTime > FETCH_THROTTLE) {
            fetchCategories(true, true);
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

    const addCategory = useCallback(async (category: Omit<Category, 'id' | 'createdAt' | 'slug'>, silent?: boolean) => {
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
            persistToVault(next);
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
                persistToVault(final);
                return final;
            });

            if (!silent) toast.success('Categoria criada com sucesso!');
            return data;
        } catch (error) {
            setCategories(prev => {
                const reverted = prev.filter(c => c.id !== tempId);
                persistToVault(reverted);
                return reverted;
            });
            console.error('Error adding category:', error);
            if (!silent) toast.error('Erro ao criar categoria');
            throw error;
        }
    }, [persistToVault]);

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
            persistToVault(next);
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
                persistToVault(previousCategories);
                return previousCategories;
            });
            console.error('Error updating category:', error);
            toast.error('Erro ao atualizar categoria');
            throw error;
        }
    }, [persistToVault]);

    const deleteCategory = useCallback(async (id: string) => {
        let previousCategories: Category[] = [];
        setCategories(prev => {
            previousCategories = [...prev];
            const next = prev.filter(c => c.id !== id);
            persistToVault(next);
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
                persistToVault(previousCategories);
                return previousCategories;
            });
            console.error('Error deleting category:', error);
            toast.error('Erro ao remover categoria');
            throw error;
        }
    }, [persistToVault]);

    // Realtime sync: re-read from DataVault when RealtimeSyncEngine updates categories
    useSyncListener(['categories'], useCallback(async () => {
        if (vaultRef.current) {
            const fresh = await vaultRef.current.getAll<Category>('categories');
            if (fresh.length > 0) {
                setCategories(fresh);
            }
        }
    }, []));

    return {
        categories,
        isLoading,
        fetchCategories,
        addCategory,
        updateCategory,
        deleteCategory
    };
}

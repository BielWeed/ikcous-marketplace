 
import { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';
import { mapProductFromDB } from '@/lib/mappers';
import { TruthGate } from '@/utils/truth_gate';
import type { Product, ProductVariant } from '@/types';

export function useProducts({ autoFetch = true } = {}) {
  const { products: contextProducts, loadingProducts: contextLoading, fetchProducts: refreshContext } = useStore();
  const [localProducts, setLocalProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useAuth();
  const lastLoadId = useRef(0);
  const isFetchingRef = useRef(false);

  // Return context products if we are just doing a standard fetch
  const products = autoFetch ? contextProducts : localProducts;
  const currentLoading = autoFetch ? contextLoading : loading;
  const fetchProducts = useCallback(async () => {
    await refreshContext();
  }, [refreshContext]);

  // Load products with pagination and filtering (Admin focus)
  const loadProducts = useCallback(async (page = 0, pageSize = 10, filters?: any) => {
    if (isFetchingRef.current) return null;
    const loadId = ++lastLoadId.current;
    try {
      setLoading(true);
      isFetchingRef.current = true;
      let data: any[] | null = null;
      let count: number | null = null;

      // Pagination
      const from = page * pageSize;
      const to = from + pageSize - 1;

      // Use the base table for admins to see 'custo' and other hidden fields
      // Use the public view for everyone else to avoid 403 Forbidden and sanitize data
      let query: any;
      if (isAdmin) {
        query = supabase.from('produtos').select('*', { count: 'exact' });
      } else {
        query = supabase.from('vw_produtos_public').select('*', { count: 'exact' });
      }
      
      // Apply Search
      if (filters?.search) {
        // Use 'nome' for both table and view as verified in migrations
        query = query.ilike('nome', `%${filters.search}%`);
      }

      // Apply Status
      if (filters?.status === 'active') {
        query = query.eq('ativo', true);
      } else if (filters?.status === 'inactive') {
        query = query.eq('ativo', false);
      }

      // Apply Stock
      if (filters?.stock === 'low') {
        query = query.lte('estoque', 5);
      }

      const { data: fetchData, error: fetchError, count: fetchCount } = await query
        .order('data_cadastro', { ascending: false })
        .range(from, to);

      if (fetchError) throw fetchError;
      
      if (fetchData && fetchData.length > 0) {
        // Step 2: Fetch variants for these products
        const productIds = (fetchData as any[]).map((p: any) => p.id).filter(id => id !== null) as string[];
        const { data: variants, error: varError } = await supabase
          .from('product_variants')
          .select('*')
          .in('product_id', productIds);
        
        if (varError) {
          console.error('[useProducts] Error fetching variants:', varError);
        }

        // Merge variants into products
        data = (fetchData as any[]).map((p: any) => ({
          ...p,
          product_variants: variants?.filter(v => v.product_id === p.id) || []
        }));
      } else {
        data = fetchData;
      }
      count = fetchCount;

      if (data) {
        if (loadId !== lastLoadId.current) return null;
        const mappedProducts = (data as any[]).map((item: any) => mapProductFromDB(item));
        setLocalProducts(mappedProducts);
        return {
          products: mappedProducts,
          total: count || 0
        };
      }
      return { products: [], total: 0 };
    } catch (err) {
      console.error('Error loading products:', err);
      toast.error('Erro ao listar produtos');
      return null;
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [isAdmin]);

  // We rely on the context for autoFetch now
  useEffect(() => {
    // If not auto-fetching from context, we might need a local fetch 
    // but usually this hook is used either as a context consumer or as an admin fetcher.
  }, []);

  const getProductById = useCallback((id: string) => {
    return products.find(p => p.id === id);
  }, [products]);

  const addProduct = async (productData: Omit<Product, 'id' | 'createdAt' | 'rating' | 'reviewCount' | 'variants'>) => {
    if (!isAdmin) {
      toast.error('Permissão negada');
      return;
    }
    try {
      // TruthGate: Security & Logic Validation
      TruthGate.verifyProductAxiom(productData);

      const { data, error } = await supabase
        .from('produtos')
        .insert({
          nome: productData.name,
          descricao: productData.description,
          preco_venda: productData.price,
          custo: productData.costPrice || 0,
          preco_original: productData.originalPrice,
          estoque: productData.stock,
          categoria: productData.category,
          imagem_url: productData.images[0] || null,
          imagem_urls: productData.images,
          ativo: productData.isActive,
          is_bestseller: productData.isBestseller,
          frete_gratis: productData.freeShipping,
          meta_title: productData.metaTitle,
          meta_description: productData.metaDescription,
          tags: productData.tags || [],
          sold: 0
        } as any)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        const newProduct = mapProductFromDB(data);
        await refreshContext();
        toast.success('Produto cadastrado com sucesso!');
        return newProduct;
      }
    } catch (err: any) {
      console.error('Error adding product:', err);
      toast.error(err.message || 'Erro ao cadastrar produto');
      throw err;
    }
  };

  const updateProduct = async (id: string, updates: Partial<Product>) => {
    if (!isAdmin) {
      toast.error('Permissão negada');
      return;
    }
    try {
      // TruthGate: Security & Logic Validation
      TruthGate.verifyProductAxiom(updates);

      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.nome = updates.name;
      if (updates.description !== undefined) dbUpdates.descricao = updates.description;
      if (updates.price !== undefined) dbUpdates.preco_venda = updates.price;
      if (updates.costPrice !== undefined) dbUpdates.custo = updates.costPrice;
      if (updates.originalPrice !== undefined) dbUpdates.preco_original = updates.originalPrice;
      if (updates.stock !== undefined) dbUpdates.estoque = updates.stock;
      if (updates.category !== undefined) dbUpdates.categoria = updates.category;
      if (updates.images !== undefined) {
        dbUpdates.imagem_urls = updates.images;
        dbUpdates.imagem_url = updates.images[0] || null;
      }
      if (updates.isActive !== undefined) dbUpdates.ativo = updates.isActive;
      if (updates.isBestseller !== undefined) dbUpdates.is_bestseller = updates.isBestseller;
      if (updates.freeShipping !== undefined) dbUpdates.frete_gratis = updates.freeShipping;
      if (updates.metaTitle !== undefined) dbUpdates.meta_title = updates.metaTitle;
      if (updates.metaDescription !== undefined) dbUpdates.meta_description = updates.metaDescription;
      if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
      if (updates.sold !== undefined) dbUpdates.sold = updates.sold;

      const { data, error } = await supabase
        .from('produtos')
        .update(dbUpdates)
        .eq('id', id)
        .select(`
          *,
          product_variants(*)
        `)
        .single();

      if (error) throw error;

      if (data) {
        const updatedProduct = mapProductFromDB(data);
        await refreshContext();
        toast.success('Produto atualizado!');
        return updatedProduct;
      }
    } catch (err: any) {
      console.error('Error updating product:', err);
      toast.error(err.message || 'Erro ao atualizar produto');
      throw err;
    }
  };

  const deleteProduct = async (id: string) => {
    if (!isAdmin) {
      toast.error('Permissão negada');
      return;
    }
    try {
      const { error } = await supabase
        .from('produtos')
        .update({
          deleted_at: new Date().toISOString(),
          ativo: false
        })
        .eq('id', id);

      if (error) throw error;

      await refreshContext();
      toast.success('Produto removido');
      return true;
    } catch (err: any) {
      console.error('Error deleting product:', err);
      toast.error('Erro ao excluir produto');
      return false;
    }
  };

  // Bulk Delete
  const deleteProducts = async (ids: string[]) => {
    try {
      const { error } = await supabase
        .from('produtos')
        .update({
          deleted_at: new Date().toISOString(),
          ativo: false
        })
        .in('id', ids);

      if (error) throw error;

      await refreshContext();
      toast.success(`${ids.length} produtos removidos`);
      return true;
    } catch (err) {
      console.error('Error deleting products:', err);
      toast.error('Erro ao excluir produtos');
      return false;
    }
  };

  // Bulk Status Update
  const updateProductsStatus = async (ids: string[], isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('produtos')
        .update({ ativo: isActive })
        .in('id', ids);

      if (error) throw error;

      await refreshContext();
      toast.success('Status atualizado');
      return true;
    } catch (err) {
      console.error('Error updating products status:', err);
      toast.error('Erro ao atualizar status');
      return false;
    }
  };

  const toggleProductStatus = async (id: string, currentStatus: boolean) => {
    return updateProduct(id, { isActive: !currentStatus });
  };

  const uploadProductImages = async (files: File[]) => {
    const urls: string[] = [];

    for (const file of files) {
      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('products')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('products')
          .getPublicUrl(filePath);

        urls.push(publicUrl);
      } catch (err) {
        console.error('Error uploading file:', err);
        toast.error(`Erro ao enviar imagem ${file.name}`);
      }
    }

    return urls;
  };

  // Recommendations Logic - Server Side RPC
  const fetchRecommendations = useCallback(async (productId: string, limit = 4) => {
    try {
      const { data, error } = await (supabase.rpc as any)('get_product_recommendations', {
        p_product_id: productId,
        p_limit: limit
      });

      if (error) throw error;

      // Map database results to application model
      return data ? (data as any[]).map((item: any) => mapProductFromDB(item)) : [];
    } catch (err) {
      console.error('Error fetching recommendations:', err);
      // Fallback to local filter if RPC fails (failsafe)
      // Fallback: Optimized local loop to prevent processing entire cache
      const fallback: Product[] = [];
      for (const p of products) {
        if (p.id !== productId && p.isActive && p.stock > 0) {
          fallback.push(p);
          if (fallback.length >= limit) break;
        }
      }
      return fallback;
    }
  }, [products]);

  // Fetch single product (Optimized for Edit Form)
  const fetchProduct = useCallback(async (id: string) => {
    try {
      setLoading(true);
      
      // Use the base table for admins to see 'custo' and other hidden fields
      let pQuery: any;
      if (isAdmin) {
        pQuery = supabase.from('produtos').select('*').eq('id', id).single();
      } else {
        pQuery = supabase.from('vw_produtos_public').select('*').eq('id', id).single();
      }
      
      const { data: p, error: pErr } = await pQuery;
      
      if (pErr) throw pErr;

      const { data: v, error: vErr } = await supabase
        .from('product_variants')
        .select('*')
        .eq('product_id', id);
      
      if (vErr) console.error('[useProducts] Error fetching variants for product:', vErr);
      
      const productData = {
        ...(p as any),
        product_variants: v || []
      };

      if (productData) {
        return mapProductFromDB(productData);
      }
      return null;
    } catch (err) {
      console.error('Error fetching product:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  // Deprecated: Synchronous version for backward compatibility
  // Prioritize fetchRecommendations
  const getRecommendations = (productId: string, limit = 4) => {
    const res: Product[] = [];
    for (const p of products) {
      if (p.id !== productId && p.isActive && p.stock > 0) {
        res.push(p);
        if (res.length >= limit) break;
      }
    }
    return res;
  };

  const getCartRecommendations = (cartProductIds: string[], limit = 4) => {
    const res: Product[] = [];
    for (const p of products) {
      if (!cartProductIds.includes(p.id) && p.isActive && p.stock > 0) {
        res.push(p);
        if (res.length >= limit) break;
      }
    }
    return res;
  };

  const getFreeShippingEligibleProducts = (cartProductIds: string[], limit = 10) => {
    const res: Product[] = [];
    for (const p of products) {
      if (!cartProductIds.includes(p.id) && p.isActive && p.stock > 0) {
        res.push(p);
        if (res.length >= limit) break;
      }
    }
    return res;
  };

  // Track Recommendation Click
  const trackRecommendationClick = (_productId: string, _source: string) => {
    // Analytics ping could be restored here if needed
  };



  // Variant Management
  const addVariant = async (variantData: Omit<ProductVariant, 'id'>) => {
    try {
      const { data, error } = await supabase
        .from('product_variants')
        .insert({
          product_id: variantData.productId,
          name: variantData.name,
          value: variantData.value,
          sku: variantData.sku,
          stock_increment: variantData.stockIncrement,
          price_override: variantData.priceOverride,
          active: variantData.active
        } as any)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        const newVariant = {
          id: data.id,
          productId: data.product_id,
          name: data.name,
          value: data.value,
          stockIncrement: data.stock_increment,
          priceOverride: data.price_override,
          active: data.active,
          sku: data.sku
        } as ProductVariant;

        // Update products
        await refreshContext();

        toast.success('Variante adicionada');
        return newVariant;
      }
    } catch (err) {
      console.error('Error adding variant:', err);
      toast.error('Erro ao adicionar variante');
      throw err;
    }
  };

  const updateVariant = async (id: string, updates: Partial<ProductVariant>) => {
    try {
      const dbUpdates: any = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.value !== undefined) dbUpdates.value = updates.value;
      if (updates.sku !== undefined) dbUpdates.sku = updates.sku;
      if (updates.stockIncrement !== undefined) dbUpdates.stock_increment = updates.stockIncrement;
      if (updates.priceOverride !== undefined) dbUpdates.price_override = updates.priceOverride;
      if (updates.active !== undefined) dbUpdates.active = updates.active;

      const { data, error } = await supabase
        .from('product_variants')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        // Update local state
        await refreshContext();
        toast.success('Variante atualizada');
      }
    } catch (err) {
      console.error('Error updating variant:', err);
      toast.error('Erro ao atualizar variante');
      throw err;
    }
  };

  const deleteVariant = async (id: string) => {
    try {
      const { error } = await supabase
        .from('product_variants')
        .delete()
        .eq('id', id);

      if (error) throw error;

      await refreshContext();
      toast.success('Variante removida');
    } catch (err) {
      console.error('Error deleting variant:', err);
      toast.error('Erro ao remover variante');
      throw err;
    }
  };

  return {
    products,
    loading: currentLoading,
    isLoaded: !currentLoading, // Derived property for backward compatibility
    fetchProducts,
    loadProducts,
    fetchAdminProducts: loadProducts, // Alias for backward compatibility if needed
    getProductById,
    addProduct,
    updateProduct,
    deleteProduct,
    deleteProducts,
    updateProductsStatus,
    fetchRecommendations,
    getRecommendations,
    getCartRecommendations,
    uploadProductImages,
    trackRecommendationClick,
    addVariant,
    updateVariant,
    deleteVariant,
    fetchProduct,
    getFreeShippingEligibleProducts,
    toggleProductStatus
  };
}

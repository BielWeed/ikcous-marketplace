import { useStore } from "@/contexts/StoreContext";
import { clearAnalyticsCache } from "@/hooks/useAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { mapProductFromDB } from "@/lib/mappers";
import { supabase } from "@/lib/supabase";
import type { Product, ProductVariant } from "@/types";
import { TruthGate } from "@/utils/truth_gate";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

async function callRpcWithRetry<T>(
  fn: () => Promise<{ data: T | null; error: any }>,
  retries = 3,
  delay = 500,
): Promise<{ data: T | null; error: any }> {
  let lastError: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fn();
      if (!res.error) {
        return res;
      }
      lastError = res.error;

      if (lastError.message?.includes("JWT") || lastError.status === 401) {
        const {
          data: { session },
        } = await supabase.auth.refreshSession();
        if (session) {
          const retryRes = await fn();
          if (!retryRes.error) return retryRes;
          lastError = retryRes.error;
        }
      }

      if (
        i < retries &&
        (!lastError.status ||
          lastError.status >= 500 ||
          lastError.status === 408)
      ) {
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
      } else {
        break;
      }
    } catch (err: any) {
      lastError = err;
      if (i < retries) {
        await new Promise((resolve) => setTimeout(resolve, delay * 2 ** i));
      } else {
        break;
      }
    }
  }
  return { data: null, error: lastError };
}

// Memory cache for Admin Products (SWR Pattern)
let cachedAdminProducts: Product[] | null = null;
let cachedAdminProductsTotal = 0;

async function syncOfflineUpdates(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  const queueStr = localStorage.getItem("products_offline_updates_queue");
  if (!queueStr) return false;

  try {
    const queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) return false;

    const remainingQueue: any[] = [];
    const discarded: string[] = [];
    let syncedCount = 0;
    const toastId = toast.loading(
      `Sincronizando ${queue.length} atualizações pendentes offline...`,
    );

    for (const item of queue) {
      const { id, updates } = item;

      // TruthGate: a fila vive no localStorage e pode ter sido adulterada entre
      // o enfileiramento e o sync. Sem isto a alteração entra direto em
      // `produtos` sem passar por nenhum axioma.
      try {
        TruthGate.verifyProductAxiom(updates);
      } catch (err: any) {
        // Violação de axioma é permanente: retentar não conserta, só refaz o
        // loop para sempre. Descarta o item em vez de devolver para a fila.
        console.error(
          "[Offline Sync] Item rejeitado pelo TruthGate %s:",
          id,
          err,
        );
        discarded.push(id);
        continue;
      }

      try {
        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.nome = updates.name;
        if (updates.description !== undefined)
          dbUpdates.descricao = updates.description;
        if (updates.price !== undefined) dbUpdates.preco_venda = updates.price;
        if (updates.costPrice !== undefined)
          dbUpdates.custo = updates.costPrice;
        if (updates.originalPrice !== undefined)
          dbUpdates.preco_original = updates.originalPrice;
        if (updates.stock !== undefined) dbUpdates.estoque = updates.stock;
        if (updates.category !== undefined)
          dbUpdates.categoria = updates.category;
        if (updates.images !== undefined) {
          dbUpdates.imagem_urls = updates.images;
          dbUpdates.imagem_url = updates.images[0] || null;
        }
        if (updates.isActive !== undefined) dbUpdates.ativo = updates.isActive;
        if (updates.isBestseller !== undefined)
          dbUpdates.is_bestseller = updates.isBestseller;
        if (updates.freeShipping !== undefined)
          dbUpdates.frete_gratis = updates.freeShipping;
        if (updates.metaTitle !== undefined)
          dbUpdates.meta_title = updates.metaTitle;
        if (updates.metaDescription !== undefined)
          dbUpdates.meta_description = updates.metaDescription;
        if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
        if (updates.sold !== undefined) dbUpdates.sold = updates.sold;
        if (updates.sku !== undefined) dbUpdates.codigo = updates.sku || null;

        const { error } = await supabase
          .from("produtos")
          .update(dbUpdates)
          .eq("id", id);

        if (error) throw error;
        syncedCount += 1;
      } catch (err) {
        console.error("[Offline Sync] Failed to sync product %s:", id, err);
        remainingQueue.push(item);
      }
    }

    if (remainingQueue.length > 0) {
      localStorage.setItem(
        "products_offline_updates_queue",
        JSON.stringify(remainingQueue),
      );
      toast.error(
        `Falha ao sincronizar ${remainingQueue.length} alterações. Tentando novamente mais tarde.`,
        { id: toastId },
      );
    } else {
      localStorage.removeItem("products_offline_updates_queue");
      if (syncedCount > 0) clearAnalyticsCache();
      if (discarded.length > 0) {
        toast.dismiss(toastId);
      } else {
        toast.success(
          "Todas as atualizações pendentes foram sincronizadas com sucesso!",
          { id: toastId },
        );
      }
    }

    // Descartados por violação de axioma nunca voltam para a fila — avisa o
    // admin de que a alteração feita offline foi perdida de propósito.
    if (discarded.length > 0) {
      toast.warning(
        `${discarded.length} alteração(ões) offline foram descartadas por violarem os axiomas do produto.`,
      );
    }

    return syncedCount > 0;
  } catch (e) {
    console.error("[Offline Sync] Error parsing offline updates queue:", e);
    return false;
  }
}

export function useProducts({ autoFetch = true } = {}) {
  const {
    products: contextProducts,
    loadingProducts: contextLoading,
    fetchProducts: refreshContext,
  } = useStore();
  const [localProducts, setLocalProducts] = useState<Product[]>(() => {
    return !autoFetch && cachedAdminProducts ? cachedAdminProducts : [];
  });
  const [loading, setLoading] = useState(false);
  const { isAdmin } = useAuth();
  const lastLoadId = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Return context products if we are just doing a standard fetch
  const products = autoFetch ? contextProducts : localProducts;
  const currentLoading = autoFetch ? contextLoading : loading;
  const fetchProducts = useCallback(async () => {
    await refreshContext();
  }, [refreshContext]);

  const backupStorageFile = useCallback(
    async (url: string): Promise<string | null> => {
      try {
        if (!url) return null;
        if (url.includes("placehold.co") || url.includes("placeholder"))
          return url;

        const parts = url.split("/public/products/");
        if (parts.length < 2) return url;
        const filePath = decodeURIComponent(parts[1]);

        if (filePath.startsWith("backup/")) return url;

        const fileParts = filePath.split(".");
        const ext = fileParts.pop();
        const baseName = fileParts.join(".");
        const timestamp = Date.now();
        const newFilePath = `backup/${baseName}_${timestamp}.${ext}`;

        const { error } = await supabase.storage
          .from("products")
          .move(filePath, newFilePath);

        if (error) {
          console.error(
            "[useProducts] Error moving file to backup in storage:",
            error,
            filePath,
            newFilePath,
          );
          return url;
        }
        console.log(
          "[useProducts] Moved storage file to backup:",
          filePath,
          "->",
          newFilePath,
        );
        const {
          data: { publicUrl },
        } = supabase.storage.from("products").getPublicUrl(newFilePath);
        return publicUrl;
      } catch (err) {
        console.error("[useProducts] Failed to backup storage file:", err, url);
        return url;
      }
    },
    [],
  );

  // Fetch single product (Optimized for Edit Form)
  const fetchProduct = useCallback(
    async (id: string) => {
      try {
        setLoading(true);

        // Use the base table for admins to see 'custo' and other hidden fields
        let pQuery: any;
        if (isAdmin) {
          pQuery = supabase
            .from("vw_produtos_admin")
            .select("*")
            .eq("id", id)
            .is("deleted_at", null)
            .single();
        } else {
          pQuery = supabase
            .from("vw_produtos_public")
            .select("*")
            .eq("id", id)
            .single();
        }

        const { data: p, error: pErr } = await pQuery;

        if (pErr) throw pErr;

        const { data: v, error: vErr } = await supabase
          .from("product_variants")
          .select("*")
          .eq("product_id", id);

        if (vErr)
          console.error(
            "[useProducts] Error fetching variants for product:",
            vErr,
          );

        const productData = {
          ...(p as any),
          product_variants: v || [],
        };

        if (productData) {
          return mapProductFromDB(productData);
        }
        return null;
      } catch (err) {
        console.error("Error fetching product:", err);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [isAdmin],
  );

  // Load products with pagination and filtering (Admin focus)
  const loadProducts = useCallback(
    async (page = 0, pageSize = 10, filters?: any) => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      const loadId = ++lastLoadId.current;

      try {
        if (!filters?.silent) {
          setLoading(true);
        }
        let data: any[] | null = null;
        let count: number | null = null;

        if (isAdmin) {
          // Use the new optimized get_admin_products_paged RPC
          const { data: rpcData, error: rpcError } =
            await callRpcWithRetry<any>(async () => {
              const query = (supabase.rpc as any)("get_admin_products_paged", {
                p_search: filters?.search || "",
                p_category: filters?.category || "all",
                p_status: filters?.status || "all",
                p_stock: filters?.stock || "all",
                p_page: page,
                p_page_size: pageSize,
              });
              return query.abortSignal(signal);
            });

          if (rpcError) throw rpcError;

          if (rpcData) {
            data = rpcData.data || [];
            count = Number(rpcData.total_count) || 0;
          }
        } else {
          // Pagination for public/non-admin flow
          const from = page * pageSize;
          const to = from + pageSize - 1;

          let query = supabase
            .from("vw_produtos_public")
            .select("*", { count: "exact" });

          // Apply Search
          if (filters?.search) {
            query = query.ilike("nome", `%${filters.search}%`);
          }

          // Apply Status
          if (filters?.status === "active") {
            query = query.eq("ativo", true);
          } else if (filters?.status === "inactive") {
            query = query.eq("ativo", false);
          }

          // Apply Stock
          if (filters?.stock === "low") {
            query = query.lte("estoque", 5);
          }

          // Apply Category
          if (filters?.category) {
            query = query.eq("categoria", filters.category);
          }

          query = query.abortSignal(signal);

          const {
            data: fetchData,
            error: fetchError,
            count: fetchCount,
          } = await query
            .order("data_cadastro", { ascending: false })
            .range(from, to);

          if (fetchError) throw fetchError;

          if (fetchData && fetchData.length > 0) {
            // Fetch variants for these products
            const productIds = (fetchData as any[])
              .map((p: any) => p.id)
              .filter((id) => id !== null) as string[];
            const { data: variants, error: varError } = await supabase
              .from("product_variants")
              .select("*")
              .in("product_id", productIds)
              .abortSignal(signal);

            if (varError) {
              console.error("[useProducts] Error fetching variants:", varError);
            }

            // Merge variants into products
            data = (fetchData as any[]).map((p: any) => {
              const merged = Object.assign({}, p);
              merged.product_variants =
                variants?.filter((v) => v.product_id === p.id) || [];
              return merged;
            });
          } else {
            data = fetchData;
          }
          count = fetchCount;
        }

        if (data) {
          if (loadId !== lastLoadId.current) return null;
          const mappedProducts = (data as any[]).map((item: any) =>
            mapProductFromDB(item),
          );
          setLocalProducts(mappedProducts);
          if (!autoFetch && isAdmin) {
            cachedAdminProducts = mappedProducts;
            cachedAdminProductsTotal = count || 0;
          }
          return {
            products: mappedProducts,
            total: count || 0,
          };
        }
        return { products: [], total: 0 };
      } catch (err: any) {
        if (
          err?.name === "AbortError" ||
          err?.message === "Fetch is aborted" ||
          err?.message?.includes("aborted")
        ) {
          return null;
        }
        console.error("Error loading products:", err);
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          if (cachedAdminProducts) {
            setLocalProducts(cachedAdminProducts);
            return {
              products: cachedAdminProducts,
              total: cachedAdminProductsTotal,
            };
          }
        } else {
          toast.error("Erro ao listar produtos");
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [isAdmin, autoFetch],
  );

  // We rely on the context for autoFetch now
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Synchronize queued offline updates when coming back online
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnlineSync = () => {
      setTimeout(() => {
        syncOfflineUpdates().then((synced) => {
          if (synced) {
            refreshContext().catch(() => {});
            if (!autoFetch && isAdmin) {
              loadProducts(0, 10, { silent: true }).catch(() => {});
            }
          }
        });
      }, 1000);
    };

    window.addEventListener("online", handleOnlineSync);
    if (navigator.onLine) {
      handleOnlineSync();
    }
    return () => {
      window.removeEventListener("online", handleOnlineSync);
    };
  }, [refreshContext, autoFetch, isAdmin, loadProducts]);

  const getProductById = useCallback(
    (id: string) => {
      return products.find((p) => p.id === id);
    },
    [products],
  );

  const addProduct = useCallback(
    async (
      productData: Omit<Product, "id" | "createdAt" | "rating" | "reviewCount">,
    ) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        // TruthGate: modo `create` exige nome, preço e estoque presentes —
        // num patch a ausência significa "não mexe", na criação significa
        // produto incompleto entrando no catálogo.
        TruthGate.verifyProductAxiom(productData, { mode: "create" });

        // As variantes são validadas ANTES do insert do produto: se uma delas
        // violar um axioma depois que o produto já entrou, sobra um produto
        // órfão sem variante nenhuma no banco.
        for (const variant of productData.variants || []) {
          TruthGate.verifyVariantAxiom(variant, {
            costPrice: productData.costPrice,
          });
        }

        const { data, error } = await supabase
          .from("vw_produtos_admin")
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
            codigo: productData.sku || null,
            sold: 0,
            peso_kg: productData.weightKg,
            largura_cm: productData.widthCm,
            altura_cm: productData.heightCm,
            comprimento_cm: productData.lengthCm,
          } as any)
          .select()
          .single();

        if (error) throw error;

        if (data) {
          const newProduct = mapProductFromDB(data);

          if (productData.variants && productData.variants.length > 0) {
            const variantsToInsert = productData.variants.map((v) => ({
              product_id: data.id as string,
              name: v.name,
              value: v.value,
              sku: v.sku || null,
              stock_increment: v.stockIncrement,
              price_override: v.priceOverride,
              active: v.active,
              image_url: v.imageUrl || null,
            }));
            const { data: insertedVariants, error: varErr } = await supabase
              .from("product_variants")
              .insert(variantsToInsert)
              .select();

            if (varErr) {
              console.error("Error adding variants on creation:", varErr);
            } else if (insertedVariants) {
              newProduct.variants = (insertedVariants as any[]).map((v) => ({
                id: v.id,
                productId: v.product_id,
                name: v.name,
                value: v.value,
                sku: v.sku || undefined,
                stockIncrement: v.stock_increment,
                priceOverride: v.price_override,
                active: v.active,
                imageUrl: v.image_url || undefined,
              }));
            }
          }

          cachedAdminProducts = [newProduct, ...(cachedAdminProducts || [])];
          cachedAdminProductsTotal += 1;
          setLocalProducts((prev) => [newProduct, ...prev]);
          clearAnalyticsCache();
          await refreshContext();
          toast.success("Produto cadastrado com sucesso!");
          return newProduct;
        }
      } catch (err: any) {
        console.error("Error adding product:", err);
        toast.error(err.message || "Erro ao cadastrar produto");
        throw err;
      }
    },
    [isAdmin, refreshContext],
  );

  const updateProduct = useCallback(
    async (id: string, updates: Partial<Product>) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }

      // Check if offline
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        let oldProduct: Product | null | undefined = products.find(
          (p) => p.id === id,
        );
        if (!oldProduct) {
          try {
            oldProduct = await fetchProduct(id);
          } catch {
            oldProduct = null;
          }
        }
        const optimisticProduct = oldProduct
          ? { ...oldProduct, ...updates }
          : null;

        // TruthGate: valida antes de enfileirar — o item da fila é escrito
        // direto em `produtos` no sync. Valida a entidade mesclada, e não o
        // patch, para que margem e estoque sejam checados contra os valores
        // reais do produto e não contra os campos ausentes do update.
        try {
          TruthGate.verifyProductAxiom(optimisticProduct ?? updates);
        } catch (err: any) {
          console.error("[useProducts] Offline validation failed:", err);
          toast.error(err.message || "Erro ao atualizar produto");
          throw err;
        }

        try {
          if (optimisticProduct) {
            cachedAdminProducts = (cachedAdminProducts || []).map((p) =>
              p.id === id ? optimisticProduct : p,
            );
            setLocalProducts((prev) =>
              prev.map((p) => (p.id === id ? optimisticProduct : p)),
            );
          }

          const queueStr =
            localStorage.getItem("products_offline_updates_queue") || "[]";
          const queue = JSON.parse(queueStr);
          const cleanQueue = queue.filter((item: any) => item.id !== id);
          const existingItem = queue.find((item: any) => item.id === id);
          const mergedUpdates = existingItem
            ? { ...existingItem.updates, ...updates }
            : updates;

          cleanQueue.push({
            id,
            updates: mergedUpdates,
            timestamp: Date.now(),
          });
          localStorage.setItem(
            "products_offline_updates_queue",
            JSON.stringify(cleanQueue),
          );

          toast.info("Alteração guardada offline.", {
            description:
              "Será sincronizada com o servidor quando reestabelecer conexão.",
          });

          return optimisticProduct;
        } catch (err) {
          console.error("[useProducts] Error queuing offline update:", err);
        }
      }

      try {
        // TruthGate: valida a entidade MESCLADA, não o patch. Validando só o
        // patch, baixar o preço abaixo do custo já gravado não gerava nem
        // aviso, porque `costPrice` não vem no update.
        const currentProduct = products.find((p) => p.id === id);
        TruthGate.verifyProductAxiom(
          currentProduct ? { ...currentProduct, ...updates } : updates,
        );

        let oldImages: string[] = [];
        if (updates.images !== undefined) {
          const oldProduct = currentProduct || (await fetchProduct(id));
          oldImages = oldProduct?.images || [];
        }

        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.nome = updates.name;
        if (updates.description !== undefined)
          dbUpdates.descricao = updates.description;
        if (updates.price !== undefined) dbUpdates.preco_venda = updates.price;
        if (updates.costPrice !== undefined)
          dbUpdates.custo = updates.costPrice;
        if (updates.originalPrice !== undefined)
          dbUpdates.preco_original = updates.originalPrice;
        if (updates.stock !== undefined) dbUpdates.estoque = updates.stock;
        if (updates.category !== undefined)
          dbUpdates.categoria = updates.category;
        if (updates.images !== undefined) {
          dbUpdates.imagem_urls = updates.images;
          dbUpdates.imagem_url = updates.images[0] || null;
        }
        if (updates.isActive !== undefined) dbUpdates.ativo = updates.isActive;
        if (updates.isBestseller !== undefined)
          dbUpdates.is_bestseller = updates.isBestseller;
        if (updates.freeShipping !== undefined)
          dbUpdates.frete_gratis = updates.freeShipping;
        if (updates.metaTitle !== undefined)
          dbUpdates.meta_title = updates.metaTitle;
        if (updates.metaDescription !== undefined)
          dbUpdates.meta_description = updates.metaDescription;
        if (updates.tags !== undefined) dbUpdates.tags = updates.tags;
        if (updates.sold !== undefined) dbUpdates.sold = updates.sold;
        if (updates.sku !== undefined) dbUpdates.codigo = updates.sku || null;
        if (updates.weightKg !== undefined)
          dbUpdates.peso_kg = updates.weightKg;
        if (updates.widthCm !== undefined)
          dbUpdates.largura_cm = updates.widthCm;
        if (updates.heightCm !== undefined)
          dbUpdates.altura_cm = updates.heightCm;
        if (updates.lengthCm !== undefined)
          dbUpdates.comprimento_cm = updates.lengthCm;

        const { data, error } = await (
          supabase.from("vw_produtos_admin") as any
        )
          .update(dbUpdates)
          .eq("id", id)
          .select(
            `
          *,
          product_variants(*)
        `,
          )
          .single();

        if (error) throw error;

        if (data) {
          const updatedProduct = mapProductFromDB(data);

          // Clean up removed images from storage
          if (updates.images !== undefined) {
            const newImages = updates.images;
            const removedImages = oldImages.filter(
              (img) => !newImages.includes(img),
            );
            for (const img of removedImages) {
              await backupStorageFile(img);
            }
          }

          cachedAdminProducts = (cachedAdminProducts || []).map((p) =>
            p.id === id ? updatedProduct : p,
          );
          setLocalProducts((prev) =>
            prev.map((p) => (p.id === id ? updatedProduct : p)),
          );
          clearAnalyticsCache();
          await refreshContext();
          toast.success("Produto atualizado!");
          return updatedProduct;
        }
      } catch (err: any) {
        console.error("Error updating product:", err);
        toast.error(err.message || "Erro ao atualizar produto");
        throw err;
      }
    },
    [isAdmin, products, refreshContext, backupStorageFile, fetchProduct],
  );

  const deleteProduct = useCallback(
    async (id: string) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      const originalProducts = [...localProducts];
      const originalCache = cachedAdminProducts
        ? [...cachedAdminProducts]
        : null;
      const originalTotal = cachedAdminProductsTotal;

      cachedAdminProducts = (cachedAdminProducts || []).filter(
        (p) => p.id !== id,
      );
      cachedAdminProductsTotal = Math.max(0, cachedAdminProductsTotal - 1);
      setLocalProducts((prev) => prev.filter((p) => p.id !== id));

      try {
        const product = originalProducts.find((p) => p.id === id);
        if (!product) {
          throw new Error("Produto não encontrado");
        }

        // Move product images to backup
        const backedUpImages: string[] = [];
        if (product.images && product.images.length > 0) {
          for (const img of product.images) {
            const newUrl = await backupStorageFile(img);
            backedUpImages.push(newUrl || img);
          }
        }

        // Move variant images to backup
        const variants = product.variants || [];
        for (const v of variants) {
          if (v.imageUrl) {
            const newUrl = await backupStorageFile(v.imageUrl);
            if (newUrl) {
              await supabase
                .from("product_variants")
                .update({ image_url: newUrl } as any)
                .eq("id", v.id);
            }
          }
        }

        const { error } = await supabase
          .from("produtos")
          .update({
            deleted_at: new Date().toISOString(),
            ativo: false,
            imagem_urls: backedUpImages,
            imagem_url: backedUpImages[0] || null,
          })
          .eq("id", id);

        if (error) throw error;

        clearAnalyticsCache();
        await refreshContext();
        toast.success("Produto removido");
        return true;
      } catch (err: any) {
        console.error("Error deleting product:", err);
        cachedAdminProducts = originalCache;
        cachedAdminProductsTotal = originalTotal;
        setLocalProducts(originalProducts);
        toast.error("Erro ao excluir produto");
        return false;
      }
    },
    [isAdmin, localProducts, backupStorageFile, refreshContext],
  );

  // Bulk Delete
  const deleteProducts = useCallback(
    async (ids: string[]) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return false;
      }
      const originalProducts = [...localProducts];
      const originalCache = cachedAdminProducts
        ? [...cachedAdminProducts]
        : null;
      const originalTotal = cachedAdminProductsTotal;

      cachedAdminProducts = (cachedAdminProducts || []).filter(
        (p) => !ids.includes(p.id),
      );
      cachedAdminProductsTotal = Math.max(
        0,
        cachedAdminProductsTotal - ids.length,
      );
      setLocalProducts((prev) => prev.filter((p) => !ids.includes(p.id)));

      try {
        for (const id of ids) {
          const product = originalProducts.find((p) => p.id === id);
          if (!product) continue;

          // Move product images to backup
          const backedUpImages: string[] = [];
          if (product.images && product.images.length > 0) {
            for (const img of product.images) {
              const newUrl = await backupStorageFile(img);
              backedUpImages.push(newUrl || img);
            }
          }

          // Move variant images to backup
          const variants = product.variants || [];
          for (const v of variants) {
            if (v.imageUrl) {
              const newUrl = await backupStorageFile(v.imageUrl);
              if (newUrl) {
                await supabase
                  .from("product_variants")
                  .update({ image_url: newUrl } as any)
                  .eq("id", v.id);
              }
            }
          }

          const { error } = await supabase
            .from("produtos")
            .update({
              deleted_at: new Date().toISOString(),
              ativo: false,
              imagem_urls: backedUpImages,
              imagem_url: backedUpImages[0] || null,
            })
            .eq("id", id);

          if (error) throw error;
        }

        await refreshContext();
        toast.success(`${ids.length} produtos removidos`);
        return true;
      } catch (err) {
        console.error("Error deleting products:", err);
        cachedAdminProducts = originalCache;
        cachedAdminProductsTotal = originalTotal;
        setLocalProducts(originalProducts);
        toast.error("Erro ao excluir produtos");
        return false;
      }
    },
    [isAdmin, localProducts, backupStorageFile, refreshContext],
  );

  // Bulk Status Update
  const updateProductsStatus = useCallback(
    async (ids: string[], isActive: boolean) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return false;
      }
      const originalProducts = [...localProducts];
      const originalCache = cachedAdminProducts
        ? [...cachedAdminProducts]
        : null;

      cachedAdminProducts = (cachedAdminProducts || []).map((p) => {
        if (ids.includes(p.id)) {
          const updated = Object.assign({}, p);
          updated.isActive = isActive;
          return updated;
        }
        return p;
      });
      setLocalProducts((prev) =>
        prev.map((p) => {
          if (ids.includes(p.id)) {
            const updated = Object.assign({}, p);
            updated.isActive = isActive;
            return updated;
          }
          return p;
        }),
      );

      try {
        const { error } = await supabase
          .from("produtos")
          .update({ ativo: isActive })
          .in("id", ids);

        if (error) throw error;

        await refreshContext();
        toast.success("Status status atualizado");
        return true;
      } catch (err) {
        console.error("Error updating products status:", err);
        cachedAdminProducts = originalCache;
        setLocalProducts(originalProducts);
        toast.error("Erro ao atualizar status");
        return false;
      }
    },
    [isAdmin, localProducts, refreshContext],
  );

  const toggleProductStatus = useCallback(
    async (id: string, currentStatus: boolean) => {
      cachedAdminProducts = (cachedAdminProducts || []).map((p) => {
        if (p.id === id) {
          const updated = Object.assign({}, p);
          updated.isActive = !currentStatus;
          return updated;
        }
        return p;
      });
      setLocalProducts((prev) =>
        prev.map((p) => {
          if (p.id === id) {
            const updated = Object.assign({}, p);
            updated.isActive = !currentStatus;
            return updated;
          }
          return p;
        }),
      );
      try {
        const result = await updateProduct(id, { isActive: !currentStatus });
        if (!result) {
          cachedAdminProducts = (cachedAdminProducts || []).map((p) => {
            if (p.id === id) {
              const updated = Object.assign({}, p);
              updated.isActive = currentStatus;
              return updated;
            }
            return p;
          });
          setLocalProducts((prev) =>
            prev.map((p) => {
              if (p.id === id) {
                const updated = Object.assign({}, p);
                updated.isActive = currentStatus;
                return updated;
              }
              return p;
            }),
          );
        }
        return result;
      } catch (err) {
        cachedAdminProducts = (cachedAdminProducts || []).map((p) => {
          if (p.id === id) {
            const updated = Object.assign({}, p);
            updated.isActive = currentStatus;
            return updated;
          }
          return p;
        });
        setLocalProducts((prev) =>
          prev.map((p) => {
            if (p.id === id) {
              const updated = Object.assign({}, p);
              updated.isActive = currentStatus;
              return updated;
            }
            return p;
          }),
        );
        throw err;
      }
    },
    [updateProduct],
  );

  const uploadProductImages = useCallback(async (files: File[]) => {
    const urls: string[] = [];

    for (const file of files) {
      try {
        const fileExt = file.name.split(".").pop();
        const fileName = `${crypto.randomUUID()}.${fileExt}`;
        const filePath = `${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from("products")
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from("products").getPublicUrl(filePath);

        urls.push(publicUrl);
      } catch (err) {
        console.error("Error uploading file:", err);
        toast.error(`Erro ao enviar imagem ${file.name}`);
      }
    }

    return urls;
  }, []);

  // Recommendations Logic - Server Side RPC
  const fetchRecommendations = useCallback(
    async (productId: string, limit = 4) => {
      try {
        const { data, error } = await (supabase.rpc as any)(
          "get_product_recommendations",
          {
            p_product_id: productId,
            p_limit: limit,
          },
        );

        if (error) throw error;

        // Map database results to application model and sort by availability
        const mapped = data
          ? (data as any[]).map((item: any) => mapProductFromDB(item))
          : [];
        return mapped.sort((a, b) => {
          const aAvailable = a.stock > 0 ? 1 : 0;
          const bAvailable = b.stock > 0 ? 1 : 0;
          return bAvailable - aAvailable;
        });
      } catch (err) {
        console.error("Error fetching recommendations:", err);
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
    },
    [products],
  );

  // Deprecated: Synchronous version for backward compatibility
  // Prioritize fetchRecommendations
  const getRecommendations = useCallback(
    (productId: string, limit = 4) => {
      const res: Product[] = [];
      for (const p of products) {
        if (p.id !== productId && p.isActive && p.stock > 0) {
          res.push(p);
          if (res.length >= limit) break;
        }
      }
      return res;
    },
    [products],
  );

  const getCartRecommendations = useCallback(
    (cartProductIds: string[], limit = 4) => {
      const res: Product[] = [];
      for (const p of products) {
        if (!cartProductIds.includes(p.id) && p.isActive && p.stock > 0) {
          res.push(p);
          if (res.length >= limit) break;
        }
      }
      return res;
    },
    [products],
  );

  const getFreeShippingEligibleProducts = useCallback(
    (cartProductIds: string[], limit = 10) => {
      const res: Product[] = [];
      for (const p of products) {
        if (!cartProductIds.includes(p.id) && p.isActive && p.stock > 0) {
          res.push(p);
          if (res.length >= limit) break;
        }
      }
      return res;
    },
    [products],
  );

  // Track Recommendation Click
  const trackRecommendationClick = useCallback(
    (_productId: string, _source: string) => {
      // Analytics ping could be restored here if needed
    },
    [],
  );

  // Variant Management
  const addVariant = useCallback(
    async (variantData: Omit<ProductVariant, "id">) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        // TruthGate: custo do pai vem do cache local, sem ida extra à rede;
        // sem ele o axioma de margem é omitido, as violações não.
        TruthGate.verifyVariantAxiom(variantData, {
          costPrice: products.find((p) => p.id === variantData.productId)
            ?.costPrice,
        });

        const { data, error } = await supabase
          .from("product_variants")
          .insert({
            product_id: variantData.productId,
            name: variantData.name,
            value: variantData.value,
            sku: variantData.sku || null,
            stock_increment: variantData.stockIncrement,
            price_override: variantData.priceOverride,
            active: variantData.active,
            image_url: variantData.imageUrl || null,
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
            sku: data.sku,
            imageUrl: (data as any).image_url,
          } as ProductVariant;

          // Update products
          await refreshContext();

          toast.success("Variante adicionada");
          return newVariant;
        }
      } catch (err) {
        console.error("Error adding variant:", err);
        toast.error("Erro ao adicionar variante");
        throw err;
      }
    },
    [isAdmin, products, refreshContext],
  );

  const updateVariant = useCallback(
    async (id: string, updates: Partial<ProductVariant>) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        // TruthGate: valida a variante MESCLADA (atual + patch), não só o
        // patch — senão estoque e override são checados contra os campos
        // ausentes do update. Pai e variante atual saem do cache local.
        const parent = products.find((p) =>
          p.variants?.some((v) => v.id === id),
        );
        TruthGate.verifyVariantAxiom(
          { ...(parent?.variants?.find((v) => v.id === id) ?? {}), ...updates },
          { costPrice: parent?.costPrice },
        );

        let oldImageUrl: string | null = null;
        if (updates.imageUrl !== undefined) {
          const { data: variant } = (await supabase
            .from("product_variants")
            .select("image_url" as any)
            .eq("id", id)
            .single()) as any;
          oldImageUrl = variant?.image_url || null;
        }

        const dbUpdates: any = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.value !== undefined) dbUpdates.value = updates.value;
        if (updates.sku !== undefined) dbUpdates.sku = updates.sku || null;
        if (updates.stockIncrement !== undefined)
          dbUpdates.stock_increment = updates.stockIncrement;
        if (updates.priceOverride !== undefined)
          dbUpdates.price_override = updates.priceOverride;
        if (updates.active !== undefined) dbUpdates.active = updates.active;
        if (updates.imageUrl !== undefined)
          dbUpdates.image_url = updates.imageUrl;

        const { data, error } = await supabase
          .from("product_variants")
          .update(dbUpdates)
          .eq("id", id)
          .select()
          .single();

        if (error) throw error;

        if (data) {
          if (
            updates.imageUrl !== undefined &&
            oldImageUrl &&
            oldImageUrl !== updates.imageUrl
          ) {
            await backupStorageFile(oldImageUrl);
          }

          // Update local state
          await refreshContext();
          toast.success("Variante atualizada");
        }
      } catch (err) {
        console.error("Error updating variant:", err);
        toast.error("Erro ao atualizar variante");
        throw err;
      }
    },
    [isAdmin, products, refreshContext, backupStorageFile],
  );

  const deleteVariant = useCallback(
    async (id: string) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return;
      }
      try {
        const { data: variant } = (await supabase
          .from("product_variants")
          .select("image_url" as any)
          .eq("id", id)
          .single()) as any;

        const { error } = await supabase
          .from("product_variants")
          .delete()
          .eq("id", id);

        if (error) throw error;

        if (variant?.image_url) {
          await backupStorageFile(variant.image_url);
        }

        await refreshContext();
        toast.success("Variante removida");
      } catch (err) {
        console.error("Error deleting variant:", err);
        toast.error("Erro ao remover variante");
        throw err;
      }
    },
    [isAdmin, refreshContext, backupStorageFile],
  );

  const deleteVariants = useCallback(
    async (ids: string[]) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return false;
      }
      try {
        const { data: variants } = (await supabase
          .from("product_variants")
          .select("image_url" as any)
          .in("id", ids)) as any;

        const { error } = await supabase
          .from("product_variants")
          .delete()
          .in("id", ids);

        if (error) throw error;

        if (variants && variants.length > 0) {
          for (const v of variants) {
            if (v.image_url) {
              await backupStorageFile(v.image_url);
            }
          }
        }

        await refreshContext();
        toast.success("Variantes removidas");
        return true;
      } catch (err) {
        console.error("Error deleting variants:", err);
        toast.error("Erro ao remover variantes");
        throw err;
      }
    },
    [isAdmin, refreshContext, backupStorageFile],
  );

  const upsertVariants = useCallback(
    async (productId: string, variants: Array<any>) => {
      if (!isAdmin) {
        toast.error("Permissão negada");
        return false;
      }
      try {
        // TruthGate: valida o lote inteiro antes de qualquer upsert, para não
        // gravar metade das variantes e abortar na outra metade.
        const parentCost = products.find((p) => p.id === productId)?.costPrice;
        for (const variant of variants) {
          TruthGate.verifyVariantAxiom(variant, { costPrice: parentCost });
        }

        const dbVariants = variants.map((v) => {
          const item: any = {
            product_id: productId,
            name: v.name,
            value: v.value,
            sku: v.sku || null,
            stock_increment: v.stockIncrement,
            price_override: v.priceOverride,
            active: v.active,
            image_url: v.imageUrl || null,
          };
          if (v.id && !v.id.startsWith("temp-")) {
            item.id = v.id;
          }
          return item;
        });

        const { error } = await supabase
          .from("product_variants")
          .upsert(dbVariants);

        if (error) throw error;

        await refreshContext();
        toast.success("Variantes salvas");
        return true;
      } catch (err) {
        console.error("Error upserting variants:", err);
        toast.error("Erro ao salvar as variantes");
        throw err;
      }
    },
    [isAdmin, products, refreshContext],
  );

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
    deleteVariants,
    upsertVariants,
    fetchProduct,
    getFreeShippingEligibleProducts,
    toggleProductStatus,
  };
}

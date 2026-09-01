import type { Product } from "@/types";
import { useEffect, useRef, useState } from "react";

// ─── Cache SWR das recomendações (migrado do ProductView) ───────────────────

const RECS_CACHE_KEY_PREFIX = "ikcous_recs_cache_";
const memoryRecsCache = new Map<string, Product[]>();

const getRecsCache = (productId: string): Product[] | null => {
  if (memoryRecsCache.has(productId)) {
    return memoryRecsCache.get(productId)!;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryRecsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse recommendations cache", e);
    }
  }
  return null;
};

const updateRecsCache = (productId: string, newRecs: Product[]) => {
  // Achado 1 da revisão da frente (prova de rua 0109): lista VAZIA não é
  // valor de cache — é o resultado que congela a seção. Gravada, ela fazia
  // a próxima visita nascer "consultado" com zero itens, a seção nem
  // renderizava, o observer ficava sem alvo e a busca nunca rodava: uma
  // loja que crescia nunca ganhava recomendações de volta. Sem cache, a
  // próxima visita re-busca e a seção se cura sozinha.
  if (newRecs.length === 0) {
    memoryRecsCache.delete(productId);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(`${RECS_CACHE_KEY_PREFIX}${productId}`);
      } catch (e) {
        console.error("Failed to clear recommendations cache", e);
      }
    }
    return;
  }
  memoryRecsCache.set(productId, newRecs);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        `${RECS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newRecs),
      );
    } catch (e) {
      console.error("Failed to update recommendations cache", e);
    }
  }
};

export interface RecomendacoesDoProduto {
  recomendacoes: Product[];
  carregando: boolean;
  /** true depois que a busca do produto concluiu (ou veio do cache) — é o
   * que deixa a página DIFERENCIAR "sem recomendações" (seção some) de
   * "ainda buscando" (skeletons). */
  consultado: boolean;
}

/**
 * Carrega as recomendações de um produto quando a seção fica visível.
 *
 * Defeito da prova de rua (01/09): o efeito que vivia no ProductView tinha
 * `fetchRecommendations` como dependência — e o buscador trocava de
 * identidade a cada troca da lista de produtos do contexto. Cada re-render
 * com lista nova re-disparava o efeito, o cleanup matava a busca anterior
 * (isMounted=false) e o cache nunca chegava a gravar: skeleton eterno na
 * "maioria dos produtos".
 *
 * O buscador vai por REF de propósito: re-render não re-dispara a busca —
 * só produto diferente ou a seção ficando visível. O resultado vazio é
 * DISTINGUÍVEL de "carregando" (`consultado`), para a página poder esconder
 * a seção em vez de exibir título com grid vazio.
 */
export function useRecomendacoesDeProduto(
  productId: string,
  visivel: boolean,
  buscar: (productId: string) => Promise<Product[]>,
): RecomendacoesDoProduto {
  // Cache vazio gravado por versões antigas NÃO é "já consultado": trata-se
  // como ausente para que a seção busque de novo (e se cure) — ver
  // updateRecsCache.
  const cachedInicial = getRecsCache(productId);
  const temCacheUtil = !!cachedInicial && cachedInicial.length > 0;
  const [recomendacoes, setRecomendacoes] = useState<Product[]>(() => {
    return temCacheUtil ? cachedInicial! : [];
  });
  const [carregando, setCarregando] = useState(!temCacheUtil);
  const [consultado, setConsultado] = useState(temCacheUtil);

  // O buscador troca de identidade a cada troca de `products` no contexto
  // (useCallback([products])) — e não é razão para re-buscar nada.
  const buscarRef = useRef(buscar);
  useEffect(() => {
    buscarRef.current = buscar;
  });

  useEffect(() => {
    if (!visivel) return;

    // 1. Initial SWR cache sync
    const cached = getRecsCache(productId);
    if (cached && cached.length > 0) {
      setRecomendacoes(cached);
      setCarregando(false);
    } else {
      setRecomendacoes([]);
      setCarregando(true);
    }

    // 2. Fetch fresh data in background
    let isMounted = true;
    const loadRecs = async () => {
      const recs = await buscarRef.current(productId);
      if (!isMounted) return;
      setRecomendacoes(recs);
      updateRecsCache(productId, recs);
      setCarregando(false);
      setConsultado(true);
    };
    loadRecs();

    return () => {
      isMounted = false;
    };
  }, [productId, visivel]);

  return { recomendacoes, carregando, consultado };
}

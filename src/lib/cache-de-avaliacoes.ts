import type { Review } from "@/types";

// Cache de avaliações por produto (mostrado antes de a rede responder). Vive
// aqui, e não dentro de `useReviews`, para o `AuthContext` poder esvaziá-lo no
// logout sem importar o hook (que importa o `useAuth`, ou seja, o próprio
// `AuthContext` — import circular).
//
// A lista pode conter avaliações ainda NÃO aprovadas, com o nome do autor
// (lojista), ou as pendentes da cliente: por isso é dado de quem estava
// logado e some no logout e na troca de conta.
export const REVIEWS_CACHE_KEY_PREFIX = "ikcous_reviews_cache_";

const memoryReviewsCache = new Map<string, Review[]>();

export const getReviewsCache = (productId: string): Review[] | null => {
  if (memoryReviewsCache.has(productId)) {
    return memoryReviewsCache.get(productId) as Review[];
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(
        `${REVIEWS_CACHE_KEY_PREFIX}${productId}`,
      );
      if (stored) {
        const parsed = JSON.parse(stored);
        memoryReviewsCache.set(productId, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Failed to parse reviews cache", e);
    }
  }
  return null;
};

export const updateReviewsCache = (productId: string, newReviews: Review[]) => {
  memoryReviewsCache.set(productId, newReviews);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(
        `${REVIEWS_CACHE_KEY_PREFIX}${productId}`,
        JSON.stringify(newReviews),
      );
    } catch (e) {
      console.error("Failed to update reviews cache", e);
    }
  }
};

/** Esvazia SÓ o mapa em memória (não depende de `window`). A varredura das
 * chaves do `localStorage` é a de `clearLocalUserData`, no `AuthContext`. */
export function esvaziarAvaliacoesEmMemoria() {
  memoryReviewsCache.clear();
}

/** Memória + chaves do `localStorage`, para a troca direta de conta
 * (uid → uid), que não passa por `clearLocalUserData`. Protegido: modo
 * privado ou política do navegador podem lançar. */
export function esquecerAvaliacoesGuardadas() {
  memoryReviewsCache.clear();
  if (typeof window === "undefined") return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(REVIEWS_CACHE_KEY_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage indisponível: nada a apagar que se possa alcançar.
  }
}

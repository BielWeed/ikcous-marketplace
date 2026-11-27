// Só da bancada da lista premium (`e2e/lista-premium.vite.config.ts`): os
// hooks que a tela de Banners lê de contexto de loja e de login, que a bancada
// não tem. O servidor da bancada troca SÓ estes nomes; o resto de cada módulo
// continua sendo o de verdade (o mesmo recorte que o
// `tests/front/banners-lista-de-escolha-do-editor.test.tsx` dubla).

const nada = async () => {};

/** Um banner no topo da home, com uma imagem que o próprio servidor serve. */
const BANNERS = [
  {
    id: "banner-bancada-1",
    imageUrl: "/og-image.png",
    title: "Coleção de verão",
    link: "",
    position: "home_top" as const,
    active: true,
    order: 1,
  },
];

export function useAuth() {
  return { user: { id: "lojista-bancada" } };
}

export function useBanners() {
  return {
    banners: BANNERS,
    isLoaded: true,
    uploadBannerImage: nada,
    addBanner: nada,
    updateBanner: nada,
    deleteBanner: nada,
    deleteStorageFile: nada,
    reorderBanners: nada,
    refreshBanners: nada,
  };
}

export function useProducts() {
  return { products: [] };
}

export function useCategories() {
  return { categories: [] };
}

export function useCoupons() {
  return {};
}

// Apesar do nome, o hook de verdade devolve "está OFFLINE": `false` = online.
export function useOnlineStatus() {
  return false;
}

export function useStore() {
  return { config: { primaryColor: "#FFBF00" } };
}

// `@/lib/env` de mentira: endereço que não responde e chave que não é chave.
// O cliente do Supabase já é o de mentira; isto só cobre quem lê o valor.
export const SUPABASE_URL = "http://127.0.0.1:9";
export const SUPABASE_PUBLISHABLE_KEY = "bancada-sem-chave";
export const SUPABASE_ANON_KEY = SUPABASE_PUBLISHABLE_KEY;

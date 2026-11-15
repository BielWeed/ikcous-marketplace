import { normalizarLayoutDeVitrine } from "../../src/lib/layout-de-ofertas";

const params = new URLSearchParams(location.search);
const layout = normalizarLayoutDeVitrine(params.get("layout"));
const semNome = params.get("semNome") === "1";
const id = params.get("id") ?? "new_arrivals";
const config = {
  enableReviews: false,
  storeName: "Loja de ensaio",
  freeShippingMin: 0,
  nationalShippingStrategy: "desligado",
  shippingCoverage: "local",
  homeSections: [
    { id, title: semNome ? "" : "Últimos Lançamentos", active: true, layout },
  ],
};
export const useStore = () => ({ config, isLoaded: true });
export const useCartContext = () => ({ cartTotal: 0 });
export const useCategories = () => ({ categories: [], isLoading: false });
export const useBanners = () => ({
  getBannersByPosition: () => [],
  isLoaded: true,
});
export const usePrefetchOnHover = () => ({
  prefetchView() {},
  prefetchImage() {},
});

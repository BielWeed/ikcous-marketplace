import type { StoreConfig } from "@/types";

// DONO ÚNICO da regra de cor da loja (defeito do b531ca9 apontado na revisão
// 20260825-1015). Vive em módulo próprio — não no StoreContext — para que
// quem precisa da regra (o efeito de --primary do StoreContext e o meta
// theme-color do App.tsx) importe sem depender do contexto, e testes que
// dublam o contexto não quebrem por causa dela (medido: mock do StoreContext
// derrubava o App quando a regra morava lá).
//
// CONTRATO: o default DE CÓDIGO (#000000) é o estado "banco ainda não disse
// nada" — inclusive quando o fetch FALHOU (isLoaded=true no finally com a
// config intacta no default). Ele nunca pode pisar a semente do build, nem no
// --primary nem no meta theme-color.
export const defaultStoreConfig: StoreConfig = {
  freeShippingMin: 350,
  shippingFee: 15,
  whatsappNumber: "34999999999",
  shareText: "Olha que achei na IKCOUS!",
  businessHours: "Seg-Sáb: 9h às 18h",
  enableReviews: true,
  enableCoupons: true,
  primaryColor: "#000000",
  themeMode: "light",
  realTimeSalesAlerts: true,
  pushMarketingEnabled: false,
  // originCep NÃO tem reserva de propósito. Ele valia "38500-000", e isso fazia
  // toda loja que nunca informou de onde despacha calcular frete a partir de
  // Monte Carmelo, calada. Sem valor = a loja não disse, e quem consome trata isso.
  shippingProvider: "flat_fee",
  enabledShippingMethods: ["sedex", "pac"],
  shippingCoverage: "national",
  localDeliveryFee: 10,
  localCepRange: "",
  homeSections: [
    { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
    { id: "offers", title: "Ofertas Imperdíveis", active: true },
    { id: "bestsellers", title: "Destaques em Alta", active: true },
  ],
};

// Devolve a cor do banco quando ela é real, senão `null` (quem consome fica
// com a semente do build). Tolerante a `config` nula: consumidor de contexto
// dublado pode entregar null, e a resposta certa continua sendo "semente".
export function corPrimariaEfetiva(config: StoreConfig | null): string | null {
  if (!config?.primaryColor) return null;
  if (config.primaryColor === defaultStoreConfig.primaryColor) return null;
  return config.primaryColor;
}

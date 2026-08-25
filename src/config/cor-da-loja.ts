import type { StoreConfig } from "@/types";

// DONO ÚNICO da regra de cor da loja (defeito do b531ca9 apontado na revisão
// 20260825-1015). Vive em módulo próprio — não no StoreContext — para que
// quem precisa da regra (o efeito de --primary do StoreContext e o meta
// theme-color do App.tsx) importe sem depender do contexto, e testes que
// dublam o contexto não quebrem por causa dela (medido: mock do StoreContext
// derrubava o App quando a regra morava lá).
//
// CONTRATO: sentinela de "sem valor" é AUSÊNCIA, nunca uma cor válida.
// `primaryColor` não tem reserva no default (mesmo tratamento do originCep):
// ausente = o banco ainda não disse nada (inclusive quando o fetch FALHOU,
// isLoaded=true no finally com a config intacta), e quem consome fica com a
// semente do build — no --primary e no meta theme-color. Um valor PRESENTE é
// sempre real, INCLUSIVE #000000: preto é escolha de marca legítima, e usar
// uma cor válida como sentinela ignorava o lojista que escolhe preto de
// propósito. Legado conhecido: linhas antigas podem ter `#000000` gravado
// pelo próprio app (o dbInsert parou de gravá-lo); esses passam a significar
// preto de verdade — o admin troca se quiser outra.
export const defaultStoreConfig: StoreConfig = {
  freeShippingMin: 350,
  shippingFee: 15,
  whatsappNumber: "34999999999",
  shareText: "Olha que achei na IKCOUS!",
  businessHours: "Seg-Sáb: 9h às 18h",
  enableReviews: true,
  enableCoupons: true,
  // primaryColor NÃO tem reserva de propósito (como o originCep abaixo).
  // Valia "#000000", e isso fazia duas coisas ruins ao mesmo tempo: o app
  // gravava preto no banco de toda loja que inicializava, calado, e a regra
  // ignorava lojista que escolhesse preto de propósito. Sem valor = a loja
  // não disse; preto = preto.
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

// Devolve a cor da loja quando ela EXISTE, senão `null` (quem consome fica
// com a semente do build). Tolerante a `config` nula: consumidor de contexto
// dublado pode entregar null, e a resposta certa continua sendo "semente".
// Único juiz de "tem cor ou não tem" — nenhum caminho aplica valor cru por
// fora daqui (quatro atalhos faziam isso; revisão 20260825, msg #25).
export function corPrimariaEfetiva(config: StoreConfig | null): string | null {
  return config?.primaryColor || null;
}

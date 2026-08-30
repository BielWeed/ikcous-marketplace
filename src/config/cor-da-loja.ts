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
// semente do build — no --primary e no meta theme-color.
//
// SOBRE #000000 — guarda temporária com condição de saída escrita (revisão
// 20260825-1305 + migration 20260980000000): enquanto NÃO existir tela de
// escrever cor no app, um `#000000` no banco só pode ser (a) resíduo da
// fábrica antiga (DEFAULT da coluna + COALESCE da RPC, que a migration
// desliga e limpa) num banco onde ela ainda não rodou, ou (b) escrita
// manual no editor SQL. Nenhum dos dois é escolha de marca — nenhum lojista
// consegue escolher preto pelo app hoje. A janela entre código novo
// deployado e migration aplicada ao banco deixaria a fábrica viva mostrando
// preto como marca; esta guarda fecha a janela no lado do app.
// **SAÍDA DA GUARDA:** no dia em que a tela de escrever cor existir (pedido
// 004, item de escrita), esta comparação sai — e #000000 passa a significar
// preto escolhido, porque alguém poderá tê-lo escolhido.
export const defaultStoreConfig: StoreConfig = {
  freeShippingMin: 350,
  shippingFee: 15,
  whatsappNumber: "34999999999",
  shareText: "Olha que achei na IKCOUS!",
  // businessHours NÃO tem reserva de propósito (mesmo molde da sentinela de
  // cor da linha de baixo, e do originCep). Valia "Seg-Sáb: 9h às 18h", e
  // isso fazia a vitrine publicar um expediente que ninguém digitou (item 6
  // do laudo de 29/08 + migration 20261029000000, que matou o default no
  // banco). Sem valor = a loja não disse.
  businessHours: "",
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
  if (!config?.primaryColor) return null;
  if (config.primaryColor === "#000000") return null;
  // Guarda temporária — ver bloco "SOBRE #000000" acima para a condição
  // de saída. Enquanto não existe tela de escrever cor, preto no banco é
  // resíduo de fábrica ou escrita manual: mostra a semente do build.
  return config.primaryColor;
}

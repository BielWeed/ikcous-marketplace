// Caça por mutação em `defaultStoreConfig` (`src/config/cor-da-loja.ts`),
// 25/11/2026. O padrão da loja é o estado inicial do app, a semente do cache do
// cofre e o que a leitura do banco compara para saber se "a config mudou" — e
// só `businessHours` tinha teste. Trocar o frete grátis de 350 para 351, o tema
// de claro para escuro, o texto de compartilhar ou desligar as avaliações
// passava em todos os testes.
//
// Os valores abaixo são ESCRITOS À MÃO, iguais aos defaults das colunas do
// banco (`store_config`) e ao que a loja nova mostra antes de a lojista
// configurar. Se o dono mudar um padrão DE PROPÓSITO, a mudança é feita aqui
// junto com a migration da coluna — este arquivo é o lugar onde as duas pontas
// são conferidas.
//
// `toStrictEqual` de propósito: uma chave a MAIS (um `primaryColor` ou um
// `originCep` reintroduzido como reserva de fábrica) reprova, e uma chave
// `undefined` não passa por ausente.
import { defaultStoreConfig } from "@/config/cor-da-loja";
import { describe, expect, it } from "vitest";

describe("defaultStoreConfig — os padrões de fábrica, um por um", () => {
  it("é exatamente este conjunto de valores", () => {
    expect(defaultStoreConfig).toStrictEqual({
      freeShippingMin: 350,
      freeShippingCardStyle: "completo",
      shippingFee: 15,
      whatsappNumber: "",
      shareText: "Olha que achei!",
      businessHours: "",
      enableReviews: true,
      enableCoupons: true,
      themeMode: "light",
      realTimeSalesAlerts: true,
      pushMarketingEnabled: false,
      shippingProvider: "flat_fee",
      enabledShippingMethods: ["sedex", "pac"],
      shippingCoverage: "national",
      localDeliveryFee: 10,
      localDeliveryEnabled: true,
      localDeliveryDays: 1,
      localCepRange: "",
      nationalShippingStrategy: "desligado",
      nationalShippingMin: 0,
      nationalDiscountType: null,
      nationalDiscountValue: 0,
      nationalBenefitScope: "mais_barata",
      homeSections: [
        { id: "new_arrivals", title: "Últimos Lançamentos", active: true },
        { id: "offers", title: "Ofertas Imperdíveis", active: true },
        { id: "bestsellers", title: "Destaques em Alta", active: true },
      ],
      formasPagamentoEntrega: ["pix", "card", "cash"],
    });
  });

  it("não traz reserva de cor da marca nem de CEP de origem: sem valor = a loja não disse", () => {
    expect("primaryColor" in defaultStoreConfig).toBe(false);
    expect("originCep" in defaultStoreConfig).toBe(false);
  });

  it("as três seções da vitrine nascem na ordem lançamentos, ofertas, destaques, todas ligadas", () => {
    const secoes = defaultStoreConfig.homeSections ?? [];
    expect(secoes.map((s) => s.id)).toEqual([
      "new_arrivals",
      "offers",
      "bestsellers",
    ]);
    expect(secoes.every((s) => s.active)).toBe(true);
  });
});

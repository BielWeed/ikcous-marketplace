import { modoDeEconomiaDoFrete } from "@/lib/economia-do-frete";
import {
  FRETE_GRATIS_POR_PRODUTO,
  FRETE_GRATIS_SEMPRE,
} from "@/lib/presets-de-frete-gratis";
import { describe, expect, it } from "vitest";

// Base "boa" (linha 6 da tabela: fora da cidade, logado, preset "sempre") —
// cada teste desvia SÓ o campo que a linha da tabela pede, para provar que
// aquele campo sozinho decide (mesmo padrão de finalizar-bloqueado-por-frete.test.ts).
function base(): Parameters<typeof modoDeEconomiaDoFrete>[0] {
  return {
    freteGratis: true,
    cepDeEntrega: "01310100", // Av. Paulista — fora da cidade da loja (origem abaixo)
    temUsuario: true,
    originCep: "38500000",
    localCepRange: undefined,
    localDeliveryFee: 12.9,
    freeShippingMin: FRETE_GRATIS_SEMPRE,
  };
}

describe("linha 0: transportadora escolhida não pede outra cotação", () => {
  it.each([
    [35.9, 20, 15.9],
    [0.3, 0.1, 0.2],
  ])(
    "preço cheio R$ %s e cobrado R$ %s preservam R$ %s de economia com centavos",
    (precoCheio, price, esperado) => {
      const modo = modoDeEconomiaDoFrete({
        ...base(),
        opcaoSelecionada: { id: "melhorenvio-pac", price, precoCheio },
      });
      expect(modo.tipo).toBe("opcao");
      if (modo.tipo !== "opcao") throw new Error("economia nacional ausente");
      expect(modo.valor).toBeCloseTo(esperado, 2);
    },
  );

  it.each([
    { price: 0, esperado: { tipo: "zero" } },
    { price: 0, precoCheio: 0, esperado: { tipo: "zero" } },
    { price: 20, precoCheio: 20, esperado: { tipo: "zero" } },
    { price: 20, precoCheio: 15, esperado: { tipo: "zero" } },
    { price: 20, precoCheio: 35, esperado: { tipo: "opcao", valor: 15 } },
  ])(
    "price=$price, precoCheio=$precoCheio",
    ({ price, precoCheio, esperado }) => {
      expect(
        modoDeEconomiaDoFrete({
          ...base(),
          opcaoSelecionada: { id: "melhorenvio-pac", price, precoCheio },
        }),
      ).toEqual(esperado);
    },
  );
});

describe("retirada na loja escolhida: não existe frete a economizar, nunca cota", () => {
  // Loja "Só retiro" aceita a retirada para QUALQUER CEP (CartContext já diz
  // freteGratis=true com preço 0). Sem esta linha, a cliente logada de outra
  // cidade caía na linha 6 e disparava uma cotação real que o checkout
  // descartava (gasta cota do lojista e suja o Histórico de Cotações).
  it("fora da cidade, logada, preset sempre -> zero (nunca cotar)", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      opcaoSelecionada: { id: "store-pickup", price: 0 },
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("fora da cidade, logada, preset acima_de_valor -> zero (nunca cotar)", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      freeShippingMin: 100,
      opcaoSelecionada: { id: "store-pickup", price: 0 },
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("CEP local -> zero, nunca a taxa da entrega local (retirada não paga entrega)", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      cepDeEntrega: "38500000",
      opcaoSelecionada: { id: "store-pickup", price: 0 },
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("controle: entrega local escolhida em CEP local segue valendo a taxa", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      cepDeEntrega: "38500000",
      opcaoSelecionada: { id: "local-delivery", price: 0 },
    });
    expect(modo).toEqual({ tipo: "local", valor: 12.9 });
  });
});

describe("modoDeEconomiaDoFrete — tabela decidida com o critico de desenho (12/09/2026)", () => {
  it("linha 1: freteGratis falso -> zero, mesmo com CEP local e tudo mais favoravel", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      freteGratis: false,
      cepDeEntrega: "38500000",
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 2: CEP de entrega incompleto (< 8 digitos) -> zero", () => {
    const modo = modoDeEconomiaDoFrete({ ...base(), cepDeEntrega: "0131010" });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 2: CEP de entrega nulo -> zero", () => {
    const modo = modoDeEconomiaDoFrete({ ...base(), cepDeEntrega: null });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 3: CEP local -> economia = config.localDeliveryFee, SEM chamada de rede (a decisao nao cota)", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      cepDeEntrega: "38500-000",
    });
    expect(modo).toEqual({ tipo: "local", valor: 12.9 });
  });

  it("linha 3: CEP local vale para TODOS os presets — aqui com por_produto, mesmo resultado do preset sempre", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      cepDeEntrega: "38500-000",
      freeShippingMin: FRETE_GRATIS_POR_PRODUTO,
    });
    expect(modo).toEqual({ tipo: "local", valor: 12.9 });
  });

  it("CEP local sem localDeliveryFee configurado (ausente/nulo) -> zero, NUNCA um default inventado", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      cepDeEntrega: "38500-000",
      localDeliveryFee: undefined,
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 4: convidado (sem usuario) fora da cidade -> zero", () => {
    const modo = modoDeEconomiaDoFrete({ ...base(), temUsuario: false });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 5: fora da cidade, preset por_produto -> zero, mesmo logado", () => {
    const modo = modoDeEconomiaDoFrete({
      ...base(),
      freeShippingMin: FRETE_GRATIS_POR_PRODUTO,
    });
    expect(modo).toEqual({ tipo: "zero" });
  });

  it("linha 6: fora da cidade, logado, preset sempre -> cotar", () => {
    const modo = modoDeEconomiaDoFrete(base());
    expect(modo).toEqual({ tipo: "cotar" });
  });

  it("linha 6: fora da cidade, logado, preset acima_de_valor -> cotar", () => {
    const modo = modoDeEconomiaDoFrete({ ...base(), freeShippingMin: 100 });
    expect(modo).toEqual({ tipo: "cotar" });
  });

  it("sem originCep configurado, destino nunca e' 'local' (mesma trava de cepEhLocal) -> segue para a regra de fora da cidade", () => {
    const modo = modoDeEconomiaDoFrete({ ...base(), originCep: undefined });
    expect(modo).toEqual({ tipo: "cotar" });
  });
});

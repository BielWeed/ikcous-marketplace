// Rodada 5, achado 10: a nota "Frete Escolhido: <nome> (Prazo: <prazo>)" vai
// para as "Observações do pedido" da ficha, CRUA. Ela gravava `${dias} dias`:
// a entrega local de 1 dia (padrão da loja) saía "Prazo: 1 dias", e a
// transportadora saía sem o "úteis" que o carrinho já dizia. Agora a nota
// segue a mesma regra do `prazoDaOpcao` do carrinho: plural certo, "úteis"
// só para transportadora (o prazo da entrega própria é digitado em "dias").
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import { ID_RETIRADA_NA_LOJA } from "@/lib/guarda-de-frete";
import { notaDoFreteEscolhido } from "@/views/customer/CheckoutView";
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const local = (deliveryDays: number) =>
  notaDoFreteEscolhido({
    id: "local-delivery",
    name: "Entrega Local",
    deliveryDays,
    provider: "local",
  });

const transportadora = (deliveryDays: number) =>
  notaDoFreteEscolhido({
    id: "melhorenvio-pac",
    name: "PAC",
    deliveryDays,
    provider: "melhor_envio",
  });

describe("notaDoFreteEscolhido — prazo no singular e 'úteis' só de transportadora", () => {
  it("entrega local de 1 dia grava '1 dia', não '1 dias'", () => {
    expect(local(1)).toBe("Frete Escolhido: Entrega Local (Prazo: 1 dia)");
  });

  it("entrega local de vários dias grava 'dias' (sem 'úteis')", () => {
    expect(local(2)).toBe("Frete Escolhido: Entrega Local (Prazo: 2 dias)");
  });

  it("transportadora de 1 dia grava '1 dia útil'", () => {
    expect(transportadora(1)).toBe("Frete Escolhido: PAC (Prazo: 1 dia útil)");
  });

  it("transportadora de vários dias grava 'dias úteis'", () => {
    expect(transportadora(5)).toBe(
      "Frete Escolhido: PAC (Prazo: 5 dias úteis)",
    );
  });

  it("a ficha ainda reconhece a forma de entrega nas três grafias", () => {
    expect(formaDeEntregaDaNota(local(1))).toEqual({
      nome: "Entrega Local",
      prazo: "1 dia",
    });
    expect(formaDeEntregaDaNota(transportadora(1))).toEqual({
      nome: "PAC",
      prazo: "1 dia útil",
    });
    expect(formaDeEntregaDaNota(transportadora(5))).toEqual({
      nome: "PAC",
      prazo: "5 dias úteis",
    });
  });

  it("controle: prazo 0, frete grátis e retirada seguem como antes", () => {
    expect(local(0)).toBe(
      "Frete Escolhido: Entrega Local (Prazo: no mesmo dia)",
    );
    expect(
      notaDoFreteEscolhido({
        id: "free-shipping-promo",
        name: "Frete Grátis (Promoção)",
        deliveryDays: 3,
        provider: "free",
      }),
    ).toBe("Frete Escolhido: Frete Grátis (Promoção) (Prazo: não calculado)");
    expect(
      notaDoFreteEscolhido({
        id: ID_RETIRADA_NA_LOJA,
        name: "Retirada",
        deliveryDays: 0,
        provider: "local",
        pickupAddress: "Rua A, 1",
      }),
    ).toMatch(/^Retirada na loja/);
  });
});

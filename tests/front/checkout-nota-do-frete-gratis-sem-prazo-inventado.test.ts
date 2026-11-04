// A nota do pedido não inventa prazo para o frete grátis por produto.
//
// A edge devolve `free-shipping-promo` (provider "free") com `deliveryDays: 3`
// FIXO, sem transportadora cotada. A tela do carrinho esconde esse prazo
// (shipping-calculator-frete-gratis-promo-sem-prazo-inventado.test.tsx), mas a
// nota gravada no pedido escrevia "(Prazo: 3 dias)" e a lojista lia isso na
// ficha ("Como vai: Frete Grátis (Promoção) · 3 dias"). A frase continua com o
// parêntese "(Prazo: ...)" porque `formaDeEntregaDaNota` e a elegibilidade da
// etiqueta só reconhecem a nota com ele.
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import { notaDoFreteEscolhido } from "@/views/customer/CheckoutView";
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar
// (sem `.env` no CI o import explodia) — mesmo padrão de
// checkout-oferece-saida-na-recusa.test.tsx. Só a função pura roda aqui.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("notaDoFreteEscolhido e o prazo do frete grátis por produto", () => {
  it("free-shipping-promo não grava '3 dias' — o prazo não foi calculado por ninguém", () => {
    const nota = notaDoFreteEscolhido({
      id: "free-shipping-promo",
      name: "Frete Grátis (Promoção)",
      deliveryDays: 3,
      provider: "free",
    });

    expect(nota).toBe(
      "Frete Escolhido: Frete Grátis (Promoção) (Prazo: não calculado)",
    );
    expect(nota).not.toContain("3 dias");
    // A ficha do pedido continua achando a forma de entrega.
    expect(formaDeEntregaDaNota(nota)).toEqual({
      nome: "Frete Grátis (Promoção)",
      prazo: "não calculado",
    });
  });

  it("qualquer opção do provedor 'free' segue a mesma regra", () => {
    expect(
      notaDoFreteEscolhido({
        id: "outro-id",
        name: "Frete grátis",
        deliveryDays: 5,
        provider: "free",
      }),
    ).toBe("Frete Escolhido: Frete grátis (Prazo: não calculado)");
  });

  it("transportadora de verdade mantém o prazo cotado e prazo 0 segue 'no mesmo dia'", () => {
    expect(
      notaDoFreteEscolhido({
        id: "melhorenvio-pac",
        name: "PAC",
        deliveryDays: 3,
        provider: "melhor_envio",
      }),
    ).toBe("Frete Escolhido: PAC (Prazo: 3 dias úteis)");
    expect(
      notaDoFreteEscolhido({
        id: "local-delivery",
        name: "Entrega Local",
        deliveryDays: 0,
        provider: "local",
      }),
    ).toBe("Frete Escolhido: Entrega Local (Prazo: no mesmo dia)");
  });
});

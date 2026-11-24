// A nota do pedido não inventa prazo para o frete grátis por produto, e o
// código reconhece essa opção por DOIS sinais independentes: o provedor "free"
// OU o id "free-shipping-promo". O teste vizinho
// (checkout-nota-do-frete-gratis-sem-prazo-inventado) prova o primeiro sinal
// sozinho e os dois juntos; este prova o segundo sozinho — cotação em cache
// de uma versão antiga pode trazer o id da promoção com outro provedor, e
// aí a ficha da lojista leria "Prazo: 3 dias" que ninguém calculou.
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import { notaDoFreteEscolhido } from "@/views/customer/CheckoutView";
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

describe("notaDoFreteEscolhido — a promoção é reconhecida só pelo id", () => {
  it.each(["melhor_envio", "local", ""])(
    "id 'free-shipping-promo' com provedor %j não grava o prazo fixo de 3 dias",
    (provider) => {
      const nota = notaDoFreteEscolhido({
        id: "free-shipping-promo",
        name: "Frete Grátis (Promoção)",
        deliveryDays: 3,
        provider,
      });

      expect(nota).toBe(
        "Frete Escolhido: Frete Grátis (Promoção) (Prazo: não calculado)",
      );
      expect(formaDeEntregaDaNota(nota)?.prazo).toBe("não calculado");
    },
  );

  it("controle: outro id com o mesmo provedor segue gravando o prazo cotado", () => {
    expect(
      notaDoFreteEscolhido({
        id: "melhorenvio-pac",
        name: "PAC",
        deliveryDays: 3,
        provider: "melhor_envio",
      }),
    ).toBe("Frete Escolhido: PAC (Prazo: 3 dias úteis)");
  });
});

// A nota "Frete Escolhido: ..." do pedido quando NÃO há opção de frete
// escolhida (`notaDoFreteEscolhido`, em `src/views/customer/CheckoutView.tsx`).
// Achado por mutação: tirar o `if (!option) return undefined` não derrubava
// teste nenhum — e o primeiro acesso a `option.id` LANÇARIA um erro dentro do
// envio do pedido, em vez de simplesmente seguir sem nota (compra sem frete
// escolhido, ou o carrinho ainda calculando).
import { describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { notaDoFreteEscolhido } from "@/views/customer/CheckoutView";

describe("notaDoFreteEscolhido — sem opção escolhida", () => {
  it("opção nula não lança e não escreve nota nenhuma", () => {
    expect(() => notaDoFreteEscolhido(null)).not.toThrow();
    expect(notaDoFreteEscolhido(null)).toBeUndefined();
  });

  it("controle: com uma opção de transportadora a nota existe, com o nome e o prazo", () => {
    expect(
      notaDoFreteEscolhido({
        id: "melhorenvio-pac",
        name: "PAC",
        deliveryDays: 5,
        provider: "melhor_envio",
      }),
    ).toBe("Frete Escolhido: PAC (Prazo: 5 dias úteis)");
  });
});

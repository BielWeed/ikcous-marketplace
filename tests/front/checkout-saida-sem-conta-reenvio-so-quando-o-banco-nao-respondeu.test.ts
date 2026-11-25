// @vitest-environment jsdom
//
// A saída do checkout para quem compra SEM CONTA (`decidirSaidaDoCheckout`, em
// `src/views/customer/CheckoutView.tsx`): reenviar a MESMA compra só é seguro —
// e só faz sentido — quando o banco NÃO respondeu. Se o Postgres respondeu com
// texto (P0001 + mensagem), o pedido definitivamente não nasceu e reenviar o
// mesmo corpo só repetiria a recusa. Bordas achadas por mutação, que os testes
// de tela não derrubavam:
//
//  1. P0001 com texto que nenhuma regra conhece, convidada: segue a saída do
//     banco (`conferir_antes` com o texto dele) — não vira reenvio;
//  2. P0001 SEM texto, convidada e sem rede: o banco não provou nada, então é
//     reenvio (e a frase promete "não sai em dobro");
//  3. o reenvio da convidada é um resultado INCERTO (o pedido pode ter chegado):
//     `resultado: "incerto"` é o que impede a tela de afirmar "não foi feito".
import { afterEach, describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase`, que valida variável de ambiente ao carregar.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { decidirSaidaDoCheckout } from "@/views/customer/CheckoutView";

const ONLINE_ORIGINAL = Object.getOwnPropertyDescriptor(
  globalThis.navigator,
  "onLine",
);

function definirOnLine(valor: boolean): void {
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: valor,
    configurable: true,
  });
}

afterEach(() => {
  if (ONLINE_ORIGINAL) {
    Object.defineProperty(globalThis.navigator, "onLine", ONLINE_ORIGINAL);
  } else {
    Reflect.deleteProperty(globalThis.navigator, "onLine");
  }
});

describe("decidirSaidaDoCheckout — convidada: o banco respondeu ou não?", () => {
  it("P0001 com texto desconhecido: a saída é a do banco (conferir antes, com o texto dele), nunca o reenvio", () => {
    const texto = "Uma recusa que nenhuma regra do front conhece.";
    const saida = decidirSaidaDoCheckout(
      { code: "P0001", message: texto },
      { semConta: true },
    );
    expect(saida.acao).toBe("conferir_antes");
    expect(saida.mensagem).toBe(texto);
  });

  it("controle: a mesma recusa para quem TEM conta também segue a do banco", () => {
    const texto = "Uma recusa que nenhuma regra do front conhece.";
    const saida = decidirSaidaDoCheckout({ code: "P0001", message: texto });
    expect(saida.acao).toBe("conferir_antes");
    expect(saida.mensagem).toBe(texto);
  });

  it("P0001 SEM texto e sem rede: o banco não provou nada — convidada reenvia a mesma compra", () => {
    definirOnLine(false);
    for (const message of ["", undefined]) {
      const saida = decidirSaidaDoCheckout(
        { code: "P0001", message },
        { semConta: true },
      );
      expect(saida.acao).toBe("reenviar_mesma_compra");
      expect(saida.mensagem).toContain("não sai em dobro");
    }
  });

  it("falha de rede da convidada: o reenvio é resultado INCERTO (o pedido pode ter chegado)", () => {
    const saida = decidirSaidaDoCheckout(
      { code: "", message: "TypeError: Failed to fetch" },
      { semConta: true },
    );
    expect(saida.acao).toBe("reenviar_mesma_compra");
    expect(saida.resultado).toBe("incerto");
  });
});

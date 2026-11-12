// @vitest-environment jsdom
//
// A cotação recebe os cabeçalhos de um erro HTTP da edge, mas o CORPO fica
// pendurado na rede. O `catch` aguarda o código do erro (lê o corpo) e, sem
// prazo, o `finally` nunca rodava: o frete ficava em "cotando" para sempre e a
// cliente não fechava o pedido. É uma espera POSTERIOR à chamada, distinta do
// prazo da cotação (`shipping-calculator-rede-lenta-ainda-cota`).
//
// Modelo estrutural: shipping-calculator-erro-traduzido-nao-mostra-texto-cru.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DE_LER_O_CORPO_DO_ERRO_MS } from "@/lib/prazo-da-requisicao";
import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
// `useOnlineStatus()` devolve "está OFFLINE": false = com rede.
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE_GENERICA =
  "Não foi possível calcular o frete agora. Tente novamente em instantes.";

/** Cabeçalhos chegam (status 500); o corpo nunca enfileira nem fecha. */
function respostaComCorpoPendurado(): Response {
  return new Response(
    new ReadableStream({
      start() {
        // pendurado de propósito
      },
    }),
    { status: 500 },
  );
}

function erroHttp(context: Response) {
  return {
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context,
  };
}

describe("ShippingCalculator — corpo do erro HTTP que nunca termina", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let status: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    invoke.mockReset();
    status = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function montarECotar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino="69000000"
          onStatusChange={(s) => status.push(s)}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("corpo pendurado: sai de 'cotando' no prazo e mostra o erro genérico", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(respostaComCorpoPendurado()),
    });

    await montarECotar();
    // Dentro do prazo: ainda aguardando o corpo, nada de erro na tela.
    await avancar(PRAZO_DE_LER_O_CORPO_DO_ERRO_MS - 1);
    expect(status.at(-1)).toBe("cotando");
    expect(hospedeiro.textContent).not.toContain(FRASE_GENERICA);

    await avancar(1);
    expect(status.at(-1)).toBe("erro");
    expect(hospedeiro.textContent).toContain(FRASE_GENERICA);
    expect(hospedeiro.textContent).not.toContain("non-2xx");
  });

  it("controle: corpo normal com código conhecido continua mostrando a frase específica", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(
        new Response(JSON.stringify({ codigo: "muitas_consultas" }), {
          status: 429,
        }),
      ),
    });

    await montarECotar();

    expect(status.at(-1)).toBe("erro");
    expect(hospedeiro.textContent).toContain(
      "Muitas consultas de frete em pouco tempo. Aguarde alguns minutos e tente de novo.",
    );
    expect(hospedeiro.textContent).not.toContain(FRASE_GENERICA);
  });

  it("controle: corpo com JSON inválido continua mostrando o erro genérico", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(new Response("isto não é json", { status: 500 })),
    });

    await montarECotar();

    expect(status.at(-1)).toBe("erro");
    expect(hospedeiro.textContent).toContain(FRASE_GENERICA);
  });
});

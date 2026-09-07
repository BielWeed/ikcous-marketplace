// @vitest-environment jsdom
//
// Laudo de acessibilidade 05/09 — onda 1, itens do FRETE (A1 ALTA, M1, M2),
// provados no DOM de verdade (o contrato de fonte vive em
// acess-onda1-0509-contrato.test.tsx; aqui o que se prova é o que o leitor
// de tela efetivamente recebe):
//
//   A1 — escolher PAC/SEDEX não era anunciado: o "selecionado" era só
//        borda/fundo colorido. Agora a opção carrega `aria-pressed` — quem
//        não vê SABE qual frete vai pagar antes de confirmar.
//   M1 — CEP inválido aparecia em pixels, em silêncio. Agora `role="alert"`.
//   M2 — o campo de CEP se explicava só pelo placeholder "00000-000", que
//        some ao digitar. Agora tem `aria-label`.
//
// Mesmo molde de shipping-calculator-sem-preco-inventado.test.tsx (mocks
// secos; jsdom sem localStorage utilizável → dublê em Map).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

// FRETE V2: a regra de grátis tem fonte única no CartContext — mock seco,
// nenhum cenário aqui é grátis.
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
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

describe("ShippingCalculator — frete falado (laudo 05/09: A1, M1, M2)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montar(selectedOption: ShippingOption | null = null) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={selectedOption}
          onSelectOption={() => {}}
        />,
      );
    });
    return hospedeiro;
  }

  async function digitarECotar(cepDigitado: string) {
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, cepDigitado);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    // Um microtask a mais para o setState do catch/then pintar no DOM.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("M2 — o campo de CEP tem nome próprio, não só placeholder", async () => {
    await montar();
    const campo = hospedeiro.querySelector(
      "input#shipping-calculator-cep",
    ) as HTMLInputElement;
    expect(campo.getAttribute("aria-label")).toBe("CEP de destino");
  });

  it("M1 — CEP inválido: erro na tela com role=alert (falado na hora)", async () => {
    await montar();
    await digitarECotar("6900");

    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta).not.toBeNull();
    expect(alerta?.textContent ?? "").toContain("CEP deve conter 8 dígitos");
  });

  it("A1 — opção selecionada carrega aria-pressed=true; a outra, false", async () => {
    // O componente é CONTROLADO: quem guarda a seleção é o pai (CartView).
    // Captura-se a auto-seleção e re-renderiza com ela — o mesmo ciclo que
    // acontece na loja de verdade. (Holder de objeto: o estreitamento de
    // fluxo do TS não atravessa closures de `let`.)
    const selecao: { atual: ShippingOption | null } = { atual: null };
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    const montarCom = (sel: ShippingOption | null) => {
      act(() => {
        raiz.render(
          <ShippingCalculator
            cart={carrinho}
            selectedOption={sel}
            onSelectOption={(opt) => {
              selecao.atual = opt;
            }}
          />,
        );
      });
    };

    montarCom(null);
    invoke.mockResolvedValue({
      data: {
        options: [
          {
            id: "melhorenvio-pac",
            name: "PAC",
            price: 41.9,
            deliveryDays: 7,
            provider: "melhor_envio",
          },
          {
            id: "melhorenvio-sedex",
            name: "SEDEX",
            price: 62.0,
            deliveryDays: 2,
            provider: "melhor_envio",
          },
        ],
      },
      error: null,
    });

    await digitarECotar("69000000");

    // A auto-seleção pega a mais BARATA (PAC); o pai a guarda e devolve
    // como prop — é esse ciclo que faz o botão anunciar o estado.
    expect(selecao.atual?.id).toBe("melhorenvio-pac");
    montarCom(selecao.atual);

    const botoesOpcao = Array.from(
      hospedeiro.querySelectorAll("button[type='button']"),
    );
    expect(
      botoesOpcao.length,
      "as duas opções de frete deveriam estar no DOM",
    ).toBeGreaterThanOrEqual(2);

    const pac = botoesOpcao.find((b) => b.textContent?.includes("PAC"));
    const sedex = botoesOpcao.find((b) => b.textContent?.includes("SEDEX"));
    expect(pac?.getAttribute("aria-pressed")).toBe("true");
    expect(sedex?.getAttribute("aria-pressed")).toBe("false");
  });
});

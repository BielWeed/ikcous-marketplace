// @vitest-environment jsdom
// O código conhecido escolhe a frase local; texto arbitrário do servidor não vira aviso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
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

function erroHttp(context: Response) {
  return {
    data: null,
    error: {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context,
    },
  };
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — CEP inexistente tem aviso específico", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSelectOption = vi.fn();

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
    vi.spyOn(console, "error").mockImplementation(() => {});
    invoke.mockReset();
    onSelectOption.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function montar(cart = carrinho) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={cart}
          selectedOption={null}
          onSelectOption={onSelectOption}
        />,
      );
    });
  }

  async function cotar() {
    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "19999999");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("400 cep_invalido mostra a frase local e limpa a opção selecionada", async () => {
    invoke.mockResolvedValue(
      erroHttp(
        new Response(
          JSON.stringify({
            error: "texto técnico proibido",
            codigo: "cep_invalido",
          }),
          { status: 400 },
        ),
      ),
    );
    await montar();
    await cotar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "CEP não encontrado. Confira o número e tente de novo.",
    );
    expect(hospedeiro.textContent).not.toContain("texto técnico proibido");
    expect(onSelectOption).toHaveBeenCalledWith(null);
    expect(onSelectOption.mock.calls).toEqual([[null]]);
  });

  it.each([
    [
      "503 sem código",
      JSON.stringify({ error: "texto técnico proibido" }),
      503,
    ],
    ["JSON inválido", "corpo inválido", 400],
    [
      "código desconhecido",
      JSON.stringify({ codigo: "outro", error: "texto técnico proibido" }),
      400,
    ],
  ])(
    "%s mantém a frase genérica sem rejeição não tratada",
    async (_caso, corpo, status) => {
      invoke.mockResolvedValue(erroHttp(new Response(corpo, { status })));
      await montar();
      await cotar();

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        "Não foi possível calcular o frete agora. Tente novamente em instantes.",
      );
      expect(hospedeiro.textContent).not.toContain("texto técnico proibido");
      expect(onSelectOption.mock.calls).toEqual([[null]]);
    },
  );

  it("ler JSON antigo depois da cotação nova não apaga o preço atual", async () => {
    vi.useFakeTimers();
    let concluirLeitura!: (corpo: unknown) => void;
    const leituraPendente = new Promise((resolve) => {
      concluirLeitura = resolve;
    });
    const resposta = new Response(null, { status: 400 });
    const copia = new Response(null, { status: 400 });
    vi.spyOn(resposta, "clone").mockReturnValue(copia);
    vi.spyOn(copia, "json").mockReturnValue(leituraPendente);
    invoke.mockResolvedValueOnce(erroHttp(resposta));
    await montar();
    await cotar();

    const opcaoAtual = { id: "pac", name: "PAC", price: 30, deliveryDays: 7 };
    invoke.mockResolvedValueOnce({
      data: { options: [opcaoAtual] },
      error: null,
    });
    await montar([{ ...carrinho[0], quantity: 2 }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(hospedeiro.textContent).toContain("30,00");
    onSelectOption.mockClear();

    await act(async () => {
      concluirLeitura({ codigo: "cep_invalido" });
    });

    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("30,00");
    expect(onSelectOption).not.toHaveBeenCalled();
  });
});

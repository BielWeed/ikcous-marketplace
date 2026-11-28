// @vitest-environment jsdom
// Loja nova sem CEP de origem: a edge responde 409 `loja_sem_cep_de_origem`.
// Antes (até 27/11/2026) era 500 genérico e a calculadora mostrava "Tente
// novamente" com o botão "Tentar de novo", que repetia a mesma recusa para
// sempre. Agora: a MESMA frase do topo do checkout (com ou sem contato da loja),
// definitiva — sem botão e sem nova chamada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mensagemAmigavelErroEdgeFunction } from "@/lib/mensagens-erro";
import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
const lojaAtual: { config: Record<string, unknown> } = { config: {} };
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: lojaAtual.config, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const FRASE_COM_CONTATO =
  "Esta loja ainda não calcula o frete pelo app. Fale com a loja.";
const FRASE_SEM_CONTATO =
  "Esta loja ainda não calcula o frete pelo app e não cadastrou um contato aqui. Procure a loja pelos canais em que você a conheceu.";
const FRASE_GENERICA =
  "Não foi possível calcular o frete agora. Tente novamente em instantes.";

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
    name: "FunctionsHttpError",
    message: "Edge Function returned a non-2xx status code",
    context,
  };
}

const respostaDaLojaSemCep = () =>
  new Response(
    JSON.stringify({
      error: "A loja ainda não configurou o CEP de origem do frete.",
      codigo: "loja_sem_cep_de_origem",
    }),
    { status: 409 },
  );

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — loja sem CEP de origem diz o motivo e não oferece 'Tentar de novo'", () => {
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
    lojaAtual.config = { freeShippingMin: 0 };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function cotar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={onSelectOption}
          cepDestino="19999999"
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  async function esperarUmPouco() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }

  it.each([
    ["com WhatsApp", "(34) 99999-9999", FRASE_COM_CONTATO],
    ["sem contato", "", FRASE_SEM_CONTATO],
  ])(
    "409 loja_sem_cep_de_origem (%s): frase do checkout, sem botão e sem segunda chamada",
    async (_caso, whatsappNumber, frase) => {
      lojaAtual.config = { freeShippingMin: 0, whatsappNumber };
      invoke.mockResolvedValue({
        data: null,
        error: erroHttp(respostaDaLojaSemCep()),
      });
      await cotar();
      await esperarUmPouco();

      expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
        frase,
      );
      expect(hospedeiro.textContent).not.toContain("Tentar de novo");
      expect(hospedeiro.textContent).not.toContain("configurou o CEP");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(onSelectOption.mock.calls).toEqual([[null]]);
    },
  );

  it("o WhatsApp da loja chega DEPOIS do 409: a frase troca para a com contato, sem nova chamada", async () => {
    lojaAtual.config = { freeShippingMin: 0, whatsappNumber: "" };
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(respostaDaLojaSemCep()),
    });
    await cotar();
    await esperarUmPouco();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_SEM_CONTATO,
    );

    // A config da loja termina de carregar (ou a lojista cadastra o número
    // ao vivo): o topo do checkout passa a "Fale com a loja" e a calculadora
    // logo abaixo acompanha.
    lojaAtual.config = {
      freeShippingMin: 0,
      whatsappNumber: "(34) 99999-9999",
    };
    await cotar();
    await esperarUmPouco();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_COM_CONTATO,
    );
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("CONTROLE: o mesmo 409 sem código segue genérico e COM 'Tentar de novo'", async () => {
    lojaAtual.config = { freeShippingMin: 0, whatsappNumber: "34999999999" };
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(
        new Response(JSON.stringify({ error: "x" }), { status: 409 }),
      ),
    });
    await cotar();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      FRASE_GENERICA,
    );
    expect(hospedeiro.textContent).toContain("Tentar de novo");
  });

  it("app antigo (sem o código no mapa): o 409 cai na frase genérica, nunca em 'CEP não encontrado'", () => {
    // O app em cache não conhece `loja_sem_cep_de_origem` e chama o tradutor
    // com as MESMAS opções da calculadora: o 409 não tem tratamento próprio.
    const frase = mensagemAmigavelErroEdgeFunction(
      erroHttp(respostaDaLojaSemCep()),
      { mensagemGenerica: FRASE_GENERICA },
    );
    expect(frase).toBe(FRASE_GENERICA);
  });
});

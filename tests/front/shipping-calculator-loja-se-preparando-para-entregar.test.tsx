// @vitest-environment jsdom
// A LOJA NOVA SÓ VENDE O QUE CONFIRMOU (28/11/2026, migration 20261655000000):
// a cliente da cidade de uma loja que ainda não confirmou a entrega na cidade
// recebe da edge 409 `loja_se_preparando_para_entregar` (nunca uma lista vazia
// calada). A calculadora diz "Esta loja ainda está se preparando para entregar.",
// sem "Tentar de novo" (só a lojista destrava) e, com WhatsApp da loja, com o
// mesmo botão de combinar a entrega do estado sem opção.
//
// Com a retirada ligada, a edge responde 200 só com a retirada e
// `entregaLocalPendente: true`: a mesma frase aparece acima da retirada (a
// cliente da cidade não fica sem saber por que a entrega sumiu), também sem
// "Tentar de novo", e essa resposta não vai para o cache do navegador (o cache
// não guarda o aviso, e a entrega volta assim que a lojista confirma).
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
const lojaAtual: { config: Record<string, unknown> } = { config: {} };
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: lojaAtual.config, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
const abrirWhatsapp = vi.fn();
vi.mock("@/lib/abrir-whatsapp", () => ({
  abrirWhatsapp: (...args: unknown[]) => abrirWhatsapp(...args),
}));

const FRASE = "Esta loja ainda está se preparando para entregar.";
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

const respostaDaLojaSePreparando = () =>
  new Response(
    JSON.stringify({
      error: FRASE,
      codigo: "loja_se_preparando_para_entregar",
    }),
    { status: 409 },
  );

const botaoDeCombinar = () =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Combinar entrega pelo WhatsApp"),
  );

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — loja se preparando para entregar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onSelectOption = vi.fn();
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
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
    abrirWhatsapp.mockReset();
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

  it("409 com WhatsApp: a frase, sem Tentar de novo, e o botão abre a conversa com o CEP", async () => {
    lojaAtual.config = {
      freeShippingMin: 0,
      whatsappNumber: "(34) 99999-0000",
    };
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(respostaDaLojaSePreparando()),
    });
    await cotar();
    await esperarUmPouco();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE);
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(hospedeiro.textContent).not.toContain("Esta loja ainda não entrega");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(onSelectOption.mock.calls).toEqual([[null]]);

    const botao = botaoDeCombinar();
    expect(botao).toBeDefined();
    act(() => botao?.click());
    expect(abrirWhatsapp).toHaveBeenCalledTimes(1);
    const link = String(abrirWhatsapp.mock.calls[0][0]);
    expect(link.startsWith("https://wa.me/5534999990000?text=")).toBe(true);
    expect(decodeURIComponent(link.split("?text=")[1])).toContain("19999-999");
  });

  it("409 sem WhatsApp: a mesma frase, sem botão nenhum", async () => {
    lojaAtual.config = { freeShippingMin: 0, whatsappNumber: "" };
    invoke.mockResolvedValue({
      data: null,
      error: erroHttp(respostaDaLojaSePreparando()),
    });
    await cotar();
    await esperarUmPouco();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE);
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(botaoDeCombinar()).toBeUndefined();
  });

  it("CONTROLE: outro 409 com WhatsApp segue genérico, com Tentar de novo e sem o botão de combinar", async () => {
    lojaAtual.config = { freeShippingMin: 0, whatsappNumber: "34999990000" };
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
    expect(botaoDeCombinar()).toBeUndefined();
  });

  const retirada = {
    id: "store-pickup",
    name: "Retirar na loja",
    price: 0,
    deliveryDays: 0,
    provider: "pickup",
    pickupAddress: "Rua Exemplo, 100 - Centro",
  };

  it("200 só com a retirada e entregaLocalPendente: a frase acima da retirada, sem Tentar de novo, com o botão de combinar, e nada no cache", async () => {
    lojaAtual.config = {
      freeShippingMin: 0,
      whatsappNumber: "(34) 99999-0000",
      enabledShippingMethods: ["local-delivery", "store-pickup"],
    };
    invoke.mockResolvedValue({
      data: {
        options: [retirada],
        cotacaoIncompleta: false,
        entregaLocalPendente: true,
      },
      error: null,
    });
    await cotar();
    await esperarUmPouco();

    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(FRASE);
    expect(hospedeiro.textContent).toContain("Retirar na loja");
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    expect(botaoDeCombinar()).toBeDefined();
    // O app nunca escolhe a retirada pela cliente.
    expect(onSelectOption).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "store-pickup" }),
    );
    expect(
      [...armazem.keys()].filter((k) =>
        k.startsWith("ikcous_shipping_cache_v2_"),
      ),
    ).toEqual([]);
  });

  it("CONTROLE: 200 só com a retirada, SEM entregaLocalPendente: nenhuma frase, e a cotação vai para o cache", async () => {
    lojaAtual.config = {
      freeShippingMin: 0,
      whatsappNumber: "(34) 99999-0000",
      enabledShippingMethods: ["local-delivery", "store-pickup"],
    };
    invoke.mockResolvedValue({
      data: { options: [retirada], cotacaoIncompleta: false },
      error: null,
    });
    await cotar();
    await esperarUmPouco();

    expect(hospedeiro.textContent).toContain("Retirar na loja");
    expect(hospedeiro.textContent).not.toContain(FRASE);
    expect(botaoDeCombinar()).toBeUndefined();
    expect(
      [...armazem.keys()].filter((k) =>
        k.startsWith("ikcous_shipping_cache_v2_"),
      ),
    ).toEqual(["ikcous_shipping_cache_v2_19999999"]);
  });
});

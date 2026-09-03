// @vitest-environment jsdom
//
// ONDA D-1 (frente frete-v2-0309, 03/09): o ShippingCalculator tem a MESMA
// avaliação de grátis que o total — a cópia antiga da regra dentro dele
// (item marcado INCONDICIONAL + trava `Boolean(user)`) morreu. O componente
// consome o veredito ÚNICO `freteGratis` do CartContext (memo que lê o
// preset via `presetDoConfig`, fonte única em presets-de-frete-gratis.ts).
//
// O defeito que este arquivo prende morto: com o preset "acima_de_valor", um
// CONVIDADO no limite via as opções de frete a preço cheio na calculadora
// enquanto o total do pedido saía grátis — duas avaliações da mesma regra
// divergindo na mesma tela (lição #53).
//
// Montagem: CartProvider REAL (a regra é a de produção) + ShippingCalculator
// REAL (a exibição é a de produção) + cotação da edge dublê. O usuário é
// CONVIDADO nos três presets — é a paridade que a trava morta negava.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider } from "@/contexts/CartContext";
import type { CartItem, ShippingOption } from "@/types";

// Estado mutável POR TESTE — vi.mock é içado, então os mocks leem este
// objeto (vi.hoisted), e cada teste o reescreve antes de montar.
const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 0,
    shippingFee: 15,
    originCep: "38500-000",
    shippingProvider: "melhor_envio" as
      | "flat_fee"
      | "melhor_envio"
      | "frenet"
      | undefined,
  },
  user: null as { id: string } | null,
  // Opções que a edge "devolve" na próxima cotação.
  opcoes: [] as ShippingOption[],
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: false }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

// Supabase suficiente para o CartProvider montar (leitura de carrinho do
// banco VAZIA — o carrinho local do localStorage é o que vale) e para a
// calculadora cotar (`functions.invoke` devolve `estado.opcoes`).
vi.mock("@/lib/supabase", () => {
  // A consulta termina em `eq`/`in` devolvendo uma PROMISE NATIVA: o
  // then/catch vêm de graça do Promise, sem declarar `then` na mão —
  // objeto com `then` literal acende a noThenProperty do biome (parece
  // thenable para um await distraído).
  const consulta = () => {
    const resposta = () =>
      Promise.resolve({ data: [] as unknown[], error: null });
    const alvo: Record<string, unknown> = {
      select: () => alvo,
      eq: resposta,
      in: resposta,
    };
    return alvo;
  };
  return {
    supabase: {
      from: () => consulta(),
      rpc: () => Promise.resolve({ error: null }),
      auth: {
        getSession: () =>
          Promise.resolve({ data: { session: { user: { id: "u1" } } } }),
      },
      channel: () => {
        const canal: Record<string, unknown> = {
          on: () => canal,
          subscribe: () => ({}),
        };
        return canal;
      },
      removeChannel: () => Promise.resolve(),
      functions: {
        invoke: () =>
          Promise.resolve({
            data: { options: estado.opcoes },
            error: null,
          }),
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// framer-motion em jsdom: animações viram elementos HTML simples.
vi.mock("framer-motion", async () => {
  const React = await import("react");
  const propsDeAnimacao = [
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "whileHover",
    "whileTap",
    "whileInView",
    "viewport",
    "custom",
  ];
  const motion = new Proxy(
    {},
    {
      get: (_alvo, tag: string) => (props: Record<string, unknown>) => {
        const limpos: Record<string, unknown> = {};
        for (const [chave, valor] of Object.entries(props)) {
          if (!propsDeAnimacao.includes(chave)) limpos[chave] = valor;
        }
        return React.createElement(tag, limpos);
      },
    },
  );
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion,
  };
});

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/frete-v2-presets-contrato.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(
  sobre: Partial<CartItem["product"]> = {},
): CartItem["product"] {
  return {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 50,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
    ...sobre,
  };
}

function item(produtoDoItem: CartItem["product"], quantity = 1): CartItem {
  return {
    product: produtoDoItem,
    quantity,
    lastModifiedAt: Date.now(),
  };
}

const opcaoPac: ShippingOption = {
  id: "melhorenvio-pac",
  name: "PAC",
  price: 41.9,
  deliveryDays: 7,
  provider: "melhor_envio",
};

describe("ShippingCalculator — o grátis da calculadora é o mesmo veredito do total (onda D-1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

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
    estado.config = {
      freeShippingMin: 0,
      shippingFee: 15,
      originCep: "38500-000",
      shippingProvider: "melhor_envio",
    };
    estado.user = null;
    estado.opcoes = [opcaoPac];
    selecionadas = [];
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
  });

  /** Monta provider + calculadora com o carrinho dado e submete um CEP. */
  async function montarECotar(itens: CartItem[]) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <CartProvider>
          <ShippingCalculator
            cart={itens}
            selectedOption={null}
            onSelectOption={(opt) => selecionadas.push(opt)}
          />
        </CartProvider>,
      );
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, "69000000");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    return hospedeiro.textContent ?? "";
  }

  it("acima_de_valor: CONVIDADO no limite vê GRÁTIS na opção — a trava Boolean(user) morreu", async () => {
    estado.config = { ...estado.config, freeShippingMin: 100 };
    // 2 × 50 = 100 = no limite exato. Convidado (user null).
    const texto = await montarECotar([item(produto(), 2)]);

    // Antes da onda D-1: a cópia antiga da regra exigia login e mostrava
    // "R$ 41,90" aqui enquanto o total saía grátis.
    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("41,90");
    // A opção segue selecionável (o total é quem sai grátis).
    expect(selecionadas).toHaveLength(1);
  });

  it("acima_de_valor: logado no limite vê GRÁTIS — paridade com o convidado", async () => {
    estado.user = { id: "u1" };
    estado.config = { ...estado.config, freeShippingMin: 100 };
    const texto = await montarECotar([item(produto(), 2)]);

    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("41,90");
  });

  it("por_produto: item MARCADO vê GRÁTIS (a marcação só vale dentro do preset)", async () => {
    // Sentinela -1 = preset "por_produto" (FRETE_GRATIS_POR_PRODUTO).
    estado.config = { ...estado.config, freeShippingMin: -1 };
    const texto = await montarECotar([item(produto({ freeShipping: true }))]);

    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("41,90");
  });

  it("desligado: item marcado NUNCA é grátis — a leitura incondicional morreu", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0 };
    const texto = await montarECotar([item(produto({ freeShipping: true }))]);

    // Preço real na tela, selo GRÁTIS em lugar nenhum.
    expect(texto).toContain("41,90");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("cotação sem opção nenhuma e sem grátis: estado honesto 'A calcular', nunca silêncio", async () => {
    // Resposta honesta da edge (frente C): loja sem transportadora
    // conectada devolve `options: []`.
    estado.opcoes = [];
    estado.config = { ...estado.config, freeShippingMin: 0 };
    const texto = await montarECotar([item(produto())]);

    expect(texto).toContain("A calcular");
    expect(texto).not.toContain("41,90");
  });
});

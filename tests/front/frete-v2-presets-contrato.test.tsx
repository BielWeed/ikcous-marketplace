// @vitest-environment jsdom
//
// FRETE V2 (frente B, dossiê frete-v2-0309, ordem do dono 03/09): a loja do
// cliente passa a obedecer os PRESETS de frete grátis que o lojista seleciona
// na tela de Frete — modelo EXCLUSIVO de presets (a estratégia escolhida é a
// única que vale). Fonte única da regra: src/lib/presets-de-frete-gratis.ts
// (a tela admin escreve, o carrinho/checkout/blocos de grátis lêem).
//
// O que morreu e este teste prende morto:
//  - a leitura INCONDICIONAL de `product.freeShipping` (zerava o frete com
//    qualquer item marcado, qualquer config) — a marcação só vale dentro do
//    preset "por_produto";
//  - a trava `&& user` no limite de valor — convidado tem o mesmo direito ao
//    grátis da loja (a entrega dele é local de qualquer forma).
//
// Sentinelas (decisão da orquestração 03/09, no banco confirmado sem CHECK de
// faixa — upsert_store_config grava numeric puro): "sempre" = 0.01,
// "por_produto" = -1 (FRETE_GRATIS_POR_PRODUTO), "desligado" = 0.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import { presetDoConfig } from "@/lib/presets-de-frete-gratis";
import type { CartItem, Product } from "@/types";

// Estado mutável POR TESTE — vi.mock é içado, então os mocks leem este objeto
// (vi.hoisted), e cada teste o reescreve antes de montar.
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

// Supabase suficiente para o CartProvider montar com usuário logado: leitura
// de carrinho do banco devolve VAZIO (o carrinho local do localStorage é o
// que vale), sessão existe (o sync de volta segue), realtime não faz nada.
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

// framer-motion em jsdom: os componentes de animação viram elementos HTML
// simples (as props de animação são descartadas).
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
// tests/front/cart-context-estoque-zero-tira-o-item.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(sobre: Partial<Product> = {}): Product {
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

function item(produtoDoItem: Product, quantity = 1): CartItem {
  return {
    product: produtoDoItem,
    quantity,
    lastModifiedAt: Date.now(),
  };
}

/** Não renderiza nada — empurra o estado de frete do contexto para fora a
 * cada render, para o teste agir sem consumidor de UI. */
function SondaFrete({
  onFrete,
}: Readonly<{
  onFrete: (frete: {
    shippingFee: number;
    freteIndefinido: boolean;
    cartTotal: number;
    setSelectedShippingOption: ReturnType<
      typeof useCartContext
    >["setSelectedShippingOption"];
  }) => void;
}>) {
  const { shippingFee, freteIndefinido, cartTotal, setSelectedShippingOption } =
    useCartContext();
  useEffect(() => {
    onFrete({
      shippingFee,
      freteIndefinido,
      cartTotal,
      setSelectedShippingOption,
    });
  }, [
    shippingFee,
    freteIndefinido,
    cartTotal,
    setSelectedShippingOption,
    onFrete,
  ]);
  return null;
}

describe("CartContext — presets de frete grátis governam o carrinho (frente B)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let freteAtual: {
    shippingFee: number;
    freteIndefinido: boolean;
    cartTotal: number;
    setSelectedShippingOption: ReturnType<
      typeof useCartContext
    >["setSelectedShippingOption"];
  };

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
    freteAtual = {
      shippingFee: -1,
      freteIndefinido: false,
      cartTotal: -1,
      setSelectedShippingOption: () => {},
    };
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
    vi.restoreAllMocks();
  });

  async function montarCarrinho(itens: CartItem[]) {
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <SondaFrete
            onFrete={(frete) => {
              freteAtual = frete;
            }}
          />
        </CartProvider>,
      );
    });
  }

  it("desligado (min 0): item MARCADO não zera o frete — a leitura incondicional morreu", async () => {
    await montarCarrinho([item(produto({ freeShipping: true }))]);

    // O selo de grátis por produto SÓ vale dentro do preset "por_produto".
    // Sem preset de valor, nada é grátis pela loja: com provedor de cotação
    // real e nenhuma cotação escolhida, o honesto é "a calcular", nunca o
    // fallback R$ 15 nem o grátis do selo.
    expect(freteAtual.freteIndefinido).toBe(true);
    expect(freteAtual.shippingFee).toBe(15);
  });

  it("acima_de_valor: CONVIDADO no limite ganha grátis — a trava && user morreu", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: 100,
    };
    await montarCarrinho([item(produto(), 2)]); // 2 × 50 = 100

    expect(freteAtual.cartTotal).toBe(100);
    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("acima_de_valor: logado no limite ganha grátis — paridade com o convidado", async () => {
    estado.user = { id: "u1" };
    estado.config = {
      ...estado.config,
      freeShippingMin: 100,
    };
    await montarCarrinho([item(produto(), 2)]);

    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("acima_de_valor: abaixo do limite nada é grátis — e sem cotação é 'a calcular'", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: 100,
    };
    await montarCarrinho([item(produto())]); // 50 < 100

    expect(freteAtual.shippingFee).toBe(15);
    expect(freteAtual.freteIndefinido).toBe(true);
  });

  it("acima_de_valor: grátis vence a cotação escolhida — a estratégia é exclusiva", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: 100,
    };
    await montarCarrinho([item(produto(), 2)]);

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "cot-1",
        name: "SEDEX",
        price: 24.9,
        deliveryDays: 3,
        provider: "melhor_envio",
      });
    });

    // O preset de grátis é a estratégia ÚNICA que vale: atingido o limite, a
    // opção cotada não reintroduz frete.
    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("sempre (sentinela 0,01): convidado tem frete 0 SEM cotação escolhida", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: 0.01,
    };
    await montarCarrinho([item(produto())]);

    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("sempre (sentinela 0,01): logado igual ao convidado — paridade", async () => {
    estado.user = { id: "u1" };
    estado.config = {
      ...estado.config,
      freeShippingMin: 0.01,
    };
    await montarCarrinho([item(produto())]);

    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("por_produto (sentinela -1): item MARCADO zera o frete — a marcação volta a valer", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: -1,
    };
    await montarCarrinho([item(produto({ freeShipping: true }))]);

    expect(presetDoConfig(-1)).toBe("por_produto");
    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("por_produto (sentinela -1): SEM item marcado nada é grátis — e convidado é igual ao logado", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: -1,
    };
    await montarCarrinho([item(produto({ freeShipping: false }))]);

    expect(freteAtual.freteIndefinido).toBe(true);
    expect(freteAtual.shippingFee).toBe(15);

    // Logado sem item marcado: idem — o preset não tem meta de valor para
    // login nenhum liberar.
    estado.user = { id: "u1" };
    await montarCarrinho([item(produto({ freeShipping: false }))]);
    expect(freteAtual.freteIndefinido).toBe(true);
    expect(freteAtual.shippingFee).not.toBe(0);
  });

  it("por_produto (sentinela -1): item marcado é grátis também para LOGADO", async () => {
    estado.user = { id: "u1" };
    estado.config = {
      ...estado.config,
      freeShippingMin: -1,
    };
    await montarCarrinho([item(produto({ freeShipping: true }))]);

    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteIndefinido).toBe(false);
  });

  it("desligado continua 0: presetDoConfig distingue as três sentinelas", async () => {
    expect(presetDoConfig(0)).toBe("desligado");
    expect(presetDoConfig(-1)).toBe("por_produto");
    expect(presetDoConfig(0.01)).toBe("sempre");
    expect(presetDoConfig(150)).toBe("acima_de_valor");
  });

  it("com cotação escolhida e sem grátis, o preço é o da opção — 'a calcular' sai da tela", async () => {
    estado.config = {
      ...estado.config,
      freeShippingMin: 0,
    };
    await montarCarrinho([item(produto())]);

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "cot-1",
        name: "SEDEX",
        price: 24.9,
        deliveryDays: 3,
        provider: "melhor_envio",
      });
    });

    expect(freteAtual.shippingFee).toBe(24.9);
    expect(freteAtual.freteIndefinido).toBe(false);
  });
});

describe("Sentinela 'sempre' exibida certa — nunca 'faltam R$ 0,01' (frente B)", () => {
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
    vi.useFakeTimers();
    estado.user = null;
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
    vi.restoreAllMocks();
  });

  async function montarBloco(config: {
    freeShippingMin: number;
    shippingFee: number;
  }) {
    estado.config = {
      ...estado.config,
      ...config,
    };
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([item(produto())]),
    );
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(
        <CartProvider>
          <FreeShippingBlock />
        </CartProvider>,
      );
    });
  }

  async function montarLembrete(config: {
    freeShippingMin: number;
    shippingFee: number;
  }) {
    estado.config = {
      ...estado.config,
      ...config,
    };
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([item(produto())]),
    );
    const { CartReminder } = await import(
      "@/components/ui/custom/CartReminder"
    );
    await act(async () => {
      raiz.render(
        <CartProvider>
          <CartReminder onAction={() => {}} />
        </CartProvider>,
      );
    });
    // O lembrete aparece 1,5 s depois de montar.
    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
  }

  it("FreeShippingBlock com 'sempre': 'Frete grátis em toda a loja', nunca a meta de R$ 0,01", async () => {
    await montarBloco({ freeShippingMin: 0.01, shippingFee: 15 });

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Frete grátis em toda a loja");
    expect(texto).not.toContain("0,01");
    expect(texto).not.toContain("acima de");
  });

  it("FreeShippingBlock com limite de valor: a meta vale para CONVIDADO — sem 'Faça login'", async () => {
    await montarBloco({ freeShippingMin: 150, shippingFee: 15 });

    // Carrinho com R$ 50: o convidado vê o progresso real da meta — a trava
    // de login morreu com o modelo de presets.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Adicione mais R$ 100,00");
    expect(texto).toContain("Falta pouquinho pro Frete Grátis!");
    expect(texto).not.toContain("Faça login");
  });

  it("FreeShippingBlock desligado: não anuncia grátis que a loja não oferece", async () => {
    await montarBloco({ freeShippingMin: 0, shippingFee: 15 });

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("Frete");
  });

  it("CartReminder com 'sempre': 'Frete grátis em toda a loja', nunca 'faltam R$ 0,01'", async () => {
    await montarLembrete({ freeShippingMin: 0.01, shippingFee: 15 });

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Frete grátis em toda a loja");
    expect(texto).not.toContain("0,01");
    expect(texto).not.toContain("Faltam");
  });

  it("CartReminder com limite de valor: convidado vê o progresso — sem 'Faça login'", async () => {
    await montarLembrete({ freeShippingMin: 150, shippingFee: 15 });

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("Faltam");
    expect(texto).toContain("R$ 100,00");
    expect(texto).not.toContain("Faça login");
  });
});

// @vitest-environment jsdom
//
// Peça 04 (dono, 13/09 à noite): o frete grátis aparecia na jornada do
// carrinho como um programa que não existe — "FRETE VIP LIBERADO" no banner
// de progresso, "PREMIUM SERVICE ATIVADO" de eyebrow, tag "BÔNUS VIP" junto
// ao TOTAL da barra inferior e "Premium Delivery"/"Frete VIP" no lembrete.
// A funcionalidade é frete grátis, e o tom certo já existe na home
// ("Oba! Frete Grátis Liberado! / Seu carrinho já ganhou entrega grátis!",
// FreeShippingBlock; peça 09 trocou sacola→carrinho). Este arquivo prende a
// regra geral da peça: a jornada
// do carrinho/frete não fala "VIP", "premium" nem inglês.
//
// Padrão de montagem: render real + toContain sobre textContent normalizado
// (o mesmo do frete-v2-presets-contrato.test.tsx). O CartReminder só aparece
// 1,5 s depois de montar, por isso os timers falsos; o CartFooterSummary
// renderiza em createPortal direto em document.body, fora do hospedeiro.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider } from "@/contexts/CartContext";
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

// Supabase suficiente para o CartProvider montar: leitura de carrinho do
// banco devolve VAZIO (o carrinho local do localStorage é o que vale),
// realtime não faz nada.
vi.mock("@/lib/supabase", () => {
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
          if (!propsDeAnimacao.includes(chave)) {
            // eslint-disable-next-line security/detect-object-injection -- chave do próprio mock de animação, nunca de entrada externa.
            limpos[chave] = valor;
          }
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

/** textContent do body com NBSP (U+00A0) normalizado em espaço comum —
 * o formatCurrency emite NBSP entre o R$ e o valor (mesma normalização do
 * frete-v2-presets-contrato). */
function textoDoCorpo(): string {
  return (document.body.textContent ?? "").replace(/\u00A0/g, " ");
}

describe("ShippingProgress com frete grátis — 'Frete Grátis Liberado' no tom da home", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("liberado: título e eyebrow falam frete grátis em português — nada de VIP/premium/inglês", async () => {
    const { ShippingProgress } = await import(
      "@/components/ui/custom/ShippingProgress"
    );
    const produtos: Product[] = [];
    await act(async () => {
      raiz.render(
        <ShippingProgress
          shipping={0}
          savings={12.34}
          progressPercent={82}
          amountToFree={0}
          isNearlyThere={false}
          freeShippingProducts={produtos}
          onAddToCart={() => {}}
          onNavigate={() => {}}
        />,
      );
    });

    const texto = textoDoCorpo();
    // O título do banner (h3, maiúsculas via CSS) e o eyebrow com a frase
    // sancionada da home (peça 04, ponto 1).
    expect(texto).toContain("Frete Grátis Liberado");
    expect(texto).toContain("Seu carrinho já ganhou entrega grátis!");
    expect(texto).not.toMatch(/vip/i);
    expect(texto).not.toMatch(/premium/i);
  });
});

describe("CartFooterSummary com frete grátis — a tag 'Bônus VIP' saiu, o 'GRÁTIS' ficou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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

  it("frete grátis: nenhuma tag 'Bônus VIP' no portal, e o frete continua comunicando grátis", async () => {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={2}
          shipping={0}
          total={100}
          onNavigate={() => {}}
        />,
      );
    });

    // createPortal insere direto em document.body, fora de `hospedeiro`.
    const spans = Array.from(document.body.querySelectorAll("span"));
    expect(spans.find((el) => el.textContent === "Bônus VIP")).toBeUndefined();
    const texto = textoDoCorpo();
    expect(texto).not.toMatch(/vip/i);
    // Quem comunica o frete grátis é o valor do frete ao lado do FINALIZAR
    // (contrato completo em cart-footer-frete-a-calcular).
    expect(texto).toContain("GRÁTIS");
  });
});

describe("CartReminder — o lembrete fala 'frete grátis', sem Premium Delivery", () => {
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
  });

  async function montarLembrete(freeShippingMin: number, preco: number) {
    estado.config = { ...estado.config, freeShippingMin };
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([item(produto({ price: preco }))]),
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

  it("meta atingida: 'Frete Grátis Liberado' — nunca 'Frete VIP'", async () => {
    await montarLembrete(100, 150);

    const texto = textoDoCorpo();
    expect(texto).toContain("Frete Grátis Liberado");
    expect(texto).not.toContain("Frete VIP");
  });

  it("antes da meta: 'para o Frete Grátis' — nunca 'para o Frete VIP'", async () => {
    await montarLembrete(150, 50);

    const texto = textoDoCorpo();
    expect(texto).toContain("para o Frete Grátis");
    expect(texto).not.toContain("Frete VIP");
  });

  it("eyebrow do lembrete: 'Seu carrinho' em português — 'Premium Delivery' saiu", async () => {
    await montarLembrete(150, 50);

    const texto = textoDoCorpo();
    expect(texto).toContain("Seu carrinho");
    expect(texto).not.toContain("Premium Delivery");
    expect(texto).not.toMatch(/premium/i);
  });
});

// @vitest-environment jsdom
//
// T3 (23/09/2026, plano estratégias-de-frete-local-e-nacional): o bug que
// esta frente inteira existe para consertar era `CartContext.freteGratis`
// sendo um veredito GLOBAL derivado só do preset local — zerando/anunciando
// grátis em QUALQUER opção, inclusive cotação de transportadora. Este
// arquivo prova as DUAS metades do contrato novo, direto no CartContext (o
// nível que decide o total do pedido, não só o texto da tela):
//
//  1. local grátis (preset "sempre") + nacional ESCOLHIDA paga: o total
//     cobra a nacional cheia -- o preset local não vaza para a opção
//     escolhida quando ela não é `local-delivery`/`store-pickup`.
//  2. o inverso: nacional grátis (edge devolveu price=0 para a opção
//     escolhida) + local preset DESLIGADO: `freteGratis` segue a opção
//     ESCOLHIDA, nunca o preset local sozinho.
//  3. desconto nacional (não grátis, `precoCheio > price > 0`): o total é
//     subtotal + o `price` COM desconto (nunca o `precoCheio`), e
//     `descontoDoFrete` expõe exatamente a diferença -- é o número que a
//     pílula de economia do checkout soma.
//
// Harness idêntico a frete-v2-presets-contrato.test.tsx (mesmo motivo:
// SondaFrete evita montar toda a árvore de UI só para ler 4 campos do
// contexto).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product } from "@/types";

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
        // `Object.fromEntries` + filter (não `limpos[chave] = valor` em
        // laço) -- a mesma limpeza sem disparar o security/detect-object-
        // injection do eslint (chave dinâmica escrevendo em objeto).
        const limpos = Object.fromEntries(
          Object.entries(props).filter(
            ([chave]) => !propsDeAnimacao.includes(chave),
          ),
        );
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

// @ts-expect-error flag interna do React, sem tipo público.
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

interface FreteProbe {
  shippingFee: number;
  freteGratis: boolean;
  freteIndefinido: boolean;
  descontoDoFrete: number;
  cartTotal: number;
  setSelectedShippingOption: ReturnType<
    typeof useCartContext
  >["setSelectedShippingOption"];
}

function SondaFrete({
  onFrete,
}: Readonly<{ onFrete: (frete: FreteProbe) => void }>) {
  const {
    shippingFee,
    freteGratis,
    freteIndefinido,
    descontoDoFrete,
    cartTotal,
    setSelectedShippingOption,
  } = useCartContext();
  useEffect(() => {
    onFrete({
      shippingFee,
      freteGratis,
      freteIndefinido,
      descontoDoFrete,
      cartTotal,
      setSelectedShippingOption,
    });
  }, [
    shippingFee,
    freteGratis,
    freteIndefinido,
    descontoDoFrete,
    cartTotal,
    setSelectedShippingOption,
    onFrete,
  ]);
  return null;
}

describe("CartContext — local e nacional NÃO se misturam (T3, 23/09/2026)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let freteAtual: FreteProbe;

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
      freteGratis: false,
      freteIndefinido: false,
      descontoDoFrete: -1,
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

  // CORREÇÃO (revisão Opus, pós-T3): a versão anterior deste teste usava uma
  // opção nacional SEM `estrategiaNacional` — sem o carimbo, a RPC (migration
  // 20261171000000 ~linha 1195) aplica a REGRA LEGADA (mesma sentinela do
  // preset local) por segurança, e o front tem que espelhar isso; com preset
  // "sempre" a regra legada ZERA a opção, o oposto do que este teste
  // afirmava. A prova de independência de verdade exige uma opção CARIMBADA
  // (cotada por uma edge já nesta frente, que sempre carimba a nacional).
  it("local SEMPRE grátis, mas a cliente escolhe transportadora CARIMBADA e paga: cobra a transportadora inteira", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0.01 }; // sentinela "sempre"
    await montarCarrinho([item(produto(), 1)]); // subtotal 50

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "frenet-sedex",
        name: "SEDEX",
        price: 28.5,
        deliveryDays: 3,
        provider: "frenet",
        estrategiaNacional: {
          estrategia: "desligado",
          minimo: 0,
          tipoDesconto: null,
          valorDesconto: 0,
          alcance: "mais_barata",
        },
      });
    });

    // O preset local "sempre" NÃO vaza para a opção nacional CARIMBADA --
    // esse vazamento era exatamente o bug que este plano existe pra matar.
    expect(freteAtual.shippingFee).toBe(28.5);
    expect(freteAtual.freteGratis).toBe(false);
    expect(freteAtual.descontoDoFrete).toBe(0);
    expect(freteAtual.cartTotal).toBe(50);
  });

  // NOVO (revisão Opus, pós-T3): a mesma escolha, mas SEM carimbo (edge
  // antiga/loja sem migration/leitura que falhou) — aqui a REGRA LEGADA
  // (mesma sentinela do preset local) bate de propósito, e a opção nacional
  // ZERA junto com o local. Não é o mesmo caso do teste acima: prova que a
  // ausência do carimbo tem um comportamento DIFERENTE e intencional (nunca
  // "intocado por padrão").
  it("local SEMPRE grátis + transportadora SEM carimbo: a regra legada zera a opção também (proteção contra edge antiga)", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0.01 };
    await montarCarrinho([item(produto(), 1)]);

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "frenet-sedex",
        name: "SEDEX",
        price: 28.5,
        deliveryDays: 3,
        provider: "frenet",
      });
    });

    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteGratis).toBe(true);
    expect(freteAtual.descontoDoFrete).toBe(28.5);
  });

  // CORREÇÃO (revisão Opus, pós-T3): precisa do carimbo `estrategiaNacional`
  // — é ele que prova que o grátis veio de uma decisão REAL da edge (e não
  // da regra legada de segurança, que aqui coincide no valor mas não seria
  // o mesmo caminho de código).
  it("o inverso: local DESLIGADO, mas a nacional CARIMBADA escolhida veio grátis da edge (price 0): freteGratis segue a OPÇÃO, não o preset local", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0 }; // desligado
    await montarCarrinho([item(produto(), 1)]);

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "frenet-motoboy",
        name: "Frenet Grátis",
        price: 0,
        precoCheio: 22,
        deliveryDays: 1,
        provider: "frenet",
        estrategiaNacional: {
          estrategia: "sempre",
          minimo: 0,
          tipoDesconto: null,
          valorDesconto: 0,
          alcance: "mais_barata",
        },
      });
    });

    // A edge decidiu zerar esta opção nacional (estratégia "sempre"/"por
    // valor"/promoção) -- o front só EXIBE esse veredito, nunca o
    // recalcula, e o preset local "desligado" não pode vetar um grátis que
    // já chegou pronto da opção escolhida.
    expect(freteAtual.shippingFee).toBe(0);
    expect(freteAtual.freteGratis).toBe(true);
    expect(freteAtual.descontoDoFrete).toBe(22);
  });

  // CORREÇÃO (revisão Opus, pós-T3): precisa do carimbo -- sem ele, a opção
  // cai na regra legada (que aqui não zeraria nada, preset "desligado", mas
  // também não devolveria o desconto: `economiaDaOpcao` só lê `precoCheio`
  // no ramo CARIMBADO).
  it("desconto nacional CARIMBADO (não grátis): o total soma o PREÇO COM DESCONTO, nunca o precoCheio -- e descontoDoFrete expõe a diferença", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0 };
    await montarCarrinho([item(produto(), 2)]); // subtotal 100

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "melhorenvio-pac",
        name: "PAC com desconto da loja",
        price: 20,
        precoCheio: 35,
        deliveryDays: 8,
        provider: "melhor_envio",
        estrategiaNacional: {
          estrategia: "desconto_na_mais_barata",
          minimo: 0,
          tipoDesconto: "fixo",
          valorDesconto: 15,
          alcance: "mais_barata",
        },
      });
    });

    expect(freteAtual.shippingFee).toBe(20);
    expect(freteAtual.freteGratis).toBe(false); // desconto ≠ grátis
    expect(freteAtual.descontoDoFrete).toBe(15);
    // Total que o checkout fecharia (subtotal + shippingFee, mesma conta de
    // CheckoutView.tsx): nunca soma o precoCheio.
    expect(freteAtual.cartTotal + freteAtual.shippingFee).toBe(120);
  });

  // BORDA (skill de execução densa): opção nacional com precoCheio E
  // `estrategiaNacional` AUSENTES (mesma edge antiga, sem os dois campos —
  // vintage anterior a 23/09) com preset local "desligado" (a regra legada
  // não zera nada nesse preset): nem o carimbo nem a regra legada inventam
  // desconto ou preço diferente do que a edge mandou.
  it("borda: nacional sem carimbo/precoCheio (edge antiga) e regra legada que NÃO bate: nunca inventa desconto", async () => {
    estado.config = { ...estado.config, freeShippingMin: 0 };
    await montarCarrinho([item(produto(), 1)]);

    await act(async () => {
      freteAtual.setSelectedShippingOption({
        id: "melhorenvio-pac",
        name: "PAC",
        price: 24.9,
        deliveryDays: 8,
        provider: "melhor_envio",
      });
    });

    expect(freteAtual.shippingFee).toBe(24.9);
    expect(freteAtual.descontoDoFrete).toBe(0);
    expect(freteAtual.freteGratis).toBe(false);
  });
});

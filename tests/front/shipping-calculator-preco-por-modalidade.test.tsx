// @vitest-environment jsdom
//
// FRETE V3 (T3, 23/09/2026 — plano estrategias-de-frete-local-e-nacional):
// cada cartão da calculadora decide o PREÇO FINAL sozinho, nunca mais um
// "isFree" carimbado em toda a lista pela regra de outra modalidade. Este
// arquivo é o citado no comentário do próprio componente
// (ShippingCalculator.tsx, logo acima de `export function ShippingCalculator`)
// e prova, cartão a cartão:
//   1. nacional com price 0 mostra GRÁTIS;
//   2. nacional com desconto (precoCheio > price, ainda positivo) mostra o
//      cheio RISCADO + o preço final + "Desconto da loja";
//   3. a opção nacional NÃO beneficiada, ao lado de outra que foi (alcance
//      'mais_barata'), ganha a nota "O benefício da loja vale só na opção
//      mais barata.";
//   4. escolher a opção NÃO beneficiada quando a OUTRA tem desconto: o
//      total do carrinho (CartContext, fonte única de verdade do que se
//      cobra) soma o preço CHEIO da opção ESCOLHIDA — nunca o preço com
//      desconto de uma opção que a cliente não escolheu.
//
// Montagem: CartProvider REAL (quem decide o preço cobrado) + ShippingCalculator
// REAL — mesma dupla de shipping-calculator-frete-gratis-fonte-unica.test.tsx,
// porque o item 4 só prova algo de verdade se passar pela fonte única
// (`precoFinalDaOpcao`/CartContext.shippingFee), não por uma leitura isolada
// do componente.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, ShippingOption } from "@/types";

const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 0, // "desligado": a regra LOCAL não participa destes testes.
    shippingFee: 15,
    originCep: "38500-000",
    shippingProvider: "melhor_envio" as
      | "flat_fee"
      | "melhor_envio"
      | "frenet"
      | undefined,
  },
  user: null as { id: string } | null,
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
        // laço) -- limpa sem disparar o security/detect-object-injection.
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

function produto(
  sobre: Partial<CartItem["product"]> = {},
): CartItem["product"] {
  return {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 100,
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
  return { product: produtoDoItem, quantity, lastModifiedAt: Date.now() };
}

type ComponenteCalculadora = React.ComponentType<{
  cart: CartItem[];
  selectedOption: ShippingOption | null;
  onSelectOption: (opt: ShippingOption | null) => void;
  cepDestino: string;
}>;

/** Não renderiza nada além da calculadora — empurra `shippingFee` do
 * CartContext para fora a cada render, e monta a calculadora exatamente
 * como CartView.tsx faz (`selectedOption`/`onSelectOption` vêm do MESMO
 * contexto). Recebe o componente já importado (evita um 2º `import()`
 * dinâmico por teste). */
function SondaComCalculadora({
  cart,
  onShippingFee,
  Calculadora,
}: Readonly<{
  cart: CartItem[];
  onShippingFee: (fee: number) => void;
  Calculadora: ComponenteCalculadora;
}>) {
  const { selectedShippingOption, setSelectedShippingOption, shippingFee } =
    useCartContext();
  useEffect(() => {
    onShippingFee(shippingFee);
  }, [shippingFee, onShippingFee]);
  return (
    <Calculadora
      cart={cart}
      selectedOption={selectedShippingOption}
      onSelectOption={setSelectedShippingOption}
      cepDestino="69000000"
    />
  );
}

describe("ShippingCalculator — preço FINAL por modalidade (T3, 23/09/2026)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimoShippingFee = -1;
  let Calculadora: ComponenteCalculadora;

  beforeEach(async () => {
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
    estado.opcoes = [];
    ultimoShippingFee = -1;
    const mod = await import("@/components/ui/custom/ShippingCalculator");
    Calculadora = mod.ShippingCalculator;
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

  async function montarECotar(itens: CartItem[], opcoes: ShippingOption[]) {
    estado.opcoes = opcoes;
    localStorage.setItem("marketplace_cart_v1", JSON.stringify(itens));
    await act(async () => {
      raiz.render(
        <CartProvider>
          <SondaComCalculadora
            cart={itens}
            Calculadora={Calculadora}
            onShippingFee={(fee) => {
              ultimoShippingFee = fee;
            }}
          />
        </CartProvider>,
      );
    });
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  function botaoDe(texto: string) {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    );
  }

  const carimboSempre: ShippingOption["estrategiaNacional"] = {
    estrategia: "sempre",
    minimo: 0,
    tipoDesconto: null,
    valorDesconto: 0,
    alcance: "mais_barata",
  };
  const carimboDesconto: ShippingOption["estrategiaNacional"] = {
    estrategia: "desconto_na_mais_barata",
    minimo: 0,
    tipoDesconto: "fixo",
    valorDesconto: 15,
    alcance: "mais_barata",
  };

  it("cartão nacional com price 0 mostra GRÁTIS", async () => {
    const gratis: ShippingOption = {
      id: "melhorenvio-promo",
      name: "PAC Promocional",
      price: 0,
      precoCheio: 30,
      deliveryDays: 8,
      provider: "melhor_envio",
      estrategiaNacional: carimboSempre,
    };
    const texto = await montarECotar([item(produto())], [gratis]);

    expect(texto).toContain("GRÁTIS");
    expect(botaoDe("PAC Promocional")?.textContent).toContain("GRÁTIS");
  });

  it("nacional com desconto (não grátis) mostra o cheio riscado + o final + 'Desconto da loja'", async () => {
    const comDesconto: ShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC com desconto",
      price: 20,
      precoCheio: 35,
      deliveryDays: 8,
      provider: "melhor_envio",
      estrategiaNacional: carimboDesconto,
    };
    const texto = await montarECotar([item(produto())], [comDesconto]);

    const cartao = botaoDe("PAC com desconto");
    expect(cartao?.textContent).toContain("35,00");
    expect(cartao?.textContent).toContain("20,00");
    expect(cartao?.textContent).toContain("Desconto da loja");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("a nota 'vale só na opção mais barata' aparece embaixo da opção NÃO beneficiada", async () => {
    // A (mais barata, deliveryDays maior — não disputa 'mais rápida') ganha
    // o desconto; B (mais cara, deliveryDays menor — vence 'mais rápida')
    // não foi beneficiada. Os dois viram destaque direto (ofertas
    // diferentes), sem precisar expandir "+ Ver outras opções".
    const maisBarataComDesconto: ShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC com desconto",
      price: 20,
      precoCheio: 35,
      deliveryDays: 8,
      provider: "melhor_envio",
      estrategiaNacional: carimboDesconto,
    };
    const maisCaraSemDesconto: ShippingOption = {
      id: "frenet-sedex",
      name: "SEDEX sem desconto",
      price: 45,
      precoCheio: 45,
      deliveryDays: 3,
      provider: "frenet",
      estrategiaNacional: carimboDesconto,
    };
    await montarECotar(
      [item(produto())],
      [maisBarataComDesconto, maisCaraSemDesconto],
    );

    const cartaoBeneficiado = botaoDe("PAC com desconto");
    const cartaoNaoBeneficiado = botaoDe("SEDEX sem desconto");
    expect(cartaoBeneficiado?.textContent).not.toContain(
      "vale só na opção mais barata",
    );
    expect(cartaoNaoBeneficiado?.textContent).toContain(
      "O benefício da loja vale só na opção mais barata.",
    );
  });

  it("escolher a opção NÃO mais barata quando existe desconto na outra: o total do carrinho soma o preço CHEIO dela", async () => {
    const maisBarataComDesconto: ShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC com desconto",
      price: 20,
      precoCheio: 35,
      deliveryDays: 8,
      provider: "melhor_envio",
      estrategiaNacional: carimboDesconto,
    };
    const maisCaraSemDesconto: ShippingOption = {
      id: "frenet-sedex",
      name: "SEDEX sem desconto",
      price: 45,
      precoCheio: 45,
      deliveryDays: 3,
      provider: "frenet",
      estrategiaNacional: carimboDesconto,
    };
    await montarECotar(
      [item(produto())],
      [maisBarataComDesconto, maisCaraSemDesconto],
    );

    // A auto-seleção pega a mais barata (PAC, R$ 20) — a cliente troca de
    // propósito para a que NÃO tem desconto.
    expect(ultimoShippingFee).toBe(20);
    await act(async () => {
      botaoDe("SEDEX sem desconto")?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // O total cobrado é o preço CHEIO da opção ESCOLHIDA (R$ 45) — nunca o
    // preço com desconto da opção que a cliente não escolheu (R$ 20).
    expect(ultimoShippingFee).toBe(45);
  });
});

// @vitest-environment jsdom
//
// PASSO A2 do redesenho da tela "Finalizar pedido" (22/10/2026, aprovado pelo
// dono): a seção "Entrega e frete" do CHECKOUT (`modoResumo`) fica mais
// limpa — título "Entrega e frete" em texto normal, "Trocar" discreto no
// cabeçalho, a opção escolhida em destaque NEUTRO (borda forte + bolinha
// escura com check, nunca o amarelo da marca). Só apresentação: a cotação, o
// preço, o prazo, a escolha e os estados de erro/vazio são os de sempre — o
// carrinho (sem `modoResumo`) não muda NADA.
//
// Mesmo harness de shipping-calculator-modo-resumo.test.tsx.
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

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
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const PRODUTO: Product = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 50,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CARRINHO: CartItem[] = [{ product: PRODUTO, quantity: 1 }];

const PAC: ShippingOption = {
  id: "melhor-envio-1",
  name: "Entrega econômica",
  price: 26.41,
  deliveryDays: 8,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "PAC",
  provedorRotulo: "Melhor Envio",
};
const SEDEX: ShippingOption = {
  id: "melhor-envio-2",
  name: "Entrega expressa",
  price: 54.88,
  deliveryDays: 4,
  provider: "melhor_envio",
  transportadora: "Correios",
  servico: "SEDEX",
  provedorRotulo: "Melhor Envio",
};
const LOCAL_GRATIS: ShippingOption = {
  id: "local-delivery",
  name: "Entrega local",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — PASSO A2: Entrega e frete mais limpa no checkout", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
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
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [PAC, SEDEX], cotacaoIncompleta: false },
      error: null,
    });
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

  async function drenar() {
    await act(async () => {
      for (let i = 0; i < 12; i++) await Promise.resolve();
    });
  }

  async function montar(modoResumo: boolean | undefined) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    function Pai() {
      const [selecionada, setSelecionada] = useState<ShippingOption | null>(
        null,
      );
      const [cepDaSelecao, setCepDaSelecao] = useState<string | null>(null);
      useEffect(() => {}, [selecionada]);
      return (
        <ShippingCalculator
          cart={CARRINHO}
          selectedOption={selecionada}
          onSelectOption={setSelecionada}
          cepDestino="38500000"
          cepDaSelecao={cepDaSelecao}
          onCepValidated={setCepDaSelecao}
          destino={{ apelido: "Casa", resumo: "Rua A, 10 — Centro" }}
          modoResumo={modoResumo}
        />
      );
    }
    await act(async () => {
      raiz.render(<Pai />);
    });
    await drenar();
  }

  const secao = () =>
    hospedeiro.querySelector(
      'section[aria-label="Entrega e frete"]',
    ) as HTMLElement;
  const botaoDe = (nome: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    ) as HTMLButtonElement | undefined;

  it("checkout, opção escolhida: título 'Entrega e frete' em texto normal, destino mantido e 'Trocar' discreto no CABEÇALHO", async () => {
    await montar(true);
    const titulo = secao().querySelector("h2");
    expect(titulo?.textContent).toBe("Entrega e frete");
    // Texto normal: sem caixa-alta espaçada.
    expect(titulo?.className).not.toContain("uppercase");
    expect(titulo?.className).not.toContain("tracking-");
    // O destino segue na seção (nada some): "Entrega para Casa" + endereço.
    expect(secao().textContent).toContain("Entrega para Casa");
    expect(secao().textContent).toContain("Rua A, 10");
    // O endereço inteiro (com o CEP) é o que a cliente confere antes de pagar:
    // a linha de destino quebra em quantas linhas precisar, nunca corta com "…".
    const linhaDeDestino = Array.from(secao().querySelectorAll("p")).find((p) =>
      p.textContent?.includes("Entrega para Casa"),
    );
    expect(linhaDeDestino).toBeDefined();
    expect(linhaDeDestino?.className).not.toContain("line-clamp");

    const trocar = botaoDe("Trocar");
    expect(trocar).toBeDefined();
    expect(trocar?.className).toContain("min-h-11");
    // Discreto: cinza claro, não o botão preto de antes.
    expect(trocar?.className).toContain("bg-zinc-100");
    expect(trocar?.className).not.toContain("bg-zinc-900");
    // Mora no cabeçalho, fora do cartão da opção.
    const cartao = secao().querySelector(
      '[data-testid="opcao-de-frete-escolhida"]',
    ) as HTMLElement;
    expect(cartao).not.toBeNull();
    expect(cartao.contains(trocar as Node)).toBe(false);
  });

  it("a opção escolhida fica em destaque neutro: borda forte + bolinha escura com check, sem amarelo de marca; nome, prazo e preço intactos", async () => {
    await montar(true);
    const cartao = secao().querySelector(
      '[data-testid="opcao-de-frete-escolhida"]',
    ) as HTMLElement;
    expect(cartao.className).toContain("border-2");
    expect(cartao.className).toContain("border-zinc-900");
    expect(cartao.className).not.toContain("primary");
    const bolinha = cartao.querySelector(
      '[data-testid="selo-de-escolhida"]',
    ) as HTMLElement;
    expect(bolinha).not.toBeNull();
    expect(bolinha.className).toContain("bg-zinc-900");
    expect(bolinha.querySelector("svg")).not.toBeNull();
    expect(cartao.textContent).toContain("Entrega econômica");
    expect(cartao.textContent).toContain("26,41");
    expect(cartao.textContent).toContain("Entrega em até 8 dias úteis");
    // Só texto de apoio legível: nada de 9px nem de zinc-400 (2,6:1).
    expect(cartao.innerHTML).not.toContain("text-[9px]");
    expect(cartao.innerHTML).not.toContain("text-zinc-400");
  });

  it("entrega local grátis: 'Grátis' em verde escuro (AA), não no verde claro de antes", async () => {
    invoke.mockResolvedValue({
      data: { options: [LOCAL_GRATIS], cotacaoIncompleta: false },
      error: null,
    });
    await montar(true);
    const cartao = secao().querySelector(
      '[data-testid="opcao-de-frete-escolhida"]',
    ) as HTMLElement;
    const gratis = [...cartao.querySelectorAll("span")].find(
      (s) => s.textContent?.trim().toLowerCase() === "grátis",
    );
    expect(gratis).toBeDefined();
    expect(gratis?.className).toContain("text-emerald-700");
    expect(gratis?.className).not.toContain("text-emerald-500");
  });

  it("'Trocar' abre a lista: a opção marcada tem borda forte + check escuro (nunca bg-primary) e as outras, bolinha vazia", async () => {
    await montar(true);
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    const marcada = botaoDe("Entrega econômica") as HTMLButtonElement;
    const outra = botaoDe("Entrega expressa") as HTMLButtonElement;
    expect(marcada.getAttribute("aria-pressed")).toBe("true");
    expect(outra.getAttribute("aria-pressed")).toBe("false");
    expect(marcada.className).toContain("border-zinc-900");
    expect(marcada.className).not.toContain("bg-primary");
    expect(marcada.className).not.toContain("text-primary-foreground");
    expect(marcada.innerHTML).not.toContain("primary");
    expect(
      marcada.querySelector('[data-testid="selo-de-escolhida"]'),
    ).not.toBeNull();
    expect(outra.className).not.toContain("border-zinc-900");
    expect(outra.querySelector('[data-testid="selo-de-escolhida"]')).toBeNull();
    expect(outra.querySelector('[data-testid="bolinha-vazia"]')).not.toBeNull();
  });

  it("escolher outra opção continua recolhendo de volta ao resumo, já com a nova opção", async () => {
    await montar(true);
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    await act(async () => {
      botaoDe("Entrega expressa")?.click();
    });
    const cartao = secao().querySelector(
      '[data-testid="opcao-de-frete-escolhida"]',
    ) as HTMLElement;
    expect(cartao.textContent).toContain("Entrega expressa");
    expect(cartao.textContent).toContain("54,88");
    expect(botaoDe("Entrega econômica")).toBeUndefined();
  });

  it("erro de cotação no checkout: o aviso e 'Tentar de novo' continuam inteiros, e não aparece 'Trocar'", async () => {
    invoke.mockReset();
    invoke.mockRejectedValue(new Error("Falha ao cotar frete."));
    await montar(true);
    expect(hospedeiro.textContent).toContain("Falha ao cotar frete.");
    expect(botaoDe("Tentar de novo")).toBeDefined();
    expect(botaoDe("Trocar")).toBeUndefined();
    expect(secao().querySelector("h2")?.textContent).toBe("Entrega e frete");
  });

  it("'+ Ver outras opções' no checkout é um alvo de toque de 44 px e legível (AA); no carrinho segue discreto como era", async () => {
    const JADLOG: ShippingOption = {
      id: "melhor-envio-3",
      name: "Entrega Jadlog",
      price: 40,
      deliveryDays: 6,
      provider: "melhor_envio",
      transportadora: "Jadlog",
      servico: ".Package",
      provedorRotulo: "Melhor Envio",
    };
    const cotacao = {
      data: { options: [PAC, SEDEX, JADLOG], cotacaoIncompleta: false },
      error: null,
    };
    invoke.mockResolvedValue(cotacao);
    await montar(true);
    await act(async () => {
      botaoDe("Trocar")?.click();
    });
    const verOutras = botaoDe("Ver outras opções");
    expect(verOutras).toBeDefined();
    expect(verOutras?.className).toContain("min-h-11");
    // zinc-400 sobre branco não passa de 2,5:1; texto de ação usa zinc-600.
    expect(verOutras?.className).toContain("text-zinc-600");
    expect(verOutras?.className).not.toContain("text-zinc-400");
    expect(verOutras?.className).not.toContain("text-[10px]");

    // Carrinho: o botão antigo, intocado.
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar(undefined);
    const antigo = botaoDe("Ver outras opções");
    expect(antigo?.className).toContain("text-[10px]");
    expect(antigo?.className).toContain("text-zinc-400");
  });

  it("CARRINHO (sem modoResumo) não muda: cartão marcado segue com a cor da marca e o cabeçalho segue 'Entrega para <apelido>'", async () => {
    await montar(undefined);
    const marcada = botaoDe("Entrega econômica") as HTMLButtonElement;
    expect(marcada.className).toContain("bg-primary");
    expect(botaoDe("Trocar")).toBeUndefined();
    expect(secao().querySelector("h2")).toBeNull();
    expect(secao().textContent).toContain("Entrega para Casa");
    expect(
      secao().querySelector('[data-testid="selo-de-escolhida"]'),
    ).toBeNull();
  });
});

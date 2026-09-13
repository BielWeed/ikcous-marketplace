import type { CartItem, Product } from "@/types";
// @vitest-environment jsdom
//
// `useEconomiaDoFreteExibida` é o lado com EFEITO da economia do frete — a
// decisão pura mora em `src/lib/economia-do-frete.ts`
// (economia-do-frete-regra-pura.test.ts). Aqui prova-se o que só existe em
// runtime: quando a edge é chamada (e quando NUNCA é), debounce, cache por
// CEP, descarte de resposta velha (sequência), e o corte quando o
// carrinho/CEP muda no meio de uma cotação em voo.
//
// Mesmo padrão de render (react-dom/client + jsdom) de
// tests/front/checkout-summary-bar.test.tsx: uma "sonda" que só chama o
// hook e guarda o último valor, sem precisar de @testing-library/react
// (ausente do projeto).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de CheckoutView.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(overrides: Partial<Product> = {}): Product {
  return {
    id: overrides.id ?? "prod-1",
    name: overrides.name ?? "Produto Teste",
    description: "",
    price: overrides.price ?? 10,
    images: overrides.images ?? [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function carrinho(overrides: Partial<CartItem> = {}): CartItem[] {
  return [{ product: produto(), quantity: 1, ...overrides }];
}

let ultimoValor: number | undefined;
let limparCacheDeExibicao: () => void;

async function importarSonda() {
  const { useEconomiaDoFreteExibida, _limparCacheDeEconomiaDoFreteParaTeste } =
    await import("@/hooks/useEconomiaDoFreteExibida");
  limparCacheDeExibicao = _limparCacheDeEconomiaDoFreteParaTeste;
  return function Sonda(
    props: Parameters<typeof useEconomiaDoFreteExibida>[0],
  ) {
    ultimoValor = useEconomiaDoFreteExibida(props);
    return null;
  };
}

/** Debounce real do hook (`DEBOUNCE_MS`) + folga — mesmo padrão de
 * `esperarBarraMontar` em checkout-summary-bar.test.tsx: espera de verdade,
 * não fake timer (a suíte inteira do projeto evita fake timers). */
async function esperarDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
}

function paramsBase(overrides: Record<string, unknown> = {}) {
  return {
    freteGratis: true,
    cepDeEntrega: "01310-100",
    temUsuario: true,
    originCep: "38500-000",
    localCepRange: undefined,
    localDeliveryFee: 12.9,
    freeShippingMin: 0.01,
    cart: carrinho(),
    isOffline: false,
    ...overrides,
  };
}

describe("useEconomiaDoFreteExibida", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let Sonda: Awaited<ReturnType<typeof importarSonda>>;

  beforeEach(async () => {
    mockInvoke.mockReset();
    ultimoValor = undefined;
    Sonda = await importarSonda();
    // 🔴 AJUSTE 2 (revisão Opus): o cache agora mora no MÓDULO, não mais
    // num `useRef` por instância — sobrevive de propósito entre montagens
    // (é o ponto do ajuste), mas NUNCA pode sobreviver entre testes: sem
    // isto, o CEP "01310-100" (usado por várias `it`s aqui) chegaria em
    // cada teste novo já "quente" com o preço gravado por um teste
    // anterior, mascarando exatamente o que cada teste tenta provar.
    limparCacheDeExibicao();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    limparCacheDeExibicao();
    vi.restoreAllMocks();
  });

  function renderizar(props: Record<string, unknown>) {
    return act(async () => {
      raiz.render(<Sonda {...(props as any)} />);
    });
  }

  it("freteGratis falso: nunca chama a edge, economia 0", async () => {
    await renderizar(paramsBase({ freteGratis: false }));
    await esperarDebounce();
    expect(ultimoValor).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("CEP local: economia = localDeliveryFee, e a edge NUNCA é chamada (trava do crítico de desenho)", async () => {
    await renderizar(
      paramsBase({ cepDeEntrega: "38500-000", localDeliveryFee: 12.9 }),
    );
    await esperarDebounce();
    expect(ultimoValor).toBe(12.9);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("offline: fora da cidade não cota — economia 0, edge não chamada", async () => {
    await renderizar(paramsBase({ isOffline: true }));
    await esperarDebounce();
    expect(ultimoValor).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("carrinho vazio: fora da cidade não cota o vazio — economia 0, edge não chamada", async () => {
    await renderizar(paramsBase({ cart: [] }));
    await esperarDebounce();
    expect(ultimoValor).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("fora da cidade, logado, preset sempre: cota a edge e usa a MENOR opção retornada", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        options: [
          { id: "sedex", name: "Sedex", price: 32.5, deliveryDays: 3 },
          { id: "pac", name: "PAC", price: 19.9, deliveryDays: 7 },
        ],
      },
      error: null,
    });

    const cart = carrinho();
    await renderizar(paramsBase({ cart }));
    await esperarDebounce();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith("calculate-shipping", {
      body: { cep: "01310100", cart },
    });
    expect(ultimoValor).toBe(19.9);
  });

  it("falha da edge (error) -> economia 0, nunca um valor inventado", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error("boom") });

    await renderizar(paramsBase());
    await esperarDebounce();

    expect(ultimoValor).toBe(0);
  });

  it("edge lança exceção (rede caiu no meio) -> economia 0", async () => {
    mockInvoke.mockRejectedValue(new Error("network down"));

    await renderizar(paramsBase());
    await esperarDebounce();

    expect(ultimoValor).toBe(0);
  });

  it("cache por CEP: voltar para um CEP já cotado nesta sessão NÃO chama a edge de novo", async () => {
    mockInvoke.mockImplementation((_nome: string, opts: any) => {
      const cep = opts.body.cep;
      return Promise.resolve({
        data: {
          options: [
            {
              id: "x",
              name: "X",
              price: cep === "01310100" ? 20 : 30,
              deliveryDays: 1,
            },
          ],
        },
        error: null,
      });
    });

    await renderizar(paramsBase({ cepDeEntrega: "01310-100" }));
    await esperarDebounce();
    expect(ultimoValor).toBe(20);
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    await renderizar(paramsBase({ cepDeEntrega: "04567-000" }));
    await esperarDebounce();
    expect(ultimoValor).toBe(30);
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    // Volta para o primeiro CEP, mesmo carrinho: cache já tem a resposta.
    await renderizar(paramsBase({ cepDeEntrega: "01310-100" }));
    // Cache é síncrono (não precisa do debounce) — mas espera mesmo assim
    // para provar que NENHUMA chamada nova acontece, nem atrasada.
    await esperarDebounce();
    expect(ultimoValor).toBe(20);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("carrinho mudou: a economia velha some NA HORA (nunca mostra um número que não é mais deste carrinho), e recota", async () => {
    let resolverA: (v: unknown) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolverA = resolve;
        }),
    );

    const carrinhoA = carrinho({ quantity: 1 });
    await renderizar(paramsBase({ cart: carrinhoA }));
    // Espera o debounce disparar a chamada de verdade — só ENTÃO
    // `resolverA` está ligado à promise que o hook está aguardando.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    await act(async () => {
      resolverA({
        data: { options: [{ id: "x", name: "X", price: 25, deliveryDays: 1 }] },
        error: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ultimoValor).toBe(25);

    mockInvoke.mockResolvedValueOnce({
      data: { options: [{ id: "y", name: "Y", price: 40, deliveryDays: 2 }] },
      error: null,
    });
    const carrinhoB = carrinho({ quantity: 3 });
    await renderizar(paramsBase({ cart: carrinhoB }));
    // Antes do debounce/resposta nova, o valor do carrinho ANTERIOR não
    // pode continuar na tela.
    expect(ultimoValor).toBe(0);

    await esperarDebounce();
    expect(ultimoValor).toBe(40);
  });

  it("🔴 AJUSTE 2 (revisão Opus): cache sobrevive a DESMONTAR e REMONTAR o checkout (mesmo CEP + carrinho) — nunca grava uma 2ª linha em shipping_calculation_logs por causa de uma revisita", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        options: [{ id: "x", name: "X", price: 22.5, deliveryDays: 2 }],
      },
      error: null,
    });

    const cart = carrinho();
    const params = paramsBase({ cepDeEntrega: "01310-100", cart });

    // 1ª visita: monta, cota, DESMONTA de verdade (troca de aba, sair do
    // checkout e voltar — o cenário do achado da revisão, não só um
    // re-render do mesmo componente).
    await renderizar(params);
    await esperarDebounce();
    expect(ultimoValor).toBe(22.5);
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();

    // 2ª visita: host, root e componente NOVOS — só o módulo (import
    // resolvido uma única vez pelo runner) continua o mesmo, que é
    // exatamente o que guarda o cache agora.
    ultimoValor = undefined;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);

    await renderizar(paramsBase({ cepDeEntrega: "01310-100", cart }));
    await esperarDebounce();

    expect(ultimoValor).toBe(22.5);
    // A prova do ajuste: NENHUMA chamada nova à edge na revisita.
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    // Mudar o carrinho continua cotando de verdade — o cache é POR
    // assinatura de CEP+carrinho, não um interruptor global "já visitou".
    mockInvoke.mockResolvedValueOnce({
      data: {
        options: [{ id: "y", name: "Y", price: 41, deliveryDays: 1 }],
      },
      error: null,
    });
    const carrinhoMaior = carrinho({ quantity: 5 });
    await renderizar(
      paramsBase({ cepDeEntrega: "01310-100", cart: carrinhoMaior }),
    );
    await esperarDebounce();

    expect(ultimoValor).toBe(41);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("resposta atrasada de um CEP antigo não sobrescreve o CEP atual (guarda de sequência)", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    mockInvoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    await renderizar(paramsBase({ cepDeEntrega: "01310-100" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    // A chamada do CEP A está pendurada (resolvers[0] ainda não resolvido).
    expect(resolvers).toHaveLength(1);

    await renderizar(paramsBase({ cepDeEntrega: "04567-000" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(resolvers).toHaveLength(2);

    // Resolve a chamada do CEP B primeiro, DEPOIS a do CEP A (fora de ordem).
    await act(async () => {
      resolvers[1]({
        data: { options: [{ id: "b", name: "B", price: 50, deliveryDays: 1 }] },
        error: null,
      });
    });
    expect(ultimoValor).toBe(50);

    await act(async () => {
      resolvers[0]({
        data: { options: [{ id: "a", name: "A", price: 10, deliveryDays: 1 }] },
        error: null,
      });
    });
    // A resposta obsoleta (CEP A) não pode reaparecer por cima do CEP B atual.
    expect(ultimoValor).toBe(50);
  });
});

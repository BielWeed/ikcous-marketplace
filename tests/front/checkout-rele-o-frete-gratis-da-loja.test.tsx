// @vitest-environment jsdom
//
// O FRETE GRÁTIS QUE A TELA GUARDA (27/11/2026) — venda perdida em laço.
//
// DEFEITO MEDIDO: a loja dá frete grátis na entrega local acima de R$ 100; a
// cliente monta R$ 150 e vê "Grátis". Com o checkout aberto, a lojista sobe o
// mínimo para R$ 300. Quem zera a entrega local é a TELA (`precoFinalDaOpcao`
// com a configuração guardada no aparelho); a cotação devolve a taxa cheia. A
// conferência de revisão via a mudança e cotava de novo, mas a configuração
// continuava a velha: "Grátis" de novo, e o servidor (que recalcula pelo
// `store_config`) recusava com "Os valores do pedido mudaram". "Atualizar o
// carrinho" relia só os produtos — a cliente ficava em laço até trocar de aba
// ou recarregar. O inverso (a lojista CRIA o grátis) travava igual.
//
// Aqui a configuração da tela é um estado de verdade (a releitura a troca e a
// tela renderiza de novo), o preço do frete sai da regra REAL
// (`precoFinalDaOpcao`) e o "servidor" é o dublê de `createOrder`, que recusa
// quando o frete enviado diverge do que a configuração dele cobra.
//
// Harness de checkout-view-revisao-do-frete-antes-de-fechar.test.tsx.
import { act, useSyncExternalStore } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

type ConfigDeTeste = {
  shippingCoverage: string;
  originCep: string;
  enableCoupons: boolean;
  freeShippingMin: number;
  shippingFee: number;
};

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

const RECUSA_DOS_VALORES = {
  code: "P0001",
  message:
    "Os valores do pedido mudaram. Atualize o carrinho e tente novamente.",
};

const mundo = vi.hoisted(() => ({
  // O que a TELA tem (cópia do aparelho) e o que o SERVIDOR tem.
  configDaTela: null as unknown as ConfigDeTeste,
  configDoServidor: null as unknown as ConfigDeTeste,
  ouvintes: new Set<() => void>(),
  selecionada: null as null | {
    id: string;
    name: string;
    price: number;
    deliveryDays: number;
    provider: string;
  },
  // A releitura que a tela pediu fica pendurada até o teste soltar.
  segurarReleitura: false,
  soltarReleitura: null as null | (() => void),
}));

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const invoke = vi.fn();
const refresh = vi.fn(async (_opcoes?: { onlyConfig?: boolean }) => {
  const aplicar = () => {
    mundo.configDaTela = { ...mundo.configDoServidor };
    for (const ouvir of mundo.ouvintes) ouvir();
  };
  if (!mundo.segurarReleitura) {
    aplicar();
    return;
  }
  await new Promise<void>((resolve) => {
    mundo.soltarReleitura = () => {
      aplicar();
      resolve();
    };
  });
});
const shippingCalculatorProps: Array<{ forcarNovaCotacaoEm?: number }> = [];

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return {
    ...real,
    ShippingCalculator: (props: { forcarNovaCotacaoEm?: number }) => {
      shippingCalculatorProps.push({
        forcarNovaCotacaoEm: props.forcarNovaCotacaoEm,
      });
      return null;
    },
  };
});

vi.mock("@/contexts/StoreContext", () => {
  const assinar = (ouvir: () => void) => {
    mundo.ouvintes.add(ouvir);
    return () => {
      mundo.ouvintes.delete(ouvir);
    };
  };
  const lerConfig = () => mundo.configDaTela;
  return {
    useStore: () => {
      const config = useSyncExternalStore(assinar, lerConfig);
      return {
        config,
        isLoaded: true,
        refresh: (opcoes?: { onlyConfig?: boolean }) => refresh(opcoes),
      };
    },
  };
});

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: [
        {
          id: "addr-1",
          user_id: "user-1",
          name: "Casa",
          recipient_name: "Cliente Teste",
          cep: "38500-000",
          street: "Rua Teste",
          number: "100",
          neighborhood: "Centro",
          city: "Monte Carmelo",
          state: "MG",
          is_default: true,
        },
      ],
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const setSelectedShippingOption = vi.fn(
  (opcao: (typeof mundo)["selecionada"]) => {
    mundo.selecionada = opcao;
  },
);

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  const { precoFinalDaOpcao } = await import("@/lib/estrategias-de-frete");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            description: "",
            price: 150,
            images: [],
            category: "geral",
            stock: 10,
            sold: 0,
            isActive: true,
            isBestseller: false,
            freeShipping: false,
            createdAt: new Date().toISOString(),
          },
          quantity: 1,
        },
      ],
      cartTotal: 150,
      // A MESMA conta do CartContext: o preço final da opção escolhida sai
      // da configuração que a TELA tem agora.
      shippingFee: mundo.selecionada
        ? precoFinalDaOpcao(mundo.selecionada, {
            config: mundo.configDaTela,
            subtotal: 150,
            temItemMarcado: false,
          })
        : mundo.configDaTela.shippingFee,
      clearCart,
      selectedShippingOption: mundo.selecionada,
      shippingCep: "38500-000",
      setSelectedShippingOption,
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function configDaLoja(freeShippingMin: number): ConfigDeTeste {
  return {
    shippingCoverage: "national",
    originCep: "38500-000",
    enableCoupons: false,
    freeShippingMin,
    shippingFee: 15,
  };
}

describe("CheckoutView — a configuração de frete grátis que mudou com o checkout aberto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockClear();
    toastError.mockReset();
    setSelectedShippingOption.mockClear();
    invoke.mockReset();
    refresh.mockClear();
    shippingCalculatorProps.length = 0;
    mundo.ouvintes.clear();
    mundo.segurarReleitura = false;
    mundo.soltarReleitura = null;
    mundo.selecionada = { ...ENTREGA_LOCAL };
    // O "servidor": recalcula o frete pela configuração DELE e recusa quando
    // o que a tela mandou diverge (a RPC tolera R$ 0,05).
    createOrder.mockImplementation(
      async (orderData: { shippingCost: number }) => {
        const { precoFinalDaOpcao } = await import(
          "@/lib/estrategias-de-frete"
        );
        const cobrado = precoFinalDaOpcao(ENTREGA_LOCAL, {
          config: mundo.configDoServidor,
          subtotal: 150,
          temItemMarcado: false,
        });
        if (Math.abs(orderData.shippingCost - cobrado) > 0.05) {
          throw { ...RECUSA_DOS_VALORES };
        }
        return { id: "ped-aceito", totalAmount: 150 + cobrado };
      },
    );
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

  async function gravarEnvelope(revisaoConfig: string) {
    const { chaveDoCacheDeFrete } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    armazem.set(
      chaveDoCacheDeFrete("38500000"),
      JSON.stringify({
        opcoes: [ENTREGA_LOCAL],
        revisaoConfig,
        gravadoEm: Date.now(),
        assinatura: "prod-1:1",
        contexto: "cotacao-3",
      }),
    );
  }

  async function renderizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  async function montarEPreencher() {
    await renderizar();
    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  }

  // Pelo rótulo acessível: enquanto envia, o botão troca o texto por um
  // indicador de carregamento.
  function botaoFinalizar() {
    return document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Finalizar pedido"]',
    )!;
  }

  function textoDaTela() {
    return (document.body.textContent ?? "").replace(/\s/g, " ");
  }

  async function tocarEmFinalizar() {
    expect(botaoFinalizar().disabled).toBe(false);
    await act(async () => {
      botaoFinalizar().click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  // A cotação nova que a calculadora faz depois de `forcarNovaCotacaoEm`: a
  // edge devolve a taxa CHEIA da entrega local e uma revisão nova.
  async function cotacaoNovaChega() {
    await gravarEnvelope("rev-nova");
    mundo.selecionada = { ...ENTREGA_LOCAL };
    await renderizar();
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("a lojista SOBE o mínimo do grátis: a revisão diverge, a tela relê a configuração junto da cotação, e o toque seguinte fecha com o frete que o servidor cobra", async () => {
    mundo.configDaTela = configDaLoja(100);
    mundo.configDoServidor = configDaLoja(300);
    await gravarEnvelope("rev-velha");
    invoke.mockResolvedValue({
      data: { revisaoConfig: "rev-nova" },
      error: null,
    });

    await montarEPreencher();
    // A tela mostra o grátis velho: total = só o subtotal.
    expect(textoDaTela()).not.toContain("R$ 160,00");
    await tocarEmFinalizar();

    // 1º toque: nada nasce, o aviso de frete que mudou aparece e a tela
    // relê a configuração da loja ALÉM de pedir a cotação nova.
    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("O frete mudou, calcule de novo.");
    expect(refresh).toHaveBeenCalledWith({ onlyConfig: true });
    expect(mundo.configDaTela.freeShippingMin).toBe(300);

    await cotacaoNovaChega();
    // O total na tela muda: R$ 150 + R$ 10 da entrega, o mesmo do servidor.
    expect(textoDaTela()).toContain("R$ 160,00");
    await tocarEmFinalizar();

    // 2º toque: o pedido vai com os R$ 10 que o servidor cobra — sem laço.
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].shippingCost).toBe(10);
    await expect(createOrder.mock.results[0].value).resolves.toMatchObject({
      id: "ped-aceito",
    });
  });

  it("a releitura da configuração demora: o Finalizar só volta quando ela chega, nunca com o grátis velho", async () => {
    mundo.configDaTela = configDaLoja(100);
    mundo.configDoServidor = configDaLoja(300);
    mundo.segurarReleitura = true;
    await gravarEnvelope("rev-velha");
    invoke.mockResolvedValue({
      data: { revisaoConfig: "rev-nova" },
      error: null,
    });

    await montarEPreencher();
    await tocarEmFinalizar();
    await cotacaoNovaChega();

    // A cotação nova já está na tela, mas a configuração ainda não: tocar
    // agora mandaria o grátis velho. O botão espera.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(botaoFinalizar().disabled).toBe(true);

    await act(async () => {
      mundo.soltarReleitura?.();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await tocarEmFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].shippingCost).toBe(10);
  });

  it("a releitura da configuração nunca chega: o teto solta o Finalizar (a cliente não fica presa)", async () => {
    mundo.configDaTela = configDaLoja(100);
    mundo.configDoServidor = configDaLoja(300);
    mundo.segurarReleitura = true;
    await gravarEnvelope("rev-velha");
    invoke.mockResolvedValue({
      data: { revisaoConfig: "rev-nova" },
      error: null,
    });
    const agendar = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, prazo, ...args) =>
        agendar(callback, prazo === 3000 ? 1 : prazo, ...args),
    );

    await montarEPreencher();
    await tocarEmFinalizar();
    await act(async () => {
      await new Promise((resolve) => agendar(resolve, 20));
    });
    await cotacaoNovaChega();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it.each([
    {
      caso: "a lojista SOBE o mínimo do grátis",
      naTela: 100,
      noServidor: 300,
      freteCerto: 10,
    },
    {
      caso: "a lojista CRIA o grátis",
      naTela: 0,
      noServidor: 100,
      freteCerto: 0,
    },
  ])(
    "$caso e o servidor recusa com 'Os valores do pedido mudaram': a tela relê a configuração e o toque seguinte fecha",
    async ({ naTela, noServidor, freteCerto }) => {
      // Sem envelope de revisão (cotação de antes da 1.5.7): a conferência
      // prévia não tem o que comparar e quem pega a divergência é o servidor.
      mundo.configDaTela = configDaLoja(naTela);
      mundo.configDoServidor = configDaLoja(noServidor);

      await montarEPreencher();
      await tocarEmFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(1);
      await expect(createOrder.mock.results[0].value).rejects.toMatchObject(
        RECUSA_DOS_VALORES,
      );
      expect(refresh).toHaveBeenCalledWith({ onlyConfig: true });

      await act(async () => {
        await esperarMicrotarefas();
      });
      await tocarEmFinalizar();

      expect(createOrder).toHaveBeenCalledTimes(2);
      expect(createOrder.mock.calls[1][0].shippingCost).toBe(freteCerto);
      await expect(createOrder.mock.results[1].value).resolves.toMatchObject({
        id: "ped-aceito",
      });
    },
  );
});

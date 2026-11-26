// @vitest-environment jsdom
//
// CHECKOUT: ENDEREÇO AO VOLTAR AO APP (dois aparelhos).
//
// O Carrinho e o Perfil relêem a lista de endereços quando a cliente volta do
// segundo plano; o checkout -- a tela em que ela CONFIRMA o endereço e paga --
// só lia ao montar. Com dois aparelhos (endereço editado ou apagado no outro),
// o resumo e o CEP do frete mostravam o endereço VELHO. Agora o checkout relê,
// em silêncio, ao voltar (com a guarda de 30 s) e o efeito "endereço escolhido
// que saiu da lista" passa a escolha ao principal que sobrou.
//
// O banco é um dublê: o "outro aparelho" mexe nele DIRETAMENTE.
import type { CartItem, Product } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concluirBuscaDeCepSemEndereco } from "./duble-busca-de-cep";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const createOrder = vi.fn();
const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};

const RETIRADA = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
};
const AVISO_DE_ENDERECO_NAO_CONFIRMADO =
  "Não consegui confirmar o endereço. Tente de novo.";
let opcaoDeFrete = ENTREGA_LOCAL;

const { conta, banco, escolha } = vi.hoisted(() => ({
  conta: { usuario: { id: "user-1" } as { id: string } | null },
  banco: {
    linhas: [] as Array<Record<string, unknown>>,
    leituras: 0,
    falharLeitura: false,
    proximaLeitura: null as Promise<void> | null,
  },
  // O id do endereço escolhido, como o CartContext o guarda: UM valor, lido por
  // todos os que chamam `useCart` (o checkout e os hooks dele).
  escolha: {
    id: null as string | null,
    ouvintes: new Set<() => void>(),
  },
}));

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      freeShippingMin: 0,
      enableCoupons: false,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { useSyncExternalStore } = await import("react");
  const assinar = (ouvinte: () => void) => {
    escolha.ouvintes.add(ouvinte);
    return () => {
      escolha.ouvintes.delete(ouvinte);
    };
  };
  const setEnderecoSelecionadoId = (id: string | null) => {
    escolha.id = id;
    for (const ouvinte of escolha.ouvintes) ouvinte();
  };
  function useCartDeTeste() {
    const enderecoSelecionadoId = useSyncExternalStore(
      assinar,
      () => escolha.id,
    );
    return {
      cart: CART,
      cartTotal: 80,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      freteGratis: false,
      selectedShippingOption: opcaoDeFrete,
      freteIndefinido: false,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
    };
  }
  return { useCart: useCartDeTeste };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    from: () => {
      const cadeia: any = {
        select: () => cadeia,
        eq: () => cadeia,
        order: () => cadeia,
        // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          banco.leituras++;
          const resposta = banco.falharLeitura
            ? { data: null, error: { message: "rede caiu" } }
            : { data: [...banco.linhas], error: null };
          const espera = banco.proximaLeitura;
          banco.proximaLeitura = null;
          return Promise.resolve(espera)
            .then(() => resposta)
            .then(ok, ko);
        },
      };
      return cadeia;
    },
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PRODUTO: Product = {
  id: "prod-1",
  name: "Camiseta",
  description: "",
  price: 80,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};
const CART: CartItem[] = [{ product: PRODUTO, quantity: 1 }];

let contador = 0;
function linha(id: string, cep: string, principal: boolean) {
  return {
    id,
    user_id: "user-1",
    name: id,
    recipient_name: "Cliente Teste",
    cep,
    street: `Rua ${id}`,
    number: "10",
    complement: null,
    neighborhood: "Centro",
    city: "Monte Carmelo",
    state: "MG",
    reference: null,
    is_default: principal,
    created_at: ++contador,
  };
}

let estadoDaVisibilidade: "visible" | "hidden" = "visible";

describe("CheckoutView -- relê os endereços ao voltar ao app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    await esperar(50);
  }

  async function esperar(ms: number) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function voltarDoSegundoPlano(depoisDeMs: number) {
    await act(async () => {
      estadoDaVisibilidade = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      vi.setSystemTime(Date.now() + depoisDeMs);
      estadoDaVisibilidade = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    await esperar(50);
  }

  beforeEach(async () => {
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    conta.usuario = { id: "user-1" };
    banco.linhas = [
      linha("addr-x", "01310-100", true),
      linha("addr-z", "30100-000", false),
    ];
    banco.leituras = 0;
    banco.falharLeitura = false;
    banco.proximaLeitura = null;
    opcaoDeFrete = ENTREGA_LOCAL;
    escolha.id = null;
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    createOrder.mockReset().mockResolvedValue({ id: "ped-1", totalAmount: 80 });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    globalThis.sessionStorage.clear();
    estadoDaVisibilidade = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => estadoDaVisibilidade,
    });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("o endereço escolhido foi apagado no outro aparelho: ao voltar (>30 s) a lista é lida de novo e a escolha passa ao principal que sobrou", async () => {
    await montar();
    expect(banco.leituras).toBe(1);
    expect(escolha.id).toBe("addr-x");

    // No outro aparelho: o endereço escolhido foi apagado, sobrou o Y.
    banco.linhas = [linha("addr-y", "38400-123", true)];
    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(escolha.id).toBe("addr-y");
  });

  it("voltar do segundo plano antes de 30 s não consulta de novo: a escolha fica", async () => {
    await montar();
    banco.linhas = [linha("addr-y", "38400-123", true)];

    await voltarDoSegundoPlano(10_000);

    expect(banco.leituras).toBe(1);
    expect(escolha.id).toBe("addr-x");
  });

  it("sem rede ao voltar: a lista e a escolha que a tela já tinha continuam, sem aviso", async () => {
    const { toast } = await import("sonner");
    await montar();
    vi.spyOn(console, "error").mockImplementation(() => {});
    banco.falharLeitura = true;

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(2);
    expect(toast.error).not.toHaveBeenCalled();
    expect(escolha.id).toBe("addr-x");
  });

  async function prepararEntrega(campos: [string, string][] = []) {
    await montar();
    for (const [id, valor] of [
      ["checkout-name", "Cliente Teste"],
      ["checkout-tel", "34999999999"],
      ...campos,
    ]) {
      await act(async () => {
        const campo = document.getElementById(id) as HTMLInputElement;
        const setter = Object.getOwnPropertyDescriptor(
          globalThis.HTMLInputElement.prototype,
          "value",
        )!.set!;
        setter.call(campo, valor);
        campo.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await esperar(420);
  }

  async function finalizar(doisToques = false) {
    const botao = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Finalizar pedido"]',
    );
    expect(botao?.disabled).toBe(false);
    await act(async () => {
      botao!.click();
      if (doisToques) botao!.click();
    });
  }

  it("número diferente no mesmo CEP não cria pedido até a cliente conferir", async () => {
    const { toast } = await import("sonner");
    await prepararEntrega();
    expect(document.body.textContent).toContain("Rua addr-x, 10");

    banco.linhas[0] = { ...banco.linhas[0], number: "20" };
    await finalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "O endereço de entrega foi alterado em outro aparelho. Confira o novo endereço e finalize de novo.",
    );
    expect(document.body.textContent).toContain("Rua addr-x, 20");

    await finalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0]).toMatchObject({ addressId: "addr-x" });
  });

  it("endereço igual confirma o pedido uma vez, mesmo com dois toques", async () => {
    await prepararEntrega();
    await finalizar(true);

    expect(banco.leituras).toBe(2);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  function atrasarProximaLeitura() {
    let liberar!: () => void;
    banco.proximaLeitura = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    return liberar;
  }

  it("falha da releitura bloqueia a compra; Tentar de novo relê antes de enviar", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    await prepararEntrega();
    vi.spyOn(console, "error").mockImplementation(() => {});
    banco.falharLeitura = true;

    await finalizar();

    expect(banco.leituras).toBe(2);
    expect(createOrder).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(AVISO_DE_ENDERECO_NAO_CONFIRMADO);
    const aviso = [...document.querySelectorAll('[role="alert"]')].find((el) =>
      el.textContent?.includes(AVISO_DE_ENDERECO_NAO_CONFIRMADO),
    );
    const tentar = aviso?.querySelector("button");
    expect(tentar?.textContent).toBe("Tentar de novo");

    banco.falharLeitura = false;
    await act(async () => tentar!.click());

    expect(banco.leituras).toBe(3);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("aguarda durante a releitura e bloqueia o pedido só quando o prazo estoura", async () => {
    await prepararEntrega();
    const { PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS } = await import(
      "@/hooks/useAddresses"
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const agora = Date.now();
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(agora);
    const liberar = atrasarProximaLeitura();

    await finalizar();
    expect(banco.leituras).toBe(2);
    await act(async () =>
      vi.advanceTimersByTimeAsync(PRAZO_DAS_CHAMADAS_DE_ENDERECO_MS - 1),
    );

    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Finalizar pedido"]',
      )?.disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toContain(
      AVISO_DE_ENDERECO_NAO_CONFIRMADO,
    );
    expect(createOrder).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(createOrder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      AVISO_DE_ENDERECO_NAO_CONFIRMADO,
    );

    await act(async () => liberar());
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("releitura superada pelo retorno ao app não confirma o endereço do clique", async () => {
    await prepararEntrega();
    const liberar = atrasarProximaLeitura();

    await finalizar();
    expect(banco.leituras).toBe(2);

    // A consulta de fundo vence com a MESMA rua/número: só a falta da
    // confirmação do clique explica a recusa.
    await voltarDoSegundoPlano(40_000);
    expect(banco.leituras).toBe(3);
    expect(createOrder).not.toHaveBeenCalled();
    await act(async () => liberar());

    expect(createOrder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      AVISO_DE_ENDERECO_NAO_CONFIRMADO,
    );
  });

  it("só a referência mudou no outro aparelho: pede conferência antes de enviar", async () => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    await prepararEntrega();
    banco.linhas[0] = { ...banco.linhas[0], reference: "Portão azul" };

    await finalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "O endereço de entrega foi alterado em outro aparelho. Confira o novo endereço e finalize de novo.",
    );
    expect(document.body.textContent).toContain("Portão azul");

    await finalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("referência nula e vazia são o mesmo endereço e não impedem o pedido", async () => {
    await prepararEntrega();
    banco.linhas[0] = { ...banco.linhas[0], reference: "" };

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("espaços nas pontas da referência não mudam o endereço", async () => {
    banco.linhas[0] = { ...banco.linhas[0], reference: "Portão azul" };
    await prepararEntrega();
    banco.linhas[0] = { ...banco.linhas[0], reference: "  Portão azul  " };

    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  // A retirada relê só para saber se o endereço escolhido ainda existe
  // (checkout-retirada-endereco-apagado-em-outro-aparelho.test.tsx); nada é
  // entregue nele, então a releitura sem resposta NÃO trava o pedido.
  it("retirada com conta: a releitura que falha não trava o pedido", async () => {
    opcaoDeFrete = RETIRADA;
    await prepararEntrega();
    banco.falharLeitura = true;
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();

    await finalizar();

    expect(banco.leituras).toBe(2);
    expect(toast.error).not.toHaveBeenCalledWith(
      AVISO_DE_ENDERECO_NAO_CONFIRMADO,
    );
    expect(createOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ shippingOptionId: "store-pickup" }),
      { comPagamentoOnline: false },
    );
  });

  it("visitante envia o endereço digitado sem consultar endereço salvo", async () => {
    conta.usuario = null;
    concluirBuscaDeCepSemEndereco();
    await prepararEntrega([
      ["guest-cep", "38500000"],
      ["guest-street", "Rua Teste"],
      ["guest-number", "100"],
      ["guest-neighborhood", "Centro"],
      ["guest-city", "Monte Carmelo"],
      ["guest-state", "MG"],
    ]);

    await finalizar();

    expect(banco.leituras).toBe(0);
    expect(createOrder).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        addressId: null,
        addressData: expect.objectContaining({ street: "Rua Teste" }),
      }),
      { comPagamentoOnline: false },
    );
  });

  it("visitante (sem conta): voltar ao app não consulta endereço nenhum", async () => {
    conta.usuario = null;
    await montar();

    await voltarDoSegundoPlano(40_000);

    expect(banco.leituras).toBe(0);
  });
});

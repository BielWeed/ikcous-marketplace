// @vitest-environment jsdom
//
// CARRINHO-03 no checkout de CONVIDADO: a mesma cópia do callback de
// AddressForm.tsx existe em CheckoutView.tsx, e ali é pior porque o CEP já
// chega pré-preenchido de `ikcous_last_shipping_cep` (linha ~262). Uma
// primeira busca preenche rua/bairro; se a pessoa troca de ideia e digita um
// CEP de localidade única (sem rua/bairro no ViaCEP), os campos da busca
// ANTERIOR não podem sobreviver misturados com a cidade/estado da busca
// nova.
//
// Par de address-form-troca-cep-nao-mistura-endereco-antigo.test.tsx, mas
// no checkout de convidado (sem `initialData` — a "fonte antiga" aqui vem de
// uma busca anterior na mesma sessão, não de um endereço salvo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const createOrder = vi.fn(async () => ({ id: "pedido-teste-1234" }));

const { mockConfig, frete } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national",
    originCep: "38500-000",
    localCepRange: "",
  },
  frete: { cep: "" },
}));

vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
      {
        product: {
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
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: 0,
    clearCart: vi.fn(),
    selectedShippingOption: frete.cep
      ? {
          id: "local-delivery",
          name: "Entrega Local",
          price: 0,
          deliveryDays: 1,
          provider: "local",
        }
      : null,
    shippingCep: frete.cep,
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useOrders")>()),
  useOrders: () => ({ createOrder }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchResolver = (data: unknown) => void;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CheckoutView (convidado) — trocar o CEP não mistura rua antiga com cidade nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let armazem: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
    frete.cep = "";
    createOrder.mockClear();
    sessionStorage.clear();
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
    fetchMock = vi.fn((url: string) => {
      if (url.includes("opencep.com")) {
        return Promise.resolve({ json: async () => ({ error: true }) });
      }
      if (url.includes("awesomeapi.com.br")) {
        return Promise.resolve({ json: async () => ({ code: "not_found" }) });
      }
      const cep = /viacep\.com\.br\/ws\/(\d+)\/json/.exec(url)?.[1] ?? "";
      return new Promise((resolve) => {
        pendentes.set(cep, (data: unknown) =>
          resolve({ json: () => Promise.resolve(data) } as Response),
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);
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
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "",
    });
  });

  async function montar() {
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

  const campo = (id: string) => document.getElementById(id) as HTMLInputElement;
  const finalizar = () =>
    document.querySelector<HTMLButtonElement>(
      'button[aria-label="Finalizar pedido"]',
    )!;

  function onClickReal(botao: HTMLButtonElement): () => void {
    // Mesmo método dos testes de guarda do checkout: click() no botão
    // desabilitado não chama o React e não exercita a guarda de envio.
    const props = Object.keys(botao).find((k) => k.startsWith("__reactProps$"));
    expect(props, "props do botão Finalizar").toBeDefined();
    const { onClick } = (
      botao as unknown as Record<string, { onClick?: () => void }>
    )[props!];
    expect(onClick, "onClick real do botão Finalizar").toBeTypeOf("function");
    return onClick!;
  }

  async function responderEndereco(cep: string) {
    await act(async () => {
      pendentes.get(cep)!({
        logradouro: cep === "38500000" ? "Rua Antiga" : "Rua Nova",
        bairro: "Centro",
        localidade: "Monte Carmelo",
        uf: "MG",
      });
    });
  }

  it("frete do CEP novo pronto antes do endereço ainda não permite finalizar a entrega", async () => {
    mockConfig.shippingCoverage = "local";
    mockConfig.localCepRange = "38500-000";
    frete.cep = "38500-000";
    await montar();
    await act(async () => digitar("guest-cep", "38500000"));
    await responderEndereco("38500000");
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-number", "77");
    });
    expect(finalizar().disabled).toBe(false);

    mockConfig.localCepRange = "38500-001";
    frete.cep = "38500-001";
    await act(async () => digitar("guest-cep", "38500001"));
    expect(pendentes.has("38500001")).toBe(true);
    // Frete e todos os campos de B válidos; só a busca pendente bloqueia.
    await act(async () => {
      digitar("guest-number", "88");
      digitar("guest-street", "Rua Nova");
      digitar("guest-neighborhood", "Centro");
      digitar("guest-city", "Monte Carmelo");
      digitar("guest-state", "MG");
    });
    expect(finalizar().disabled).toBe(true);
    expect(document.body.textContent).toContain("Buscando o endereço do CEP…");
    await act(async () => onClickReal(finalizar())());
    expect(createOrder).not.toHaveBeenCalled();

    await responderEndereco("38500001");
    expect(finalizar().disabled).toBe(false);
    expect(document.body.textContent).not.toContain(
      "Buscando o endereço do CEP…",
    );
    await act(async () => finalizar().click());
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        addressData: expect.objectContaining({
          cep: "38500-001",
          number: "88",
          street: "Rua Nova",
        }),
      }),
      expect.anything(),
    );
  });

  it.each([
    {
      caso: "B traz somente cidade e UF",
      resposta: { localidade: "Cidade B", uf: "SP" },
      cidade: "Cidade B",
      uf: "SP",
    },
    {
      caso: "a busca de B também não encontra o endereço",
      resposta: { erro: true },
      cidade: "",
      uf: "",
    },
  ])(
    "não envia o endereço manual de A quando $caso",
    async ({ resposta, cidade, uf }) => {
      mockConfig.shippingCoverage = "local";
      mockConfig.localCepRange = "38500-000";
      frete.cep = "38500-000";
      await montar();
      await act(async () => digitar("guest-cep", "38500000"));
      await act(async () => pendentes.get("38500000")!({ erro: true }));
      expect(campo("guest-cep").readOnly).toBe(false);
      await act(async () => {
        digitar("checkout-name", "Cliente Teste");
        digitar("checkout-tel", "34999999999");
        digitar("guest-street", "Rua de A");
        digitar("guest-neighborhood", "Bairro de A");
        digitar("guest-city", "Cidade A");
        digitar("guest-state", "MG");
        digitar("guest-number", "77");
        digitar("guest-complement", "Fundos de A");
      });
      expect(finalizar().disabled).toBe(false);

      await act(async () => digitar("guest-cep", "3850000"));
      await act(async () => digitar("guest-cep", "38500000"));
      await act(async () => pendentes.get("38500000")!({ erro: true }));
      expect(campo("guest-street").value).toBe("Rua de A");
      expect(campo("guest-neighborhood").value).toBe("Bairro de A");
      expect(campo("guest-number").value).toBe("77");
      expect(campo("guest-complement").value).toBe("Fundos de A");

      mockConfig.localCepRange = "38500-001";
      frete.cep = "38500-001";
      await act(async () => digitar("guest-cep", "38500001"));
      await act(async () => pendentes.get("38500001")!(resposta));
      await act(async () => digitar("guest-number", "88"));

      // Só redigitar o número não basta para enviar o endereço incompleto de B.
      const bloqueado = finalizar().disabled;
      await act(async () => finalizar().click());
      expect(createOrder).not.toHaveBeenCalled();
      expect(bloqueado).toBe(true);
      expect(campo("guest-street").value).toBe("");
      expect(campo("guest-neighborhood").value).toBe("");
      expect(campo("guest-city").value).toBe(cidade);
      expect(campo("guest-state").value).toBe(uf);
      expect(campo("guest-complement").value).toBe("");
      expect(campo("checkout-name").value).toBe("Cliente Teste");
      expect(campo("checkout-tel").value).toBe("(34) 99999-9999");

      await act(async () => {
        digitar("guest-street", "Rua de B");
        digitar("guest-neighborhood", "Bairro de B");
        if (!cidade) digitar("guest-city", "Cidade B");
        if (!uf) digitar("guest-state", "SP");
      });
      expect(finalizar().disabled).toBe(false);
      await act(async () => finalizar().click());
      expect(createOrder).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          addressData: expect.objectContaining({
            cep: "38500-001",
            street: "Rua de B",
            neighborhood: "Bairro de B",
            city: "Cidade B",
            state: "SP",
            number: "88",
            complement: undefined,
          }),
        }),
        expect.anything(),
      );
    },
  );

  it("só limpa número e complemento ao completar um CEP diferente", async () => {
    await montar();
    await act(async () => {
      digitar("guest-number", "77");
      digitar("guest-complement", "Fundos");
      digitar("guest-cep", "38500000");
    });
    await responderEndereco("38500000");
    expect(campo("guest-number").value).toBe("77");
    expect(campo("guest-complement").value).toBe("Fundos");

    await act(async () => digitar("guest-cep", "3850000"));
    await act(async () => digitar("guest-cep", "38500000"));
    await responderEndereco("38500000");
    expect(campo("guest-number").value).toBe("77");
    expect(campo("guest-complement").value).toBe("Fundos");

    await act(async () => digitar("guest-cep", "3850000"));
    await act(async () => digitar("guest-cep", "38500001"));
    expect(campo("guest-number").value).toBe("");
    expect(campo("guest-complement").value).toBe("");
    await responderEndereco("38500001");
  });

  it("segunda busca (localidade única) limpa rua e bairro em vez de manter os da primeira busca", async () => {
    await montar();
    // Primeira busca: CEP com rua/bairro completos.
    act(() => {
      digitar("guest-cep", "01310100");
    });
    expect(pendentes.size).toBe(1);
    pendentes.get("01310100")!({
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      (document.getElementById("guest-street") as HTMLInputElement).value,
    ).toBe("Avenida Paulista");

    // A pessoa muda de ideia: digita um CEP de localidade única (sem
    // rua/bairro no ViaCEP).
    act(() => {
      digitar("guest-cep", "38500000");
    });
    expect(pendentes.size).toBe(2);
    pendentes.get("38500000")!({
      logradouro: "",
      bairro: "",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const street = document.getElementById("guest-street") as HTMLInputElement;
    const neighborhood = document.getElementById(
      "guest-neighborhood",
    ) as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    const state = document.getElementById("guest-state") as HTMLInputElement;

    expect(city.value).toBe("Monte Carmelo");
    expect(state.value).toBe("MG");

    // O defeito: rua e bairro da busca ANTERIOR não podem sobreviver
    // misturados com a cidade/estado da busca nova.
    expect(street.value).toBe("");
    expect(neighborhood.value).toBe("");
  });
});

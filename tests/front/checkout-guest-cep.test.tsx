// @vitest-environment jsdom
//
// Task 3 da migração para useBuscaCep: prova que o checkout de CONVIDADO
// (ramo `{!user && (...)}` do CheckoutView, linha ~625) herda as mesmas
// garantias que o AddressForm já tinha — em especial a corrida #184, o
// defeito mais grave porque este é o caminho de compra sem login, de maior
// volume da loja.
//
// Par de tests/front/address-form-cep-race.test.tsx, mas montando o
// CheckoutView inteiro (com os mocks de contexto de
// checkout-view-flag-off.test.tsx) em vez do AddressForm isolado.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// `mockConfig` precisa ser declarado via `vi.hoisted` porque `vi.mock` é
// hoisted acima dos imports — ver o mesmo padrão em
// address-form-cep-race.test.tsx. Mutável de propósito: o caso do item 2
// muda `shippingCoverage` para "local" e restaura em seguida.
const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    // Precisa ser "national" — é o gate que liga a busca de CEP neste
    // bloco (ver `isNational` em CheckoutView.tsx).
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
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

// canvas-confetti tentaria abrir um canvas 2D que o jsdom não implementa —
// nenhum dos casos deste arquivo chega a submeter o pedido, mas o import é
// avaliado no módulo mesmo assim.
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-view-flag-off.test.tsx.
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

describe("CheckoutView (convidado) — busca de CEP via useBuscaCep", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let armazem: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
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
    // Mock SIMPLES de propósito: ignora o `AbortSignal` e só resolve quando
    // o teste mandar. Um mock signal-aware auto-rejeitaria a busca antiga
    // assim que a nova chamasse `abort()`, e o caso de corrida passaria
    // mesmo sem a guarda de sequência do hook — falso verde.
    fetchMock = vi.fn((url: string) => {
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
    // Repõe o objeto INTEIRO, não só o campo que os casos de hoje mexem: se
    // amanhã alguém mudar `originCep` num caso, o vazamento só apareceria sob
    // shuffle (o caso que muda a config é o último do arquivo, então na ordem
    // natural ninguém roda depois dele). Mesmo preço, fecha a categoria.
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
  });

  it("descarta a resposta da busca antiga quando ela chega depois da busca nova (#184)", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    act(() => {
      // Primeira busca: CEP antigo (Av. Paulista).
      digitar("guest-cep", "01310100");
      // Segunda busca, ainda dentro do mesmo `act()`.
      digitar("guest-cep", "38500000");
    });

    expect(pendentes.size).toBe(2);

    // A mais antiga (01310100) responde por último.
    pendentes.get("38500000")!({
      logradouro: "Rua Nova",
      bairro: "Bairro Novo",
      localidade: "Monte Carmelo",
      uf: "MG",
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

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

    const street = document.getElementById("guest-street") as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;

    // Correto: o endereço final é o da busca NOVA (38500-000), não o da
    // antiga que respondeu por último.
    expect(street.value).toBe("Rua Nova");
    expect(city.value).toBe("Monte Carmelo");
  });

  it("caminho feliz: uma busca preenche o endereço e o campo volta a ficar habilitado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    act(() => {
      digitar("guest-cep", "01310100");
    });
    expect(pendentes.size).toBe(1);
    expect(
      (document.getElementById("guest-cep") as HTMLInputElement).disabled,
    ).toBe(true);
    // O CEP formatado tem de estar gravado assim que o usuário digita, não
    // só depois da resposta do ViaCEP — é o que `ShippingCalculator.tsx` e
    // o `defaultValues`/reset deste mesmo arquivo leem de volta.
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("01310-100");

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

    const street = document.getElementById("guest-street") as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    expect(street.value).toBe("Avenida Paulista");
    expect(city.value).toBe("São Paulo");
    expect(
      (document.getElementById("guest-cep") as HTMLInputElement).disabled,
    ).toBe(false);
  });

  it("grava o CEP no localStorage mesmo com menos de 8 dígitos, sem esperar a busca", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    act(() => {
      digitar("guest-cep", "0131");
    });
    await act(async () => {
      await Promise.resolve();
    });

    // O `setItem` fica fora de qualquer gate em CheckoutView.tsx — nem do
    // `isNational`, nem do comprimento de 8 dígitos. Se alguém mover esta
    // gravação para dentro de um desses gates, esta asserção quebra.
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("0131");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gate isNational: loja local não busca CEP mesmo com 8 dígitos", async () => {
    mockConfig.shippingCoverage = "local";
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    act(() => {
      digitar("guest-cep", "01310100");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    // O `setItem` roda fora de QUALQUER gate — inclusive do `isNational`. Se
    // alguém mover a gravação para dentro do `if (isNational)`, o CEP
    // lembrado da loja local regride em silêncio.
    expect(armazem.get("ikcous_last_shipping_cep")).toBe("01310-100");
  });
});

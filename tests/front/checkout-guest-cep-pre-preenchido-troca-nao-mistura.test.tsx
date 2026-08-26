// @vitest-environment jsdom
//
// Achado 1 da revisão (25/08/2026): o CEP do checkout de convidado nasce
// preenchido de `localStorage` (chave `ikcous_last_shipping_cep`,
// CheckoutView.tsx ~262/~281) — e um campo PRÉ-preenchido nunca dispara
// `onChange`, então `cepAssociadoRef` (que nascia `null` fixo) nunca era
// atribuído por essa primeira "busca" (que nem existe, porque não houve
// digitação). Quando a pessoa então digita um CEP de localidade única
// (logradouro/bairro vazios no ViaCEP), `eraDeOutroCep` dava `false` para
// sempre (guarda de `null`) e a rua preenchida À MÃO para o CEP antigo
// sobrevivia, misturada com a cidade/estado do CEP novo.
//
// Par de checkout-guest-troca-cep-nao-mistura-endereco-antigo.test.tsx, mas
// cobrindo a porta que aquele teste não cobre: aqui a "busca anterior" nunca
// aconteceu — o valor antigo veio do localStorage e foi completado à mão.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
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

describe("CheckoutView (convidado) — CEP pré-preenchido pelo localStorage e depois trocado não mistura endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let pendentes: Map<string, FetchResolver>;
  let armazem: Map<string, string>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pendentes = new Map();
    // O CEP de uma visita anterior já está salvo — é isto que faz o campo
    // nascer preenchido SEM disparar onChange.
    armazem = new Map<string, string>([
      ["ikcous_last_shipping_cep", "01310-100"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
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
    Object.assign(mockConfig, {
      shippingCoverage: "national",
      originCep: "38500-000",
    });
  });

  it("segunda visita: CEP nasce preenchido do localStorage, a pessoa completa à mão, e um CEP novo de localidade única não pode misturar a rua antiga com a cidade nova", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // O CEP nasceu preenchido, sem nenhuma busca disparada — é o que prova
    // que onChange não rodou para este valor.
    expect(
      (document.getElementById("guest-cep") as HTMLInputElement).value,
    ).toBe("01310-100");
    expect(pendentes.size).toBe(0);

    // A pessoa completa o endereço à mão, porque o CEP "parece" completo.
    act(() => {
      digitar("guest-street", "Avenida Paulista");
      digitar("guest-neighborhood", "Bela Vista");
    });

    // Ela percebe que é o CEP da mudança antiga e digita o novo, de
    // localidade única (sem rua/bairro no ViaCEP).
    act(() => {
      digitar("guest-cep", "38500000");
    });
    expect(pendentes.size).toBe(1);
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

    console.log(
      "RESULTADO (achado 1) >>>",
      JSON.stringify({
        street: street.value,
        neighborhood: neighborhood.value,
        city: city.value,
        state: state.value,
      }),
    );

    expect(city.value).toBe("Monte Carmelo");
    expect(state.value).toBe("MG");

    // O defeito: rua e bairro digitados à mão para o CEP ANTIGO não podem
    // sobreviver misturados com a cidade/estado do CEP novo.
    expect(street.value).toBe("");
    expect(neighborhood.value).toBe("");
  });
});

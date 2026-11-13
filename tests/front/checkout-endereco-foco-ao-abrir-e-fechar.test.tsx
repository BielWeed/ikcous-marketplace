// @vitest-environment jsdom
//
// Checkout de quem tem CONTA: "Novo" (ou o lápis de editar) troca a tela
// inteira pelo formulário de endereço, e o botão que tinha o foco some junto.
// Sem tratamento, o foco caía no corpo da página: o leitor de tela ficava em
// silêncio e o teclado recomeçava do topo. A trava global de foco do App só
// age quando `currentView` muda, e aqui continua `checkout`.
//
// Regra: ao abrir, o título da tela de endereço recebe o foco; ao fechar
// (Cancelar, Voltar ou salvar — todos passam pelo mesmo estado), o foco volta
// ao botão "Novo" que abriu.
//
// Harness copiado de checkout-voltar-durante-salvar-endereco.test.tsx.
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto } = vi.hoisted(() => {
  const produto = {
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
  };
  return {
    produto,
    estado: {
      enderecos: [] as unknown[],
      // O 2º argumento que o formulário de verdade entrega ao editar: só o que
      // a cliente mudou (ver address-form-edicao-manda-so-o-que-mudou).
      alteracoes: undefined as Record<string, unknown> | undefined,
    },
  };
});

const addAddress = vi.fn();
const updateAddress = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
/** Cada vez que o checkout escolhe um endereço de entrega, cai aqui. */
const escolherEndereco = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

// O formulário de verdade tem mil campos; aqui só importa que ele chama o
// `onSubmit` que o checkout entrega (o mesmo que a tela real chama no Salvar).
vi.mock("@/components/ui/custom/AddressForm", () => ({
  AddressForm: ({
    onSubmit,
    initialData,
  }: {
    onSubmit: (
      data: Record<string, unknown>,
      alteracoes?: Record<string, unknown>,
    ) => Promise<void>;
    initialData?: { id: string };
  }) => (
    <button
      type="button"
      data-testid="salvar-endereco-teste"
      onClick={() => {
        void onSubmit(
          {
            name: initialData ? "Editado" : "Novo",
            recipient_name: "Cliente Teste",
            cep: "01310-200",
            street: "Rua Nova",
            number: "200",
            neighborhood: "Centro",
            city: "Cidade Teste",
            state: "SP",
            is_default: false,
          },
          initialData ? estado.alteracoes : undefined,
        );
      }}
    >
      Salvar endereço (teste)
    </button>
  ),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    fetchAddresses: vi.fn(),
    addAddress: (...args: unknown[]) => addAddress(...args),
    updateAddress: (...args: unknown[]) => updateAddress(...args),
    loading: false,
  }),
}));

const USUARIO = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIO, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: function useCartDeTeste() {
    const [enderecoSelecionadoId, setId] = useState<string | null>(null);
    return {
      cart: [{ product: produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      enderecoSelecionadoId,
      setEnderecoSelecionadoId: (id: string | null) => {
        escolherEndereco(id);
        setId(id);
      },
    };
  },
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENDERECO_DA_CONTA = {
  id: "addr-1",
  user_id: "user-1",
  name: "Casa",
  recipient_name: "Cliente Teste",
  cep: "01310-100",
  street: "Rua Teste",
  number: "100",
  neighborhood: "Centro",
  city: "Cidade Teste",
  state: "SP",
  is_default: true,
};
function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoExato(texto: string) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — foco ao abrir e fechar a tela de endereço", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrirOApp() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
    });
  }

  /** O que o App faz no Voltar/popstate: chama o override do checkout. */
  async function fecharPeloVoltar() {
    const ultima = onSetBackOverride.mock.calls.at(-1)?.[0] as
      | (() => () => void)
      | null
      | undefined;
    expect(typeof ultima).toBe("function");
    await act(async () => {
      ultima!()();
      await esperarMicrotarefas();
    });
  }

  beforeEach(() => {
    addAddress.mockReset();
    updateAddress.mockReset();
    onNavigate.mockReset();
    onSetBackOverride.mockReset();
    escolherEndereco.mockReset();
    estado.enderecos = [ENDERECO_DA_CONTA];
    estado.alteracoes = undefined;
    sessionStorage.clear();
    pararABuscaDeCep();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.spyOn(globalThis.history, "back").mockImplementation(() => {});
    vi.stubGlobal("scrollTo", vi.fn());
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

  it('abrir "Novo": o foco vai para o título "Novo Endereço"', async () => {
    await abrirOApp();
    await act(async () => {
      botaoExato("Novo")!.click();
      await esperarMicrotarefas();
    });

    const ativo = document.activeElement as HTMLElement;
    expect(ativo.tagName).toBe("H2");
    expect(ativo.textContent).toContain("Novo Endereço");
  });

  it('abrir o lápis de editar: o foco vai para o título "Editar Endereço"', async () => {
    await abrirOApp();
    await act(async () => {
      (
        document.querySelector(
          'button[aria-label="Editar endereço Casa"]',
        ) as HTMLButtonElement
      ).click();
      await esperarMicrotarefas();
    });

    const ativo = document.activeElement as HTMLElement;
    expect(ativo.tagName).toBe("H2");
    expect(ativo.textContent).toContain("Editar Endereço");
  });

  it('cancelar (Voltar): o foco volta ao botão "Novo" que abriu a tela', async () => {
    await abrirOApp();
    await act(async () => {
      botaoExato("Novo")!.click();
      await esperarMicrotarefas();
    });
    expect(botaoExato("Novo")).toBeUndefined();

    await fecharPeloVoltar();

    const novo = botaoExato("Novo");
    expect(novo).toBeDefined();
    expect(document.activeElement).toBe(novo);
  });

  it('controle: sem abrir a tela de endereço, o foco não é puxado para o "Novo"', async () => {
    await abrirOApp();
    expect(document.activeElement).not.toBe(botaoExato("Novo"));
  });
});

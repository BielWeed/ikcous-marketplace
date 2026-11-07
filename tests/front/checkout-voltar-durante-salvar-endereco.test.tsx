// @vitest-environment jsdom
//
// r57-c, achado 1 — VOLTAR DO APARELHO ENQUANTO O ENDEREÇO É SALVO.
//
// A cliente toca em "Salvar endereço" com a rede lenta (o salvamento espera até
// 15 s) e, com a rodinha girando, aperta o Voltar do celular para desistir. O
// Voltar fecha a janela do endereço (o botão Cancelar é travado nessa hora, o
// Voltar do aparelho não é). Quando a resposta do servidor chegava, o código
// chamava `history.back()` de novo — a entrada da janela já tinha sido gasta
// pelo Voltar, então esse segundo passo desfazia a entrada do próprio checkout
// e jogava a cliente no carrinho — e ainda trocava o endereço de entrega (e,
// com ele, o frete) sem ela ter pedido.
//
// Regra nova: a resposta só fecha a janela e escolhe o endereço se a MESMA
// janela em que ela tocou em Salvar ainda estiver aberta. O endereço fica
// salvo (já foi gravado), mas não vira o de entrega nem mexe no histórico.
//
// Harness copiado de checkout-pedido-chave-voltar-e-sessao.test.tsx.
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
    onSubmit: (data: Record<string, unknown>) => Promise<void>;
    initialData?: { id: string };
  }) => (
    <button
      type="button"
      data-testid="salvar-endereco-teste"
      onClick={() => {
        void onSubmit({
          name: initialData ? "Editado" : "Novo",
          recipient_name: "Cliente Teste",
          cep: "01310-200",
          street: "Rua Nova",
          number: "200",
          neighborhood: "Centro",
          city: "Cidade Teste",
          state: "SP",
          is_default: false,
        });
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
const ENDERECO_NOVO = {
  ...ENDERECO_DA_CONTA,
  id: "addr-2",
  name: "Novo",
  street: "Rua Nova",
  number: "200",
  cep: "01310-200",
  is_default: false,
};

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resposta do servidor que a gente solta na hora que quiser. */
function respostaAdiada<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function botaoExato(texto: string) {
  return [...document.body.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — Voltar do aparelho enquanto o endereço é salvo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let voltarDoNavegador: ReturnType<typeof vi.spyOn>;
  let rolar: ReturnType<typeof vi.fn>;

  /** O que o App faz no popstate: chama o override que o checkout registrou. */
  async function apertarVoltarDoAparelho() {
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

  async function abrirJanelaDeNovoEndereco() {
    await act(async () => {
      botaoExato("Novo")!.click();
      await esperarMicrotarefas();
    });
    expect(
      document.querySelector('[data-testid="salvar-endereco-teste"]'),
    ).not.toBeNull();
  }

  async function tocarEmSalvar() {
    await act(async () => {
      (
        document.querySelector(
          '[data-testid="salvar-endereco-teste"]',
        ) as HTMLButtonElement
      ).click();
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
    sessionStorage.clear();
    pararABuscaDeCep();
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    // O passo para trás do navegador não existe no jsdom do teste: espiona.
    voltarDoNavegador = vi
      .spyOn(globalThis.history, "back")
      .mockImplementation(() => {});
    rolar = vi.fn();
    vi.stubGlobal("scrollTo", rolar);
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

  it("controle: sem Voltar, a resposta fecha a janela UMA vez e escolhe o endereço novo", async () => {
    const { promessa, resolver } = respostaAdiada<unknown>();
    addAddress.mockReturnValueOnce(promessa);
    await abrirOApp();
    await abrirJanelaDeNovoEndereco();
    await tocarEmSalvar();
    voltarDoNavegador.mockClear();
    escolherEndereco.mockClear();

    await act(async () => {
      resolver(ENDERECO_NOVO);
      await esperarMicrotarefas();
    });

    expect(voltarDoNavegador).toHaveBeenCalledTimes(1);
    expect(escolherEndereco).toHaveBeenCalledWith("addr-2");
  });

  it("Voltar do aparelho com o salvamento em voo: a resposta tardia NÃO dá outro passo para trás nem troca o endereço de entrega", async () => {
    const { promessa, resolver } = respostaAdiada<unknown>();
    addAddress.mockReturnValueOnce(promessa);
    await abrirOApp();
    await abrirJanelaDeNovoEndereco();
    await tocarEmSalvar();

    await apertarVoltarDoAparelho();
    // A janela do endereço fechou: voltou o formulário do checkout.
    expect(
      document.querySelector('[data-testid="salvar-endereco-teste"]'),
    ).toBeNull();
    voltarDoNavegador.mockClear();
    escolherEndereco.mockClear();
    rolar.mockClear();

    // Só agora a rede responde.
    await act(async () => {
      resolver(ENDERECO_NOVO);
      await esperarMicrotarefas();
    });

    expect(addAddress).toHaveBeenCalledTimes(1);
    expect(voltarDoNavegador).not.toHaveBeenCalled();
    expect(escolherEndereco).not.toHaveBeenCalledWith("addr-2");
    expect(rolar).not.toHaveBeenCalled();
  });

  it("Voltar e abrir a janela de novo: a resposta do salvamento ANTIGO não fecha a janela nova", async () => {
    const primeira = respostaAdiada<unknown>();
    const segunda = respostaAdiada<unknown>();
    addAddress
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    await abrirOApp();
    await abrirJanelaDeNovoEndereco();
    await tocarEmSalvar();
    await apertarVoltarDoAparelho();
    await abrirJanelaDeNovoEndereco();
    voltarDoNavegador.mockClear();
    escolherEndereco.mockClear();

    // A resposta da 1ª janela chega com a 2ª aberta: não é dela.
    await act(async () => {
      primeira.resolver(ENDERECO_NOVO);
      await esperarMicrotarefas();
    });
    expect(voltarDoNavegador).not.toHaveBeenCalled();
    expect(escolherEndereco).not.toHaveBeenCalledWith("addr-2");
    expect(
      document.querySelector('[data-testid="salvar-endereco-teste"]'),
    ).not.toBeNull();

    // Já o salvamento da janela que está aberta fecha e escolhe normalmente.
    await tocarEmSalvar();
    await act(async () => {
      segunda.resolver({ ...ENDERECO_NOVO, id: "addr-3" });
      await esperarMicrotarefas();
    });
    expect(voltarDoNavegador).toHaveBeenCalledTimes(1);
    expect(escolherEndereco).toHaveBeenCalledWith("addr-3");
  });

  it("editar um endereço: o mesmo Voltar no meio do salvamento também não empurra a cliente para fora", async () => {
    const { promessa, resolver } = respostaAdiada<boolean>();
    updateAddress.mockReturnValueOnce(promessa);
    await abrirOApp();
    await act(async () => {
      // O lápis de editar do endereço salvo (o nome acessível diz de qual
      // endereço é, lote r64-a).
      const editar = document.querySelector(
        'button[aria-label="Editar endereço Casa"]',
      ) as HTMLButtonElement | null;
      expect(editar).not.toBeNull();
      editar!.click();
      await esperarMicrotarefas();
    });
    await tocarEmSalvar();
    await apertarVoltarDoAparelho();
    voltarDoNavegador.mockClear();
    escolherEndereco.mockClear();

    await act(async () => {
      resolver(true);
      await esperarMicrotarefas();
    });

    expect(updateAddress).toHaveBeenCalledTimes(1);
    expect(voltarDoNavegador).not.toHaveBeenCalled();
  });

  it("o salvamento FALHA e a cliente já tinha apertado Voltar: nada acontece (nem passo para trás, nem escolha)", async () => {
    const { promessa, resolver } = respostaAdiada<unknown>();
    addAddress.mockReturnValueOnce(promessa);
    await abrirOApp();
    await abrirJanelaDeNovoEndereco();
    await tocarEmSalvar();
    await apertarVoltarDoAparelho();
    voltarDoNavegador.mockClear();
    escolherEndereco.mockClear();

    await act(async () => {
      resolver(null);
      await esperarMicrotarefas();
    });

    expect(voltarDoNavegador).not.toHaveBeenCalled();
    expect(escolherEndereco).not.toHaveBeenCalledWith("addr-2");
  });
});

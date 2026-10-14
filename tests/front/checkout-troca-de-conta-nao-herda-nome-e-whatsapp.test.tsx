// @vitest-environment jsdom
//
// DADO DE CLIENTE: quando uma pessoa sai da conta e OUTRA entra no mesmo
// celular, a segunda NUNCA pode abrir o checkout e ver nome e WhatsApp da
// primeira (o pedido sairia com o contato errado). O rascunho da sessão
// grava de QUEM são nome e WhatsApp (`contaDosDados`, mesmo desenho do
// cupom), e a marca "a cliente mexeu neste campo" vale por conta.
//
// Também prova a marca em si: a cliente que APAGA o campo de propósito não o
// vê preenchido de novo quando o perfil é reemitido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type Usuario = { id: string; user_metadata: Record<string, string> } | null;
type Perfil = { id: string; full_name: string; whatsapp: string } | null;

const { conta, createOrder, invoke } = vi.hoisted(() => ({
  conta: {
    user: { id: "user-1", user_metadata: {} } as {
      id: string;
      user_metadata: Record<string, string>;
    } | null,
    profile: null as {
      id: string;
      full_name: string;
      whatsapp: string;
    } | null,
    carregando: false,
  },
  createOrder: vi.fn(),
  invoke: vi.fn(),
}));

const produto = {
  id: "prod-1",
  name: "Blusa Teste",
  description: "",
  price: 100,
  images: [],
  category: "Roupas",
  stock: 50,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date(0).toISOString(),
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localDeliveryFee: 5,
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(async () => {}),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: conta.user,
    profile: conta.profile,
    loading: conta.carregando,
  }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { useState } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<unknown>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    return {
      cart: [{ product: produto, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      freteIndefinido: true,
      freteGratis: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: selecionada,
      shippingCep,
      enderecoSelecionadoId,
      setEnderecoSelecionadoId,
      setSelectedShippingOption: setSelecionada,
      setShippingCep,
    };
  }
  return { useCart: useCartComEstado };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/hooks/useEconomiaDoFreteExibida", () => ({
  useEconomiaDoFreteExibida: () => 0,
}));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CHAVE = "ikcous-rascunho-do-checkout-v1";

function rascunhoDe(
  dono: string | null | undefined,
  parcial: { nome?: string; whatsapp?: string },
) {
  const base: Record<string, unknown> = {
    nome: "",
    whatsapp: "",
    cep: "38500-000",
    numero: "",
    rua: "",
    bairro: "",
    cidade: "",
    estado: "",
    complemento: "",
    notas: "",
    cupom: null,
    ...parcial,
  };
  if (dono !== undefined) base.contaDosDados = dono;
  return JSON.stringify(base);
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
const valorDe = (id: string) =>
  (document.getElementById(id) as HTMLInputElement).value;

const A = { user: { id: "user-1", user_metadata: {} } as Usuario } as const;
const B = { user: { id: "user-2", user_metadata: {} } as Usuario } as const;
const PERFIL_A: Perfil = {
  id: "user-1",
  full_name: "Cliente Um",
  whatsapp: "34999999999",
};
const PERFIL_B: Perfil = {
  id: "user-2",
  full_name: "Cliente Dois",
  whatsapp: "11988887777",
};

describe("CheckoutView — troca de conta não herda nome e WhatsApp da conta anterior", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sessao: Map<string, string>;

  beforeEach(() => {
    conta.user = A.user;
    conta.profile = null;
    conta.carregando = false;
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [], cotacaoIncompleta: false },
      error: null,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessao.get(k) ?? null,
      setItem: (k: string, v: string) => void sessao.set(k, v),
      removeItem: (k: string) => void sessao.delete(k),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

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
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }
  /** Sai do checkout e volta a ele (desmonta e monta de novo, mesma aba). */
  async function remontar() {
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await renderizar();
  }
  const entrar = (u: Usuario, p: Perfil) => {
    conta.user = u;
    conta.profile = p;
  };

  it("A1: A abre o checkout SEM digitar e sai; B entra na mesma aba → B vê os dados de B", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Cliente Um");

    entrar(B.user, PERFIL_B);
    await remontar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });

  it("A2: A digita outro WhatsApp e sai; B abre o checkout → não vê o digitado por A", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    await act(async () => {
      digitar("checkout-tel", "34977776666");
    });
    expect(valorDe("checkout-tel")).toBe("(34) 97777-6666");

    entrar(B.user, PERFIL_B);
    await remontar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });

  it("A3: a conta troca para B com o checkout ABERTO depois de A digitar → o digitado de A não fica para B", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Nome que A digitou");
    });
    await act(async () => {
      digitar("checkout-tel", "34977776666");
    });

    entrar(B.user, PERFIL_B);
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });

  it("A sai (ninguém logado) e B entra com o checkout aberto → B não vê nada de A", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    await act(async () => {
      digitar("checkout-tel", "34977776666");
    });

    entrar(null, null);
    await renderizar();
    expect(valorDe("checkout-tel")).not.toBe("(34) 97777-6666");
    expect(valorDe("checkout-name")).toBe("");

    entrar(B.user, PERFIL_B);
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });

  it("convidado sai do checkout depois de A: o rascunho de A não aparece para o convidado", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    await act(async () => {
      digitar("checkout-tel", "34977776666");
    });

    entrar(null, null);
    await remontar();

    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
  });

  it("rascunho de antes do campo de dono (sem `contaDosDados`) não passa para conta nenhuma", async () => {
    entrar(B.user, PERFIL_B);
    sessao.set(
      CHAVE,
      rascunhoDe(undefined, {
        nome: "Dona Antiga",
        whatsapp: "(34) 97777-6666",
      }),
    );
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });

  it("convidado digitou e DEPOIS entrou na conta (checkout remontado) → mantém o digitado", async () => {
    entrar(null, null);
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Maria Convidada");
    });
    await act(async () => {
      digitar("checkout-tel", "34988887777");
    });
    expect(JSON.parse(sessao.get(CHAVE) ?? "{}").contaDosDados).toBeNull();

    entrar(B.user, PERFIL_B);
    await remontar();

    expect(valorDe("checkout-name")).toBe("Maria Convidada");
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
  });

  it("convidado digitou e entrou na conta SEM remontar → mantém o digitado", async () => {
    entrar(null, null);
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Maria Convidada");
    });
    await act(async () => {
      digitar("checkout-tel", "34988887777");
    });

    entrar(B.user, PERFIL_B);
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Maria Convidada");
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
  });

  it("MESMA conta reabrindo o checkout → o rascunho dela vence o perfil", async () => {
    entrar(A.user, PERFIL_A);
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Nome Que Ela Quis");
    });
    await act(async () => {
      digitar("checkout-tel", "34977776666");
    });
    expect(JSON.parse(sessao.get(CHAVE) ?? "{}").contaDosDados).toBe("user-1");

    entrar(A.user, { ...PERFIL_A! });
    await remontar();

    expect(valorDe("checkout-name")).toBe("Nome Que Ela Quis");
    expect(valorDe("checkout-tel")).toBe("(34) 97777-6666");
  });

  it("sessão lenta: rascunho de A + conta ainda carregando; a sessão volta como A → o rascunho de A vale", async () => {
    sessao.set(
      CHAVE,
      rascunhoDe("user-1", {
        nome: "Nome Que Ela Quis",
        whatsapp: "(34) 97777-6666",
      }),
    );
    conta.carregando = true;
    entrar(null, null);
    await renderizar();
    // Enquanto não se sabe QUEM é, nada do rascunho de uma conta aparece.
    expect(
      (document.getElementById("checkout-tel") as HTMLInputElement | null)
        ?.value ?? "",
    ).not.toBe("(34) 97777-6666");

    conta.carregando = false;
    entrar(A.user, PERFIL_A);
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Nome Que Ela Quis");
    expect(valorDe("checkout-tel")).toBe("(34) 97777-6666");
  });

  it("sessão lenta: rascunho de A + conta carregando; a sessão volta como B → B vê B", async () => {
    sessao.set(
      CHAVE,
      rascunhoDe("user-1", {
        nome: "Nome Que A Quis",
        whatsapp: "(34) 97777-6666",
      }),
    );
    conta.carregando = true;
    entrar(null, null);
    await renderizar();

    conta.carregando = false;
    entrar(B.user, PERFIL_B);
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });
});

describe("CheckoutView — a marca 'a cliente mexeu' (campo apagado de propósito)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    conta.user = A.user;
    conta.profile = null;
    conta.carregando = false;
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: { options: [], cotacaoIncompleta: false },
      error: null,
    });
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => armazem.get(k) ?? null,
      setItem: (k: string, v: string) => void armazem.set(k, v),
      removeItem: (k: string) => void armazem.delete(k),
    });
    const sessao = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessao.get(k) ?? null,
      setItem: (k: string, v: string) => void sessao.set(k, v),
      removeItem: (k: string) => void sessao.delete(k),
    });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

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
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  it("a cliente APAGA o WhatsApp e o nome de propósito e o perfil é reemitido → os campos continuam vazios", async () => {
    conta.profile = { ...PERFIL_A! };
    await renderizar();
    expect(valorDe("checkout-tel")).toBe("(34) 99999-9999");

    await act(async () => {
      digitar("checkout-tel", "");
    });
    await act(async () => {
      digitar("checkout-name", "");
    });
    expect(valorDe("checkout-tel")).toBe("");
    expect(valorDe("checkout-name")).toBe("");

    conta.profile = { ...PERFIL_A! };
    await renderizar();

    expect(valorDe("checkout-tel")).toBe("");
    expect(valorDe("checkout-name")).toBe("");
  });

  it("a marca é POR CONTA: A apaga o WhatsApp de propósito; a conta troca para B → B recebe o WhatsApp de B", async () => {
    conta.profile = { ...PERFIL_A! };
    await renderizar();
    await act(async () => {
      digitar("checkout-tel", "");
    });
    expect(valorDe("checkout-tel")).toBe("");

    conta.user = B.user;
    conta.profile = { ...PERFIL_B! };
    await renderizar();

    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
    expect(valorDe("checkout-name")).toBe("Cliente Dois");
  });
});

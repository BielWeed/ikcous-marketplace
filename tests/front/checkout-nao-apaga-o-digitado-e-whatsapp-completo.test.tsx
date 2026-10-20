// @vitest-environment jsdom
//
// DOIS DEFEITOS DO FORMULÁRIO DE DADOS DA CLIENTE (nome e WhatsApp):
//
// 1) O checkout APAGAVA o que a cliente digitou: ela trocava o WhatsApp (ou o
//    nome), voltava ao carrinho, reabria o checkout, e o campo voltava com os
//    dados do cadastro (ou vazio, se a conta não tem WhatsApp). O rascunho da
//    sessão era restaurado e, logo depois, o efeito do perfil sobrescrevia nome
//    e WhatsApp sem perguntar se o campo já tinha sido mexido. O perfil agora só
//    PREENCHE o que a cliente não mexeu.
// 2) WhatsApp com UM dígito a menos passava como válido: a régua media o TEXTO
//    formatado (14 caracteres) e a máscara já chega a 14 com 10 dígitos.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

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

function rascunhoCom(parcial: {
  nome?: string;
  whatsapp?: string;
  contaDosDados?: string | null;
}) {
  return JSON.stringify({
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
    // O rascunho de quem está logada é DELA (a conta de todos os casos de
    // "mesma conta" deste arquivo); os casos de outra conta passam o dono.
    contaDosDados: "user-1",
    ...parcial,
  });
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

describe("CheckoutView — o perfil da conta não apaga o que a cliente digitou", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sessao: Map<string, string>;

  beforeEach(() => {
    conta.user = { id: "user-1", user_metadata: {} };
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

  const rascunhoSalvo = () => JSON.parse(sessao.get(CHAVE) ?? "{}");

  it("(i) rascunho com valores + perfil DIFERENTE → vence o rascunho (campo e rascunho regravado)", async () => {
    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    sessao.set(
      CHAVE,
      rascunhoCom({ nome: "Maria Presente", whatsapp: "(34) 98888-7777" }),
    );
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Maria Presente");
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
    expect(rascunhoSalvo().nome).toBe("Maria Presente");
    expect(rascunhoSalvo().whatsapp).toBe("(34) 98888-7777");
  });

  it("(ii) formulário vazio + perfil que CHEGA TARDE → preenche com os dados da conta", async () => {
    conta.profile = null;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");

    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Teste");
    expect(valorDe("checkout-tel")).toBe("(34) 99999-9999");
  });

  it("(iii) a cliente digitou e DEPOIS o perfil chega tarde → não apaga o digitado", async () => {
    conta.profile = null;
    await renderizar();

    await act(async () => {
      digitar("checkout-name", "Maria Presente");
    });
    await act(async () => {
      digitar("checkout-tel", "34988887777");
    });
    expect(valorDe("checkout-name")).toBe("Maria Presente");
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");

    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Maria Presente");
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
    expect(rascunhoSalvo().whatsapp).toBe("(34) 98888-7777");
  });

  it("(iii-b) a cliente trocou o WhatsApp e o perfil é REEMITIDO igual (novo objeto) → continua o dela", async () => {
    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    await renderizar();
    expect(valorDe("checkout-tel")).toBe("(34) 99999-9999");

    await act(async () => {
      digitar("checkout-tel", "34988887777");
    });
    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");

    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    await renderizar();

    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
  });

  it("(iv) conta SEM WhatsApp + rascunho com WhatsApp → mantém o do rascunho", async () => {
    conta.profile = { id: "user-1", full_name: "Cliente Teste", whatsapp: "" };
    sessao.set(
      CHAVE,
      rascunhoCom({ nome: "Cliente Teste", whatsapp: "(34) 98888-7777" }),
    );
    await renderizar();

    expect(valorDe("checkout-tel")).toBe("(34) 98888-7777");
    expect(rascunhoSalvo().whatsapp).toBe("(34) 98888-7777");
  });

  it("(v) sem rascunho e sem mexer: o perfil que NÃO mudou continua preenchendo (caminho que já funcionava)", async () => {
    conta.profile = {
      id: "user-1",
      full_name: "Cliente Teste",
      whatsapp: "34999999999",
    };
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Teste");
    expect(valorDe("checkout-tel")).toBe("(34) 99999-9999");
  });

  it("(vi) conta trocada com o checkout aberto e campos NÃO mexidos → seguem a conta nova", async () => {
    conta.profile = {
      id: "user-1",
      full_name: "Cliente Um",
      whatsapp: "34999999999",
    };
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Cliente Um");

    conta.user = { id: "user-2", user_metadata: {} };
    conta.profile = {
      id: "user-2",
      full_name: "Cliente Dois",
      whatsapp: "11988887777",
    };
    await renderizar();

    expect(valorDe("checkout-name")).toBe("Cliente Dois");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-7777");
  });
});

describe("CheckoutView — WhatsApp só vale com celular completo (11 dígitos)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    conta.user = { id: "user-1", user_metadata: {} };
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

  const faltaWhatsapp = () =>
    document.querySelector('[data-testid="checkout-resumo-falta-whatsapp"]') !==
    null;
  const erroDoCampo = () =>
    document.getElementById("erro-checkout-tel")?.textContent ?? null;

  async function digitarTeclaATecla(digitos: string) {
    let acumulado = "";
    for (const d of digitos) {
      acumulado += d;
      await act(async () => {
        digitar("checkout-tel", acumulado);
      });
    }
  }

  it("10 dígitos (14 caracteres na máscara): continua faltando e o erro diz o que fazer", async () => {
    await renderizar();
    await digitarTeclaATecla("3498887777");

    expect(valorDe("checkout-tel")).toBe("(34) 98887-777");
    expect(faltaWhatsapp()).toBe(true);
    expect(erroDoCampo()).toBe(
      "Confira o WhatsApp: faltou um número (DDD + 9 + 8 dígitos)",
    );
  });

  it("11 dígitos: libera — sem erro e sem pendência de WhatsApp", async () => {
    await renderizar();
    await digitarTeclaATecla("34988877777");

    expect(valorDe("checkout-tel")).toBe("(34) 98887-7777");
    expect(faltaWhatsapp()).toBe(false);
    expect(erroDoCampo()).toBeNull();
  });
});

// @vitest-environment jsdom
//
// DADO DE CLIENTE: o perfil que o AuthContext entrega pode ser de OUTRA
// pessoa. `user` e `profile` chegam em estados separados, e em alguns
// caminhos a conta nova vem junto com o perfil da anterior:
//   - troca direta A→B: (B, perfil de A, carregando) e, se o prazo de 2,5 s
//     estoura ou a leitura dá erro, (B, perfil de A, pronto) para sempre;
//   - saída com a sessão vencida e a renovação falhando: (ninguém, perfil de
//     A, pronto);
//   - resposta atrasada de `fetchProfile`: (B, perfil de B) vira (B, perfil
//     de A) sem a conta mudar.
// O checkout só aceita o perfil cujo `id` é o da conta logada, e o rascunho
// da sessão (nome, WhatsApp, CEP, endereço e observações) só volta para quem
// o digitou — o de convidado vale para quem entrar no meio da compra.
//
// Modelo de PRODUÇÃO: o App monta o checkout com `key` por conta
// (App.tsx: `checkout-${user.id}` / `checkout-guest`) — `chaveDoApp()` é a
// MESMA chave. O último bloco prova a defesa de dentro do módulo, sem chave.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type Perfil = { id: string; full_name: string; whatsapp: string };
type Usuario = { id: string; user_metadata: Record<string, string> };

const { conta, createOrder, invoke, montagens } = vi.hoisted(() => ({
  conta: {
    user: null as { id: string; user_metadata: Record<string, string> } | null,
    profile: null as {
      id: string;
      full_name: string;
      whatsapp: string;
    } | null,
    carregando: false,
  },
  createOrder: vi.fn(),
  invoke: vi.fn(),
  montagens: { n: 0 },
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
  const { useState, useEffect } = await import("react");
  function useCartComEstado() {
    const [selecionada, setSelecionada] = useState<unknown>(null);
    const [shippingCep, setShippingCep] = useState<string | null>(null);
    const [enderecoSelecionadoId, setEnderecoSelecionadoId] = useState<
      string | null
    >(null);
    useEffect(() => {
      montagens.n++;
    }, []);
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

const A: Usuario = { id: "user-A", user_metadata: {} };
const B: Usuario = { id: "user-B", user_metadata: {} };
const C: Usuario = { id: "user-C", user_metadata: {} };
const perfilA: Perfil = {
  id: "user-A",
  full_name: "Ana A",
  whatsapp: "34999990001",
};
const perfilB: Perfil = {
  id: "user-B",
  full_name: "Bia B",
  whatsapp: "11988880002",
};
const perfilC: Perfil = {
  id: "user-C",
  full_name: "Caio C",
  whatsapp: "21977770003",
};

// A MESMA chave do App.tsx.
const chaveDoApp = () =>
  conta.user?.id ? `checkout-${conta.user.id}` : "checkout-guest";

describe("CheckoutView — o perfil de outra conta nunca aparece nem é gravado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let sessao: Map<string, string>;
  let gravacoes: Array<{
    contaDosDados: unknown;
    nome: string;
    whatsapp: string;
    cep: string;
    notas: string;
  }>;

  beforeEach(() => {
    conta.user = A;
    conta.profile = perfilA;
    conta.carregando = false;
    montagens.n = 0;
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
    gravacoes = [];
    // Espião: toda gravação do rascunho é registrada com a etiqueta de dono.
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => sessao.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k === CHAVE) {
          const r = JSON.parse(v);
          gravacoes.push({
            contaDosDados: r.contaDosDados,
            nome: r.nome,
            whatsapp: r.whatsapp,
            cep: r.cep,
            notas: r.notas,
          });
        }
        sessao.set(k, v);
      },
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
          key={chaveDoApp()}
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
  /** Gravações do rascunho que levam dado de alguém com a etiqueta de OUTRO. */
  const comEtiqueta = (etiqueta: string | null, marcas: string[]) =>
    gravacoes.filter(
      (g) =>
        g.contaDosDados === etiqueta &&
        marcas.some(
          (m) =>
            g.nome === m ||
            g.whatsapp.includes(m) ||
            g.cep.includes(m) ||
            g.notas.includes(m),
        ),
    );

  it("K1: convidado aberto; B entra (o perfil chega antes do loading cair) → nada de B como convidado, e B vê B", async () => {
    conta.user = null;
    conta.profile = null;
    await renderizar();
    conta.user = B;
    conta.carregando = true;
    await renderizar();
    conta.profile = perfilB;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    expect(comEtiqueta(null, ["Bia B", "98888-0002"])).toEqual([]);
    expect(valorDe("checkout-name")).toBe("Bia B");
  });

  it("K1-cont: depois de K1, B sai e C entra na mesma aba → C vê C", async () => {
    conta.user = null;
    conta.profile = null;
    await renderizar();
    conta.user = B;
    conta.carregando = true;
    await renderizar();
    conta.profile = perfilB;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    act(() => raiz.unmount());
    conta.user = C;
    conta.profile = perfilC;
    raiz = createRoot(hospedeiro);
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Caio C");
    expect(valorDe("checkout-tel")).toBe("(21) 97777-0003");
  });

  it("K2: troca direta A→B, o perfil de B chega ANTES do loading cair → B vê B", async () => {
    await renderizar();
    conta.user = B;
    conta.carregando = true;
    await renderizar();
    conta.profile = perfilB;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Bia B");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-0002");
    expect(comEtiqueta("user-B", ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K2t: troca direta A→B, o loading cai ANTES do perfil de B (prazo de 2,5 s): vazio no intervalo, depois B — nunca {B, dados de A}", async () => {
    await renderizar();
    conta.user = B;
    conta.carregando = true;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    // Ainda é o perfil de A na mão: não vale para B.
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");

    conta.profile = perfilB;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Bia B");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-0002");
    expect(comEtiqueta("user-B", ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K2e: troca direta A→B e o perfil de B NUNCA chega (erro) → nunca A na tela; nunca {B, dados de A} no rascunho", async () => {
    await renderizar();
    conta.user = B;
    conta.carregando = true;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    await act(async () => {
      digitar("checkout-tel", "11988880002");
    });
    expect(valorDe("checkout-name")).not.toBe("Ana A");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-0002");
    expect(comEtiqueta("user-B", ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K3: saída de A com a sessão vencida e a renovação falhando (ninguém logado, perfil de A fica) → vazio; nunca {convidado, dados de A}", async () => {
    await renderizar();
    conta.user = null;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
    expect(comEtiqueta(null, ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K3-inv (controle): saída NORMAL de A (ninguém e perfil nulo no mesmo instante) → nada vaza", async () => {
    await renderizar();
    conta.user = null;
    conta.profile = null;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
    expect(comEtiqueta(null, ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K3-prox: depois de K3, C entra na mesma aba → C vê C (regressão da tentativa anterior)", async () => {
    await renderizar();
    conta.user = null;
    await renderizar();
    act(() => raiz.unmount());
    conta.user = C;
    conta.profile = perfilC;
    raiz = createRoot(hospedeiro);
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Caio C");
    expect(valorDe("checkout-tel")).toBe("(21) 97777-0003");
  });

  it("K3-prox-inv (controle): saída NORMAL de A e depois C entra → C vê C", async () => {
    await renderizar();
    conta.user = null;
    conta.profile = null;
    await renderizar();
    act(() => raiz.unmount());
    conta.user = C;
    conta.profile = perfilC;
    raiz = createRoot(hospedeiro);
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Caio C");
    expect(valorDe("checkout-tel")).toBe("(21) 97777-0003");
  });

  it("K2t-inv (controle): troca A→B em que o perfil zera junto com a conta → B não vê A, depois vê B", async () => {
    await renderizar();
    conta.user = B;
    conta.profile = null;
    conta.carregando = true;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
    conta.profile = perfilB;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Bia B");
  });

  it("K5: convidada digita, sai para entrar e volta logada como B (perfil ainda carregando) → mantém o digitado", async () => {
    conta.user = null;
    conta.profile = null;
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Convidada X");
    });
    await act(async () => {
      digitar("checkout-tel", "31966665555");
    });
    act(() => raiz.unmount());
    conta.user = B;
    conta.carregando = true;
    raiz = createRoot(hospedeiro);
    await renderizar();
    conta.profile = perfilB;
    await renderizar();
    conta.carregando = false;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Convidada X");
    expect(valorDe("checkout-tel")).toBe("(31) 96666-5555");
  });

  it("K7: o perfil de A chega ATRASADO depois do de B (resposta sem guarda de conta) → B continua vendo B", async () => {
    conta.user = B;
    conta.profile = perfilB;
    await renderizar();
    conta.profile = perfilA;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("Bia B");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-0002");
    expect(comEtiqueta("user-B", ["Ana A", "99999-0001"])).toEqual([]);
  });

  it("K8: o CEP de A (que o logout apaga do aparelho) NÃO volta pelo rascunho para o convidado", async () => {
    localStorage.setItem("ikcous_last_shipping_cep", "38501-111");
    await renderizar();
    // Logout normal: o AuthContext apaga o CEP do aparelho.
    localStorage.removeItem("ikcous_last_shipping_cep");
    conta.user = null;
    conta.profile = null;
    await renderizar();
    const cep = (
      document.getElementById("guest-cep") as HTMLInputElement | null
    )?.value;
    expect(cep).not.toBe("38501-111");
    expect(comEtiqueta(null, ["38501-111"])).toEqual([]);
  });

  it("K8-notas: as observações de A não voltam para quem entrar depois", async () => {
    await renderizar();
    const caixa = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(caixa).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(caixa, "Deixar com o porteiro da Ana");
      caixa.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(sessao.get(CHAVE)).toContain("porteiro da Ana");

    conta.user = B;
    conta.profile = perfilB;
    await remontar();

    const depois = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(depois?.value ?? "").not.toContain("porteiro da Ana");
    expect(comEtiqueta("user-B", ["porteiro da Ana"])).toEqual([]);
  });

  it("K9 (nenhuma gravação enquanto a autenticação carrega): B monta carregando, o perfil chega no loading, B sai normal → o convidado não vê B", async () => {
    conta.user = B;
    conta.profile = null;
    conta.carregando = true;
    await renderizar();
    conta.profile = perfilB;
    await renderizar();
    expect(gravacoes.length).toBe(0);
    conta.carregando = false;
    await renderizar();
    conta.user = null;
    conta.profile = null;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
  });

  it("perfil sem `id` não é de ninguém: a conta logada não herda o nome dele", async () => {
    conta.user = B;
    conta.profile = {
      full_name: "Sem Dono",
      whatsapp: "34999990001",
    } as Perfil;
    await renderizar();
    expect(valorDe("checkout-name")).toBe("");
    expect(valorDe("checkout-tel")).toBe("");
  });
});

describe("CheckoutView — defesa de dentro do módulo (montado SEM a chave do App)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    conta.user = A;
    conta.profile = perfilA;
    conta.carregando = false;
    montagens.n = 0;
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

  async function renderizarSemChave() {
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

  it("a troca de conta recria a tela: o digitado de A não fica para B", async () => {
    await renderizarSemChave();
    expect(montagens.n).toBe(1);
    await act(async () => {
      digitar("checkout-name", "Nome que A digitou");
    });
    expect(valorDe("checkout-name")).toBe("Nome que A digitou");

    conta.user = B;
    conta.profile = perfilB;
    await renderizarSemChave();

    expect(montagens.n).toBe(2);
    expect(valorDe("checkout-name")).toBe("Bia B");
    expect(valorDe("checkout-tel")).toBe("(11) 98888-0002");
  });

  it("o mesmo usuário reemitido NÃO recria a tela (o que a cliente digitou fica)", async () => {
    await renderizarSemChave();
    await act(async () => {
      digitar("checkout-name", "Nome que A digitou");
    });
    conta.user = { ...A };
    conta.profile = { ...perfilA };
    await renderizarSemChave();

    expect(montagens.n).toBe(1);
    expect(valorDe("checkout-name")).toBe("Nome que A digitou");
  });
});

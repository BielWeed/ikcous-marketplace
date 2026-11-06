// @vitest-environment jsdom
//
// Dois defeitos do cupom no CheckoutView (dinheiro: só texto e entrada de
// texto, o cálculo do desconto não muda):
//
// 1) Cupom digitado com acento ou espaço no meio ("verão10", "VERAO 10") era
//    recusado como se não existisse: o painel grava o código SEM acento e SEM
//    espaço. A loja tenta o código COMO DIGITADO (um cupom antigo pode ter
//    sido gravado com acento e não pode quebrar) e só depois a versão
//    normalizada, e SÓ quando a recusa foi "o código não existe". O código
//    que vale (tela, rascunho, pedido) é o que o servidor aceitou.
// 2) Depois que o servidor recusa o cupom no último clique, "Tirar o cupom"
//    não atualizava a lista de cartões: o mesmo cupom morto continuava lá
//    como opção.
// Dublês no molde de checkout-cupons-disponiveis.test.tsx.
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type RespostaDaValidacao = {
  valid: boolean;
  discount: number;
  message?: string;
  networkError?: boolean;
};
const NAO_EXISTE: RespostaDaValidacao = {
  valid: false,
  discount: 0,
  message: "Cupom inválido ou expirado.",
};
let respostaDaValidacao: (
  codigo: string,
  subtotal: number,
) => Promise<RespostaDaValidacao> = async () => ({
  valid: true,
  discount: 15,
});
const validateCoupon = vi.fn((codigo: string, subtotal: number) =>
  respostaDaValidacao(codigo, subtotal),
);

const mockConfig = {
  shippingCoverage: "local",
  originCep: "38500-000",
  localCepRange: "01310-100",
  enableCoupons: true,
  whatsappNumber: "34999998888",
};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

let mockCupons: CupomDisponivel[] = [];
const tentarDeNovo = vi.fn();
vi.mock("@/hooks/useCuponsDoCheckout", () => ({
  useCuponsDoCheckout: () => ({
    cupons: mockCupons,
    situacao: "pronto",
    tentarDeNovo,
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

const produtoCarrinho = {
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
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [{ product: produtoCarrinho, quantity: 1 }],
      cartTotal: 100,
      shippingFee: 0,
      clearCart: vi.fn(),
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
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon }),
}));
// Espalha o módulo REAL (a classificação da recusa mora nele).
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => false,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

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

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function digitarNoCampo(valor: string) {
  const el = hospedeiro.querySelector(
    "#coupon-code-input",
  ) as HTMLInputElement | null;
  if (!el) throw new Error("campo de cupom fora da tela");
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const botaoDoCampo = () =>
  hospedeiro
    .querySelector("#coupon-code-input")
    ?.closest("form")
    ?.querySelector('button[type="submit"]') as HTMLButtonElement | null;

async function aplicarPeloCampo(codigo: string) {
  await act(async () => {
    digitarNoCampo(codigo);
  });
  await act(async () => {
    botaoDoCampo()!.click();
  });
  await esvaziarFila();
}

beforeEach(() => {
  validateCoupon.mockClear();
  tentarDeNovo.mockClear();
  createOrder.mockReset();
  mockCupons = [];
  mockConfig.enableCoupons = true;
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  sessionStorage.clear();
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
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("CheckoutView — cupom digitado com acento ou espaço", () => {
  it("'verão10': o servidor não conhece VERÃO10, aceita VERAO10 — vale o código normalizado", async () => {
    respostaDaValidacao = async (codigo) =>
      codigo === "VERAO10" ? { valid: true, discount: 15 } : NAO_EXISTE;
    await renderizar();
    await aplicarPeloCampo("verão10");

    expect(validateCoupon.mock.calls).toEqual([
      ["VERÃO10", 100],
      ["VERAO10", 100],
    ]);
    // O que a tela, o rascunho e o pedido carregam é o código aceito.
    expect(hospedeiro.textContent).toContain("VERAO10 aplicado");
    expect(hospedeiro.textContent).not.toContain("VERÃO10");
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).toContain("VERAO10");
  });

  it("'VERAO 10' (espaço no meio) acaba aplicando VERAO10", async () => {
    respostaDaValidacao = async (codigo) =>
      codigo === "VERAO10" ? { valid: true, discount: 15 } : NAO_EXISTE;
    await renderizar();
    await aplicarPeloCampo("VERAO 10");

    expect(validateCoupon.mock.calls.map((c) => c[0])).toEqual([
      "VERAO 10",
      "VERAO10",
    ]);
    expect(hospedeiro.textContent).toContain("VERAO10 aplicado");
  });

  it("cupom ANTIGO gravado com acento continua valendo: aceito como digitado, sem segunda consulta", async () => {
    respostaDaValidacao = async (codigo) =>
      codigo === "VERÃO10" ? { valid: true, discount: 15 } : NAO_EXISTE;
    await renderizar();
    await aplicarPeloCampo("verão10");

    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("VERÃO10", 100);
    expect(hospedeiro.textContent).toContain("VERÃO10 aplicado");
  });

  it("nenhuma das duas versões existe: mostra a recusa do servidor e libera um novo toque", async () => {
    respostaDaValidacao = async () => NAO_EXISTE;
    await renderizar();
    await aplicarPeloCampo("verão10");

    expect(validateCoupon).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("Cupom inválido ou expirado.");
    expect(hospedeiro.textContent).not.toContain("aplicado");
    // A lista é relida uma vez por consulta recusada, como já era.
    await aplicarPeloCampo("verao10");
    expect(validateCoupon).toHaveBeenCalledTimes(3);
  });

  it("recusa de um cupom que EXISTE (limite de uso) não tenta a versão normalizada", async () => {
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "Cupom atingiu o limite de uso.",
    });
    await renderizar();
    await aplicarPeloCampo("verão10");

    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Cupom atingiu o limite de uso.");
  });

  it("falha de conexão na primeira consulta não tenta a segunda (a rede, não o código, é o problema)", async () => {
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "A conexão está lenta. Tente aplicar o cupom de novo.",
      networkError: true,
    });
    await renderizar();
    await aplicarPeloCampo("verão10");

    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain(
      "A conexão está lenta. Tente aplicar o cupom de novo.",
    );
  });

  it("código simples ('PROMO10') continua com UMA consulta só", async () => {
    await renderizar();
    await aplicarPeloCampo("promo10");

    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("PROMO10", 100);
    expect(hospedeiro.textContent).toContain("PROMO10 aplicado");
  });
});

describe("CheckoutView — cupom restaurado que não pôde ser conferido", () => {
  it("o aviso só manda fazer o que a tela permite: remover o cupom (ou remover e aplicar de novo)", async () => {
    sessionStorage.setItem(
      "ikcous-rascunho-do-checkout-v1",
      JSON.stringify({ notas: "x", cupom: "VIP15" }),
    );
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "A conexão está lenta. Tente aplicar o cupom de novo.",
      networkError: true,
    });
    await renderizar();
    await esvaziarFila();

    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain(
      "Remova o cupom para finalizar sem ele, ou remova e aplique o código de novo.",
    );
    // O campo de digitar não existe com um cupom aplicado: "aplique de novo"
    // sem remover antes mandava para um botão que não está na tela.
    expect(hospedeiro.querySelector("#coupon-code-input")).toBeNull();
  });
});

const vip15: CupomDisponivel = {
  codigo: "VIP15",
  tipo: "fixed",
  valor: 15,
  minimo: 0,
  validoAte: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto: 15,
};

describe("CheckoutView — recusa do cupom no último clique atualiza a lista", () => {
  async function prepararEFinalizar() {
    const { pararABuscaDeCep } = await import("./duble-busca-de-cep");
    pararABuscaDeCep();
    await renderizar();
    const pix = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pix na Entrega"),
    )!;
    await act(async () => pix.click());
    for (const [id, valor] of [
      ["checkout-name", "Cliente Teste"],
      ["checkout-tel", "34999999999"],
      ["guest-cep", "01310-100"],
      ["guest-street", "Rua Teste"],
      ["guest-number", "100"],
      ["guest-neighborhood", "Centro"],
      ["guest-city", "Cidade Teste"],
      ["guest-state", "SP"],
    ]) {
      await act(async () => {
        const el = document.getElementById(id) as HTMLInputElement;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(el, valor);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 420));
    });
    await aplicarPeloCampo("VIP15");
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    tentarDeNovo.mockClear();
    const botao = document.querySelector<HTMLButtonElement>(
      '[aria-label="Finalizar pedido"]',
    )!;
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
      await new Promise((r) => setTimeout(r, 30));
    });
    await esvaziarFila();
  }

  const botaoTirarCupom = () =>
    document.querySelector<HTMLButtonElement>(
      'button[data-acao="remover_cupom"]',
    );

  it("servidor recusa o cupom no Finalizar: 'Tirar o cupom' tira da tela E manda a lista buscar de novo", async () => {
    mockCupons = [vip15];
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message: "Cupom VIP15 inválido ou expirado.",
    });
    await prepararEFinalizar();

    expect(botaoTirarCupom()).not.toBeNull();
    // Antes do toque a lista ainda não foi relida.
    expect(tentarDeNovo).not.toHaveBeenCalled();

    await act(async () => {
      botaoTirarCupom()!.click();
    });
    await esvaziarFila();

    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(tentarDeNovo).toHaveBeenCalledTimes(1);
  });

  it("controle: tirar à mão um cupom VÁLIDO ('Remover') NÃO dispara consulta à toa", async () => {
    mockCupons = [vip15];
    await renderizar();
    await aplicarPeloCampo("VIP15");
    tentarDeNovo.mockClear();
    await act(async () => {
      (
        hospedeiro.querySelector(
          'button[aria-label="Remover cupom"]',
        ) as HTMLButtonElement
      ).click();
    });
    await esvaziarFila();

    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(tentarDeNovo).not.toHaveBeenCalled();
  });
});

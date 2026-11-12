// @vitest-environment jsdom
//
// r185-b: a cliente tem o cupom A aplicado e toca no cartão do cupom B. Com a
// conferência de B ainda pendente (rede lenta) ela toca em "Remover" no A. A
// tela fica sem cupom — e, quando a resposta de B chegava válida, o B se
// aplicava SOZINHO e mudava o total sem ela tocar em nada. A resposta de uma
// conferência que a cliente já deixou para trás (removendo o cupom) é
// descartada, sem aplicar, sem mostrar erro e sem pedir a lista de novo.
// Dublês no molde de checkout-cupons-disponiveis.test.tsx.
import type { CupomDisponivel } from "@/lib/cupons-do-checkout";
import { CheckoutView } from "@/views/customer/CheckoutView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  enableCoupons: true as boolean | undefined,
  whatsappNumber: "34999998888",
};

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: configCarregada }),
}));
// Só a prova da segunda consulta atrasa a config da loja (ver o fim do arquivo).
let configCarregada = true;

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

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    createOrder: vi.fn().mockResolvedValue({ id: "pedido-cupom" }),
    updateOrderStatus: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}));
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

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

const cupomDe = (codigo: string, desconto: number): CupomDisponivel => ({
  codigo,
  tipo: "fixed",
  valor: desconto,
  minimo: 0,
  validoAte: null,
  exclusivo: false,
  aplica: true,
  falta: 0,
  desconto,
});

/** O número do "Total" da barra de baixo (fica fora do hospedeiro). */
const totalDaBarra = () =>
  /TotalR\$\s*([\d.,]+)/.exec(document.body.textContent ?? "")?.[1] ?? null;

const botaoAplicar = (codigo: string) =>
  hospedeiro.querySelector(
    `button[aria-label="Aplicar o cupom ${codigo}"]`,
  ) as HTMLButtonElement | null;

const botaoRemover = () =>
  hospedeiro.querySelector(
    'button[aria-label="Remover cupom"]',
  ) as HTMLButtonElement | null;

/** Promessa que a prova solta quando quiser: uma por chamada de validateCoupon. */
type Segurada = {
  codigo: string;
  soltar: (v: RespostaDaValidacao) => void;
  rejeitar: (e: Error) => void;
};
let seguradas: Segurada[] = [];

/** A validação de A responde na hora (valida, R$ 15); a de B fica pendente. */
function segurarB() {
  seguradas = [];
  respostaDaValidacao = (codigo) => {
    if (codigo === "CUPOMA")
      return Promise.resolve({ valid: true, discount: 15 });
    return new Promise<RespostaDaValidacao>((soltar, rejeitar) => {
      seguradas.push({ codigo, soltar, rejeitar });
    });
  };
}

/**
 * Preenche o formulário de convidado: só com ele pronto a barra de baixo mostra
 * o Total, e é o Total que a prova precisa enxergar.
 */
async function prepararFormularioPronto() {
  const { pararABuscaDeCep } = await import("./duble-busca-de-cep");
  pararABuscaDeCep();
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
}

/** Cupom A aplicado, e o toque no cartão do B com a conferência dele pendente. */
async function aplicarAEComecarB() {
  mockCupons = [cupomDe("CUPOMA", 15), cupomDe("CUPOMB", 20)];
  segurarB();
  await act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  await prepararFormularioPronto();
  await act(async () => botaoAplicar("CUPOMA")!.click());
  await esvaziarFila();
  expect(hospedeiro.textContent).toContain("CUPOMA aplicado");
  await act(async () => botaoAplicar("CUPOMB")!.click());
  expect(hospedeiro.textContent).toContain("Aplicando");
  expect(seguradas).toHaveLength(1);
}

beforeEach(() => {
  validateCoupon.mockClear();
  tentarDeNovo.mockClear();
  mockCupons = [];
  mockConfig.enableCoupons = true;
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  seguradas = [];
  configCarregada = true;
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

describe("CheckoutView — remover o cupom com outro sendo conferido (r185-b)", () => {
  it("tirar o cupom A com a conferência de B pendente: a resposta válida de B não aplica nada e o total não muda", async () => {
    await aplicarAEComecarB();
    expect(totalDaBarra()).toBe("85,00");

    await act(async () => botaoRemover()!.click());
    expect(hospedeiro.textContent).not.toContain("CUPOMA aplicado");
    expect(totalDaBarra()).toBe("100,00");

    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 20 }));
    await esvaziarFila();

    expect(hospedeiro.textContent).not.toContain("CUPOMB aplicado");
    expect(hospedeiro.textContent).not.toContain("CUPOMA aplicado");
    // Sem a linha "Desconto" no resumo do pedido.
    expect(document.body.textContent).not.toContain("Desconto-R$");
    expect(totalDaBarra()).not.toBe("80,00");
    expect(totalDaBarra()).toBe("100,00");
    expect(hospedeiro.textContent).not.toContain("Aplicando");
    // O rascunho da sessão também não leva o cupom que ninguém aplicou.
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).not.toContain("CUPOMB");
  });

  it("controle: sem remover, a resposta válida de B aplica B e o total cai para R$ 80", async () => {
    await aplicarAEComecarB();
    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 20 }));
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("CUPOMB aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a020,00");
    expect(totalDaBarra()).toBe("80,00");
  });

  it("tirar o cupom durante a conferência solta a trava: tocar em B de novo confere e aplica B", async () => {
    await aplicarAEComecarB();
    await act(async () => botaoRemover()!.click());
    // A trava foi solta na hora: o cartão volta a poder ser tocado.
    expect(hospedeiro.textContent).not.toContain("Aplicando");
    expect(botaoAplicar("CUPOMB")!.disabled).toBe(false);

    await act(async () => botaoAplicar("CUPOMB")!.click());
    expect(seguradas).toHaveLength(2);
    expect(hospedeiro.textContent).toContain("Aplicando");

    // A resposta ATRASADA da primeira conferência chega no meio: não aplica e
    // não solta a trava da segunda (que continua em voo).
    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 99 }));
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("CUPOMB aplicado");
    expect(hospedeiro.textContent).toContain("Aplicando");

    await act(async () => seguradas[1]!.soltar({ valid: true, discount: 20 }));
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("CUPOMB aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a020,00");
    expect(totalDaBarra()).not.toBe("99,00");
  });

  it("resposta INVÁLIDA de B depois de remover: sem erro na tela e sem reler a lista de cartões", async () => {
    await aplicarAEComecarB();
    await act(async () => botaoRemover()!.click());
    await act(async () =>
      seguradas[0]!.soltar({
        valid: false,
        discount: 0,
        message: "Cupom atingiu o limite de uso.",
      }),
    );
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain(
      "Cupom atingiu o limite de uso.",
    );
    expect(hospedeiro.textContent).not.toContain("CUPOMB aplicado");
    expect(tentarDeNovo).not.toHaveBeenCalled();
  });

  it("falha de rede (a conferência lança erro) depois de remover: sem aviso de erro na tela", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await aplicarAEComecarB();
    await act(async () => botaoRemover()!.click());
    await act(async () => seguradas[0]!.rejeitar(new Error("sem rede")));
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("Erro ao validar cupom");
    expect(hospedeiro.textContent).not.toContain("CUPOMB aplicado");
    erro.mockRestore();
  });

  it("controle do erro: sem remover, a falha de rede da conferência avisa a cliente", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    await aplicarAEComecarB();
    await act(async () => seguradas[0]!.rejeitar(new Error("sem rede")));
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Erro ao validar cupom");
    erro.mockRestore();
  });
});

// r206-a: o código DIGITADO com acento ("verão10") faz o checkout consultar
// duas vezes — como digitado e, se o servidor disse "não existe", normalizado.
// A resposta da SEGUNDA consulta tem a mesma regra da primeira: se a cliente já
// tirou o cupom, ela é descartada. O campo de digitar só existe sem cupom
// aplicado, e "Remover" só com cupom: o cupom aparece no meio da conferência
// quando a config da loja chega DEPOIS do toque em "Aplicar" e devolve o
// cupom do rascunho da sessão.
describe("CheckoutView — remover o cupom durante a SEGUNDA consulta do código digitado (r206-a)", () => {
  const NAO_EXISTE: RespostaDaValidacao = {
    valid: false,
    discount: 0,
    message: "Cupom inválido ou expirado.",
  };

  /** "VERÃO10" não existe (resposta na hora), "VERAO10" fica pendente; o do rascunho vale. */
  function segurarASegundaConsulta() {
    seguradas = [];
    respostaDaValidacao = (codigo) => {
      if (codigo === "VERÃO10") return Promise.resolve(NAO_EXISTE);
      if (codigo === "VERAO10")
        return new Promise<RespostaDaValidacao>((soltar, rejeitar) => {
          seguradas.push({ codigo, soltar, rejeitar });
        });
      return Promise.resolve({ valid: true, discount: 15 });
    };
  }

  const renderizar = () =>
    act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

  /** Digita "verão10" no campo e toca em Aplicar: a primeira consulta recusa e a segunda fica pendente. */
  async function digitarEComecarASegundaConsulta() {
    segurarASegundaConsulta();
    await renderizar();
    const campo = hospedeiro.querySelector(
      "#coupon-code-input",
    ) as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(campo, "verão10");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      (
        campo
          .closest("form")!
          .querySelector('button[type="submit"]') as HTMLButtonElement
      ).click(),
    );
    await esvaziarFila();
    // A recusa de "não existe" levou à segunda consulta, e ela está pendente.
    expect(validateCoupon.mock.calls.map((c) => c[0])).toEqual([
      "VERÃO10",
      "VERAO10",
    ]);
    expect(seguradas).toHaveLength(1);
    expect(hospedeiro.textContent).toContain("Aplicando");
  }

  it("tirar o cupom com a segunda consulta pendente: a resposta válida dela não aplica o código e não deixa erro", async () => {
    configCarregada = false;
    sessionStorage.setItem(
      "ikcous-rascunho-do-checkout-v1",
      JSON.stringify({ notas: "x", cupom: "CUPOMR" }),
    );
    await digitarEComecarASegundaConsulta();

    // A config chega no meio da conferência: o cupom do rascunho entra na tela.
    configCarregada = true;
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("CUPOMR aplicado");

    await act(async () => botaoRemover()!.click());
    expect(hospedeiro.textContent).not.toContain("CUPOMR aplicado");
    expect(hospedeiro.textContent).not.toContain("Aplicando");

    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 15 }));
    await esvaziarFila();

    expect(hospedeiro.textContent).not.toContain("VERAO10 aplicado");
    expect(hospedeiro.textContent).not.toContain("aplicado");
    expect(hospedeiro.textContent).not.toContain("Erro ao validar cupom");
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).not.toContain("VERAO10");
  });

  it("controle: sem tirar nada, a resposta válida da segunda consulta aplica o código normalizado", async () => {
    await digitarEComecarASegundaConsulta();
    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 15 }));
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VERAO10 aplicado");
    expect(hospedeiro.textContent).not.toContain("VERÃO10");
  });
});

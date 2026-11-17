// @vitest-environment jsdom
//
// DINHEIRO: a resposta ANTIGA de uma revalidação automática não pode mexer no
// cupom que a cliente aplicou DEPOIS dela. Cenário: o cupom A está aplicado e a
// cliente tira um item do carrinho; o subtotal muda e o checkout revalida o A em
// segundo plano (a rede está lenta, a resposta fica pendente). Nesse meio tempo
// ela toca em "Remover" no A e aplica o B (que confere na hora). Quando a
// resposta velha do A chega:
//   - se recusada, ela apagava o B e devolvia o total SEM desconto;
//   - se válida, ela trocava o B de volta pelo A, com o desconto do A.
// A resposta de uma conferência que a cliente já deixou para trás (o cupom da
// tela mudou) é descartada. Quem descarta é o `vivo` do efeito de revalidação
// em CheckoutView.tsx (o cleanup do efeito roda quando o código do cupom muda);
// a comparação da conta (`contaRef`) cobre OUTRO risco — a troca de conta — e
// não segura este caso sozinha.
// Vizinhos: checkout-remover-cupom-durante-a-validacao-nao-deixa-o-outro-voltar
// (segura a APLICAÇÃO pelo cartão) e checkout-cupom-em-conferencia-trava-o-
// finalizar (uma revalidação pendente, sem troca de cupom). Dublês no mesmo
// molde deles.
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

const produtoDe = (id: string, price: number) => ({
  id,
  name: `Produto ${id}`,
  description: "",
  price,
  images: [],
  category: "geral",
  stock: 10,
  sold: 0,
  isActive: true,
  isBestseller: false,
  freeShipping: false,
  createdAt: new Date().toISOString(),
});
const camiseta = produtoDe("prod-1", 100);
const meia = produtoDe("prod-2", 50);

// O carrinho de AGORA: a prova o encolhe (tira a meia) entre dois renders.
let carrinhoAgora: { product: typeof camiseta; quantity: number }[] = [];
const subtotalDoCarrinho = () =>
  carrinhoAgora.reduce((s, i) => s + i.product.price * i.quantity, 0);

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinhoAgora,
      cartTotal: subtotalDoCarrinho(),
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

/** Promessa que a prova solta quando quiser: uma por revalidação do A. */
type Segurada = {
  codigo: string;
  subtotal: number;
  soltar: (v: RespostaDaValidacao) => void;
};
let seguradas: Segurada[] = [];

/**
 * Aplicar A (subtotal R$ 150) confere na hora (R$ 15); a revalidação do A com o
 * subtotal novo (R$ 100) FICA PENDENTE; o B confere na hora (R$ 20).
 */
function segurarARevalidacaoDoA() {
  seguradas = [];
  respostaDaValidacao = (codigo, subtotal) => {
    if (codigo === "CUPOMA" && subtotal === 150)
      return Promise.resolve({ valid: true, discount: 15 });
    if (codigo === "CUPOMA")
      return new Promise<RespostaDaValidacao>((soltar) => {
        seguradas.push({ codigo, subtotal, soltar });
      });
    return Promise.resolve({ valid: true, discount: 20 });
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

const renderizar = () =>
  act(async () => {
    raiz.render(
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });

/**
 * Cupom A aplicado com R$ 150 no carrinho (total R$ 135). A cliente tira a meia:
 * o subtotal vai a R$ 100 e a revalidação do A sai, pendente.
 */
async function aplicarAETirarUmItem() {
  mockCupons = [cupomDe("CUPOMA", 15), cupomDe("CUPOMB", 20)];
  segurarARevalidacaoDoA();
  await renderizar();
  await prepararFormularioPronto();
  await act(async () => botaoAplicar("CUPOMA")!.click());
  await esvaziarFila();
  expect(hospedeiro.textContent).toContain("CUPOMA aplicado");
  expect(totalDaBarra()).toBe("135,00");
  expect(seguradas).toHaveLength(0);

  carrinhoAgora = [{ product: camiseta, quantity: 1 }];
  await renderizar();
  await esvaziarFila();
  // A revalidação do A com o subtotal novo saiu e está pendente.
  expect(validateCoupon).toHaveBeenLastCalledWith("CUPOMA", 100);
  expect(seguradas).toHaveLength(1);
  expect(seguradas[0]).toMatchObject({ codigo: "CUPOMA", subtotal: 100 });
}

/** A cliente tira o A e aplica o B (que confere na hora): total R$ 80. */
async function trocarAPorB() {
  await act(async () => botaoRemover()!.click());
  expect(hospedeiro.textContent).not.toContain("CUPOMA aplicado");
  await act(async () => botaoAplicar("CUPOMB")!.click());
  await esvaziarFila();
  expect(hospedeiro.textContent).toContain("CUPOMB aplicado");
  expect(totalDaBarra()).toBe("80,00");
}

beforeEach(() => {
  validateCoupon.mockClear();
  tentarDeNovo.mockClear();
  mockCupons = [];
  mockConfig.enableCoupons = true;
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  seguradas = [];
  carrinhoAgora = [
    { product: camiseta, quantity: 1 },
    { product: meia, quantity: 1 },
  ];
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

describe("CheckoutView — a revalidação ANTIGA do cupom não mexe no cupom novo", () => {
  it("resposta RECUSADA do A (revalidação velha) depois de trocar A por B: o B continua e o total segue com o desconto do B", async () => {
    await aplicarAETirarUmItem();
    await trocarAPorB();

    await act(async () =>
      seguradas[0]!.soltar({
        valid: false,
        discount: 0,
        message: "Pedido mínimo do cupom não atingido.",
      }),
    );
    await esvaziarFila();

    expect(hospedeiro.textContent).toContain("CUPOMB aplicado");
    expect(totalDaBarra()).toBe("80,00");
    // A recusa de um cupom que já saiu não vira erro na tela do outro.
    expect(hospedeiro.textContent).not.toContain(
      "Pedido mínimo do cupom não atingido.",
    );
    // O rascunho da sessão continua com o B (a recusa velha o esquecia).
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).toContain("CUPOMB");
  });

  it("resposta VÁLIDA do A (revalidação velha) depois de trocar A por B: o B não é trocado de volta pelo A", async () => {
    await aplicarAETirarUmItem();
    await trocarAPorB();

    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 15 }));
    await esvaziarFila();

    expect(hospedeiro.textContent).toContain("CUPOMB aplicado");
    expect(hospedeiro.textContent).not.toContain("CUPOMA aplicado");
    expect(totalDaBarra()).toBe("80,00");
    expect(totalDaBarra()).not.toBe("85,00");
  });

  it("controle: sem trocar o cupom, a resposta da revalidação do MESMO A é aplicada (desconto novo e total novo)", async () => {
    await aplicarAETirarUmItem();

    await act(async () => seguradas[0]!.soltar({ valid: true, discount: 10 }));
    await esvaziarFila();

    expect(hospedeiro.textContent).toContain("CUPOMA aplicado");
    expect(totalDaBarra()).toBe("90,00");
  });

  it("controle: sem trocar o cupom, a revalidação do A que o servidor recusa ainda tira o A (total cheio, motivo na tela)", async () => {
    await aplicarAETirarUmItem();

    await act(async () =>
      seguradas[0]!.soltar({
        valid: false,
        discount: 0,
        message: "Pedido mínimo do cupom não atingido.",
      }),
    );
    await esvaziarFila();

    expect(hospedeiro.textContent).not.toContain("CUPOMA aplicado");
    expect(hospedeiro.textContent).toContain(
      "Pedido mínimo do cupom não atingido.",
    );
    expect(totalDaBarra()).toBe("100,00");
  });
});

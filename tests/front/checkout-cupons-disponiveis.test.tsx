// @vitest-environment jsdom
//
// Frente B (28/09/2026), refeita sobre o principal (09/10/2026): o cupom no
// CheckoutView.
//   - um toque em "Aplicar" valida UMA vez e toque duplo com a validação em
//     voo não valida de novo;
//   - a resposta da validação que chega depois de a conta trocar é descartada
//     (o cupom de uma conta nunca aparece aplicado na tela da outra);
//   - o rascunho da sessão só devolve o cupom para a MESMA conta que o aplicou;
//   - trocar de conta com o checkout aberto tira o cupom aplicado;
//   - o desconto sempre vale para o subtotal de AGORA (100 -> 150 -> 100).
// Dublês no molde de checkout-view-selos-contraste-aa.test.tsx. As provas que
// dirigem o campo "Tem um código de cupom?" valem antes e depois da seção de
// cartões (o campo continua na tela); as dos cartões ficam no fim.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

let mockUser: { id: string } | null = null;
let mockAuthLoading = false;
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: true,
      whatsappNumber: "34999998888",
    },
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
  useAuth: () => ({
    user: mockUser,
    profile: null,
    loading: mockAuthLoading,
  }),
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
  // Estável entre renders, como o useCallback([]) real.
  useCoupons: () => ({ validateCoupon }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

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

type Props = { subtotal?: number };

async function renderizar(props: Props = {}) {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  await act(async () => {
    raiz.render(
      <CheckoutView
        {...props}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  return CheckoutView;
}

async function esvaziarFila() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
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

/** O botão "Aplicar" do campo (type=submit do formulário do cupom). */
const botaoDoCampo = () =>
  hospedeiro
    .querySelector("#coupon-code-input")
    ?.closest("form")
    ?.querySelector('button[type="submit"]') as HTMLButtonElement | null;

/** Digita o código no campo e toca em "Aplicar" (uma vez). */
async function aplicarPeloCampo(codigo: string) {
  await act(async () => {
    digitarNoCampo(codigo);
  });
  await act(async () => {
    botaoDoCampo()!.click();
  });
}

beforeEach(() => {
  validateCoupon.mockClear();
  respostaDaValidacao = async () => ({ valid: true, discount: 15 });
  mockUser = null;
  mockAuthLoading = false;
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

describe("CheckoutView — a validação do toque em 'Aplicar' (tarefa 18)", () => {
  it("toque duplo com a validação em voo não valida de novo", async () => {
    respostaDaValidacao = () => new Promise(() => {});
    await renderizar();
    await act(async () => {
      digitarNoCampo("VIP15");
    });
    // Dois toques no MESMO instante (antes de o React redesenhar): a trava
    // tem de ser síncrona, não depender do estado já redesenhado.
    await act(async () => {
      botaoDoCampo()!.click();
      botaoDoCampo()!.click();
    });
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("validação em voo da conta A não aplica o cupom na tela da conta B", async () => {
    // A resposta que chega depois da troca é descartada: o cupom de uma conta
    // nunca aparece aplicado na tela da outra, nem no rascunho da sessão.
    let soltar: (v: { valid: boolean; discount: number }) => void = () => {};
    respostaDaValidacao = () =>
      new Promise((r) => {
        soltar = r;
      });
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    mockUser = { id: "conta-bia" };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      soltar({ valid: true, discount: 15 });
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(
      sessionStorage.getItem("ikcous-rascunho-do-checkout-v1") ?? "",
    ).not.toContain("VIP15");
  });

  it("a conta nova não fica presa atrás da validação da conta antiga que nunca responde", async () => {
    respostaDaValidacao = () => new Promise(() => {});
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    expect(validateCoupon).toHaveBeenCalledTimes(1);

    mockUser = { id: "conta-bia" };
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await aplicarPeloCampo("BIA10");
    expect(validateCoupon).toHaveBeenCalledTimes(2);
    expect(validateCoupon).toHaveBeenLastCalledWith("BIA10", 100);
  });

  it("recusa do servidor mostra o motivo e libera um novo toque", async () => {
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "Cupom inválido ou expirado.",
    });
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Cupom inválido ou expirado.");
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");

    await aplicarPeloCampo("OUTRO");
    expect(validateCoupon).toHaveBeenCalledTimes(2);
  });

  it("validação que lança erro avisa e libera um novo toque", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    respostaDaValidacao = async () => {
      throw new Error("boom");
    };
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Erro ao validar cupom");

    respostaDaValidacao = async () => ({ valid: true, discount: 15 });
    validateCoupon.mockClear();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    erro.mockRestore();
  });
});

const CHAVE_DO_RASCUNHO = "ikcous-rascunho-do-checkout-v1";

function semearRascunhoComCupom(cupom: string, contaDoCupom?: string | null) {
  sessionStorage.setItem(
    CHAVE_DO_RASCUNHO,
    JSON.stringify({
      notas: "x",
      cupom,
      ...(contaDoCupom === undefined ? {} : { contaDoCupom }),
    }),
  );
}

const rascunhoGravado = () =>
  JSON.parse(sessionStorage.getItem(CHAVE_DO_RASCUNHO) ?? "{}") as {
    cupom?: string | null;
    contaDoCupom?: string | null;
  };

/** Redesenha o MESMO componente (a conta/autenticação dos dublês já mudou). */
async function redesenhar(
  CheckoutView: Awaited<ReturnType<typeof renderizar>>,
  props: Props = {},
) {
  await act(async () => {
    raiz.render(
      <CheckoutView
        {...props}
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
}

describe("CheckoutView — o cupom nunca passa de uma conta para outra (tarefa 19)", () => {
  it("rascunho com o cupom de OUTRA conta: o código não aparece, não é validado e sai do rascunho", async () => {
    mockUser = { id: "conta-bia" };
    semearRascunhoComCupom("VIP15", "conta-ana");
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15");
    expect(validateCoupon).not.toHaveBeenCalled();
    // O código alheio também não fica esperando no armazenamento da aba.
    expect(sessionStorage.getItem(CHAVE_DO_RASCUNHO) ?? "").not.toContain(
      "VIP15",
    );
  });

  it("rascunho com o cupom da MESMA conta volta — mesmo com a autenticação chegando depois", async () => {
    mockUser = null;
    mockAuthLoading = true;
    semearRascunhoComCupom("VIP15", "conta-ana");
    const CheckoutView = await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");

    mockUser = { id: "conta-ana" };
    mockAuthLoading = false;
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("rascunho de uma conta com a sessão perdida (sem usuário): o convidado não vê o código", async () => {
    mockUser = null;
    mockAuthLoading = false;
    semearRascunhoComCupom("VIP15", "conta-ana");
    const CheckoutView = await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15");
    expect(validateCoupon).not.toHaveBeenCalled();
    // O cupom continua guardado para a dona: se ela entrar de novo, volta.
    expect(rascunhoGravado().cupom).toBe("VIP15");
    expect(rascunhoGravado().contaDoCupom).toBe("conta-ana");

    mockUser = { id: "conta-ana" };
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
  });

  it("rascunho de convidado (ou antigo, sem dono) volta para quem abrir o checkout", async () => {
    mockUser = { id: "conta-ana" };
    semearRascunhoComCupom("GERAL10");
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");
    expect(validateCoupon).toHaveBeenCalledWith("GERAL10", 100);
  });

  it("o rascunho carimba a conta que aplicou o cupom", async () => {
    mockUser = { id: "conta-ana" };
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(rascunhoGravado().cupom).toBe("VIP15");
    expect(rascunhoGravado().contaDoCupom).toBe("conta-ana");
  });

  it("o rascunho do convidado carimba 'sem conta'", async () => {
    mockUser = null;
    await renderizar();
    await aplicarPeloCampo("GERAL10");
    await esvaziarFila();
    expect(rascunhoGravado().cupom).toBe("GERAL10");
    expect(rascunhoGravado().contaDoCupom ?? null).toBeNull();
  });

  it("trocar de conta com o checkout aberto tira o cupom aplicado", async () => {
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");

    mockUser = { id: "conta-bia" };
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
  });

  it("sair da conta (virar convidado) com o checkout aberto também tira o cupom", async () => {
    mockUser = { id: "conta-ana" };
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");

    mockUser = null;
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
  });

  it("convidado que entra na conta mantém o cupom (não é troca de conta)", async () => {
    // Primeira resolução (convidado -> conta) NÃO é troca: o cupom que o
    // convidado aplicou fica (o funil manda o convidado entrar no meio do
    // checkout) e é conferido para a conta nova.
    mockUser = null;
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("GERAL10");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");

    mockUser = { id: "conta-ana" };
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");
  });

  for (const destino of [null, "conta-bia"]) {
    it(`Ana aplica o exclusivo, a aba passa para ${destino ?? "sem conta"} e a Bia abre o checkout: o código nunca aparece para a Bia`, async () => {
      // No commit da troca o cupom velho ainda está no estado; carimbá-lo com
      // a conta NOVA no rascunho o faria reaparecer na tela da Bia.
      respostaDaValidacao = async () =>
        mockUser?.id === "conta-ana"
          ? { valid: true, discount: 15 }
          : {
              valid: false,
              discount: 0,
              message: "Cupom inválido ou expirado.",
            };
      mockUser = { id: "conta-ana" };
      const CheckoutView = await renderizar();
      await aplicarPeloCampo("VIP15");
      await esvaziarFila();
      expect(hospedeiro.textContent).toContain("VIP15 aplicado");

      mockUser = destino ? { id: destino } : null;
      await redesenhar(CheckoutView);
      await esvaziarFila();

      act(() => raiz.unmount());
      raiz = createRoot(hospedeiro);
      validateCoupon.mockClear();
      let viuAplicado = false;
      const olho = new MutationObserver(() => {
        if (hospedeiro.textContent?.includes("VIP15 aplicado")) {
          viuAplicado = true;
        }
      });
      olho.observe(hospedeiro, {
        subtree: true,
        childList: true,
        characterData: true,
      });
      mockUser = { id: "conta-bia" };
      await renderizar();
      await esvaziarFila();
      olho.disconnect();
      expect(viuAplicado).toBe(false);
      expect(validateCoupon).not.toHaveBeenCalled();
    });
  }
});

describe("CheckoutView — o desconto vale para o subtotal de agora, sem validar à toa (tarefa 20)", () => {
  /** 10% do subtotal: o desconto muda quando o carrinho muda. */
  const dezPorCento = async (_codigo: string, subtotal: number) => ({
    valid: true,
    discount: subtotal / 10,
  });

  it("um toque em 'Aplicar' valida UMA vez e mostra a economia", async () => {
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("VIP15", 100);
  });

  it("subtotal que vai e volta (100 → 150 → 100) revalida e volta ao desconto de 100", async () => {
    // O atalho do par já conferido guardava só o par do toque: na volta para
    // 100 a tela ficava com o desconto de 150.
    respostaDaValidacao = dezPorCento;
    const CheckoutView = await renderizar({ subtotal: 100 });
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a010,00");
    await redesenhar(CheckoutView, { subtotal: 150 });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    await redesenhar(CheckoutView, { subtotal: 100 });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a010,00");
    expect(validateCoupon).toHaveBeenLastCalledWith("VIP15", 100);
  });

  it("o subtotal muda enquanto a validação do toque está em voo: vale o desconto do subtotal de agora", async () => {
    let soltar: (v: RespostaDaValidacao) => void = () => {};
    respostaDaValidacao = (codigo, subtotal) =>
      subtotal === 100
        ? new Promise((r) => {
            soltar = r;
          })
        : dezPorCento(codigo, subtotal);
    const CheckoutView = await renderizar({ subtotal: 100 });
    await aplicarPeloCampo("VIP15");
    await redesenhar(CheckoutView, { subtotal: 150 });
    await act(async () => {
      soltar({ valid: true, discount: 10 });
    });
    await esvaziarFila();
    // A resposta de 100 chegou, mas a tela está em 150: confere de novo.
    expect(validateCoupon).toHaveBeenLastCalledWith("VIP15", 150);
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
    expect(hospedeiro.textContent).not.toContain(
      "Você economiza R$\u00a010,00",
    );
  });

  it("subtotal que passa a não bater o mínimo tira o cupom e mostra o motivo", async () => {
    respostaDaValidacao = async (_codigo, subtotal) =>
      subtotal >= 100
        ? { valid: true, discount: 15 }
        : { valid: false, discount: 0, message: "Compra mínima de R$ 100,00." };
    const CheckoutView = await renderizar({ subtotal: 100 });
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    await redesenhar(CheckoutView, { subtotal: 60 });
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain("Compra mínima de R$ 100,00.");
  });

  it("falha de rede na revalidação mantém o cupom como está", async () => {
    const CheckoutView = await renderizar({ subtotal: 100 });
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      networkError: true,
    });
    await redesenhar(CheckoutView, { subtotal: 150 });
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(hospedeiro.textContent).toContain("Você economiza R$\u00a015,00");
  });

  it("remover e aplicar de novo o mesmo cupom valida uma vez a cada toque", async () => {
    await renderizar();
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    await act(async () => {
      (
        hospedeiro.querySelector(
          'button[aria-label="Remover cupom"]',
        ) as HTMLButtonElement
      ).click();
    });
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("VIP15 aplicado");
    await aplicarPeloCampo("VIP15");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(validateCoupon).toHaveBeenCalledTimes(2);
  });

  it("cupom restaurado do rascunho é conferido uma vez só", async () => {
    mockUser = { id: "conta-ana" };
    semearRascunhoComCupom("VIP15", "conta-ana");
    await renderizar();
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("VIP15 aplicado");
    expect(validateCoupon).toHaveBeenCalledTimes(1);
  });

  it("convidado aplica, entra na conta: o cupom fica e é revalidado para a conta nova", async () => {
    // O funil manda o convidado entrar na conta no meio do checkout — o cupom
    // dele volta a ser conferido, agora para quem entrou.
    mockUser = null;
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("GERAL10");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");
    validateCoupon.mockClear();

    mockUser = { id: "conta-ana" };
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(validateCoupon).toHaveBeenCalledTimes(1);
    expect(validateCoupon).toHaveBeenCalledWith("GERAL10", 100);
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");
  });

  it("convidado entra na conta e o cupom não vale para ela: sai com o motivo", async () => {
    mockUser = null;
    const CheckoutView = await renderizar();
    await aplicarPeloCampo("GERAL10");
    await esvaziarFila();
    expect(hospedeiro.textContent).toContain("GERAL10 aplicado");

    respostaDaValidacao = async () => ({
      valid: false,
      discount: 0,
      message: "Cupom inválido ou expirado.",
    });
    mockUser = { id: "conta-ana" };
    await redesenhar(CheckoutView);
    await esvaziarFila();
    expect(hospedeiro.textContent).not.toContain("GERAL10 aplicado");
    expect(hospedeiro.textContent).toContain("Cupom inválido ou expirado.");
  });
});

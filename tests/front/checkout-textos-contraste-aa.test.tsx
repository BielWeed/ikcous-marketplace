// @vitest-environment jsdom
//
// Defeito: textos do checkout abaixo do contraste AA (4,5:1 para texto normal;
// todos têm menos de 24 px):
//   - "Ver Meus Pedidos" (tela de pagamento recebido DEPOIS do prazo) e
//     "Entrar ou criar conta" (aviso do convidado) usavam `text-primary`: a
//     cor DA LOJA como cor de texto sobre fundo claro. Com a cor da loja
//     branca o texto some (1,0:1);
//   - "Entrega fora da cidade é só com conta": `text-amber-600` sobre o
//     âmbar claro do aviso (~2,95:1);
//   - "R$ ... recebido" na tela de pagamento fora do prazo: `text-amber-600`
//     sobre o branco (~3,19:1);
//   - o título "Endereço de Entrega" (convidado e logada): `text-zinc-400`
//     sobre o branco (~2,56:1).
//
// Em vez de prender classes, o teste calcula a razão WCAG a partir das
// classes que o componente de fato renderiza (contraste-das-classes.ts), e
// para o texto que depende da cor da loja repete a conta com cores de loja
// variadas, a branca inclusive. Montagens copiadas de
// checkout-convidado-so-compra-local.test.tsx (convidado de fora da cidade) e
// numero-do-pedido-igual-nas-telas-de-confirmacao.test.tsx (pagamento fora do
// prazo, via retomada + verificação periódica).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRANCO,
  CORES_DA_LOJA,
  type Rgb,
  ZINC_50,
  corDaClasse,
  razao,
} from "./contraste-das-classes";

const AA = 4.5;

const { estado, usuario } = vi.hoisted(() => ({
  usuario: { id: "user-1" },
  estado: {
    logada: false,
    cobertura: "national",
    carrinhoVazio: false,
  },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: estado.cobertura,
      originCep: "38500-000",
      enableCoupons: false,
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
    user: estado.logada ? usuario : null,
    profile: null,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: estado.carrinhoVazio
        ? []
        : [
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
      cartTotal: estado.carrinhoVazio ? 0 : 100,
      shippingFee: 0,
      freteIndefinido: false,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
      setSelectedShippingOption: () => {},
      setShippingCep: () => {},
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// A leitura do pedido é controlada pelo teste (retomada do pagamento).
const { lerPedido, lerPoll } = vi.hoisted(() => ({
  lerPedido: vi.fn(),
  lerPoll: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
          single: () => lerPoll(),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { ESTADO_PRONTO_SEM_CARTAO } = await import(
    "./duble-use-config-do-cartao"
  );
  return { useConfigDoCartao: () => ESTADO_PRONTO_SEM_CARTAO };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const botaoPorTexto = (texto: string) =>
  [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;

/** Texto sobre `fundo`, com a cor da loja que o cenário escolher. */
function razaoDoTexto(el: Element, fundo: Rgb, loja: Rgb = BRANCO) {
  return razao(corDaClasse(el.className, "text", fundo, loja), fundo);
}

describe("CheckoutView — textos do convidado e da logada (contraste AA)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.logada = false;
    estado.cobertura = "national";
    estado.carrinhoVazio = false;
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
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
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={() => {}} onSetBackOverride={() => {}} />,
      );
    });
  }

  // A barra com o aviso renderiza com atraso (useDeferredRender) e por PORTAL
  // no document.body.
  async function esperarBarra() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  it("convidado de fora da cidade: o título do aviso passa de 4,5:1 sobre o âmbar claro", async () => {
    await montar();
    act(() => {
      digitar("guest-cep", "01310100");
    });
    await esperarBarra();

    const titulo = [...document.querySelectorAll("p")].find((p) =>
      p.textContent?.includes("Entrega fora da cidade é só com conta"),
    ) as HTMLElement;
    expect(titulo).toBeDefined();
    const aviso = titulo.parentElement as HTMLElement;

    for (const base of [BRANCO, ZINC_50]) {
      const fundo = corDaClasse(aviso.className, "bg", base);
      expect(
        razaoDoTexto(titulo, fundo),
        `título do aviso (${titulo.className}) sobre ${aviso.className}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });

  it("convidado de fora da cidade: 'Entrar ou criar conta' continua legível com QUALQUER cor da loja, a branca inclusive", async () => {
    await montar();
    act(() => {
      digitar("guest-cep", "01310100");
    });
    await esperarBarra();

    const botao = botaoPorTexto("Entrar ou criar conta");
    expect(botao).toBeDefined();
    const aviso = botao.parentElement as HTMLElement;

    for (const base of [BRANCO, ZINC_50]) {
      for (const [nome, loja] of CORES_DA_LOJA) {
        const fundoDoAviso = corDaClasse(aviso.className, "bg", base, loja);
        const fundo = corDaClasse(botao.className, "bg", fundoDoAviso, loja);
        expect(
          razaoDoTexto(botao, fundo, loja),
          `botão (${botao.className}) com a loja ${nome}`,
        ).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it("convidado: o título 'Endereço de Entrega' passa de 4,5:1 sobre o branco", async () => {
    await montar();

    const titulos = [...document.querySelectorAll("span")].filter(
      (s) => s.textContent?.trim() === "Endereço de Entrega",
    );
    expect(titulos.length).toBeGreaterThan(0);
    for (const titulo of titulos)
      for (const base of [BRANCO, ZINC_50])
        expect(
          razaoDoTexto(titulo, base),
          `título (${titulo.className})`,
        ).toBeGreaterThanOrEqual(AA);
  });

  it("logada: o título 'Endereço de Entrega' passa de 4,5:1 sobre o branco", async () => {
    estado.logada = true;
    await montar();

    const titulos = [...document.querySelectorAll("span")].filter(
      (s) => s.textContent?.trim() === "Endereço de Entrega",
    );
    expect(titulos.length).toBeGreaterThan(0);
    for (const titulo of titulos)
      for (const base of [BRANCO, ZINC_50])
        expect(
          razaoDoTexto(titulo, base),
          `título (${titulo.className})`,
        ).toBeGreaterThanOrEqual(AA);
  });
});

describe("CheckoutView — pagamento recebido fora do prazo (contraste AA)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    estado.logada = true;
    estado.cobertura = "local";
    estado.carrinhoVazio = true;
    lerPedido.mockReset().mockResolvedValue({
      data: { total: 149.9, metodo_online: "pix" },
      error: null,
    });
    lerPoll.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
  });

  async function chegarNaTelaForaDoPrazo() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId="c35ce4dd-1234-4abc-8def-1a2b3c3884be"
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    lerPoll.mockResolvedValue({
      data: {
        payment_status: "pago_apos_expirar",
        status: "cancelled",
        gateway_payment_id: "pay-1",
        expires_at: null,
      },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // A armadilha precisa estar de fato presente.
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
  }

  it("o valor 'R$ ... recebido' passa de 4,5:1 sobre o branco", async () => {
    await chegarNaTelaForaDoPrazo();

    const valor = [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.endsWith("recebido"),
    ) as HTMLElement;
    expect(valor).toBeDefined();
    expect(
      razaoDoTexto(valor, BRANCO),
      `valor recebido (${valor.className})`,
    ).toBeGreaterThanOrEqual(AA);
  });

  it("'Ver Meus Pedidos' continua legível sobre o branco com QUALQUER cor da loja, a branca inclusive", async () => {
    await chegarNaTelaForaDoPrazo();

    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Ver Meus Pedidos"),
    ) as HTMLElement;
    expect(botao).toBeDefined();
    for (const [nome, loja] of CORES_DA_LOJA) {
      const fundo = corDaClasse(botao.className, "bg", BRANCO, loja);
      expect(
        razaoDoTexto(botao, fundo, loja),
        `botão (${botao.className}) com a loja ${nome}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  });
});

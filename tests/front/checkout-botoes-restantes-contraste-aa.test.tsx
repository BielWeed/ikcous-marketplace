// @vitest-environment jsdom
//
// Defeito: sobraram, no checkout, botões de texto pequeno sobre fundo CLARO
// com `text-primary` -- a cor DA LOJA usada como cor de texto. Com a cor da
// loja branca (o painel permite) o rótulo some (1,0:1). O PR #1547 já tirou
// dois ("Entrar ou criar conta" do aviso de fora da cidade e "Ver Meus
// Pedidos" do pagamento fora do prazo); faltavam:
//   - "Retornar à Vitrine" (pagamento confirmado, pagamento fora do prazo e
//     pedido recebido) sobre o branco;
//   - "Entrar ou criar conta" do aviso das mais de 10 unidades do visitante;
//   - "Escolher outro frete" e "Tirar o cupom" do aviso de total zero.
//
// Em vez de prender classes, o teste calcula a razão WCAG a partir das classes
// que o componente de fato renderiza (contraste-das-classes.ts), com cores de
// loja variadas, a branca inclusive. As três telas alcançáveis com a montagem
// de checkout-textos-contraste-aa.test.tsx são medidas renderizadas; as outras
// (pedido recebido e total zero exigem fluxos longos de cupom e envio, que
// têm suítes próprias) ficam presas pela leitura do código: nenhum botão do
// checkout pode usar `text-primary` sobre fundo que não seja o `bg-primary`
// cheio.
import { readFileSync } from "node:fs";
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

const { estado } = vi.hoisted(() => ({
  estado: { unidades: 1 },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
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

const { usuario, auth } = vi.hoisted(() => ({
  usuario: { id: "user-1" },
  auth: { logada: false },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: auth.logada ? usuario : null,
    profile: null,
    loading: false,
  }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            description: "",
            price: 10,
            images: [],
            category: "geral",
            stock: 50,
            sold: 0,
            isActive: true,
            isBestseller: false,
            freeShipping: false,
            createdAt: new Date(0).toISOString(),
          },
          quantity: estado.unidades,
        },
      ],
      cartTotal: 10 * estado.unidades,
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

/** Texto sobre `fundo`, com a cor da loja que o cenário escolher. */
function razaoDoTexto(el: Element, fundo: Rgb, loja: Rgb = BRANCO) {
  return razao(corDaClasse(el.className, "text", fundo, loja), fundo);
}

describe("CheckoutView — botões que sobravam com text-primary (contraste AA)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    auth.logada = false;
    estado.unidades = 1;
    lerPedido.mockReset().mockResolvedValue({
      data: { total: 149.9, metodo_online: "pix" },
      error: null,
    });
    lerPoll.mockReset();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar(retomarPedidoId?: string) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={() => {}}
          onSetBackOverride={() => {}}
          retomarPedidoId={retomarPedidoId}
        />,
      );
    });
  }

  // Retomada: a leitura periódica do pedido devolve o `payment_status` dado.
  async function chegarNaTelaFinal(payment_status: string) {
    auth.logada = true;
    await montar("c35ce4dd-1234-4abc-8def-1a2b3c3884be");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    lerPoll.mockResolvedValue({
      data: {
        payment_status,
        status: "cancelled",
        gateway_payment_id: "pay-1",
        expires_at: null,
      },
      error: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
  }

  function exigirBotaoLegivel(botao: HTMLElement, fundoDeBase: Rgb) {
    for (const [nome, loja] of CORES_DA_LOJA) {
      const fundo = corDaClasse(botao.className, "bg", fundoDeBase, loja);
      expect(
        razaoDoTexto(botao, fundo, loja),
        `botão (${botao.className}) com a loja ${nome}`,
      ).toBeGreaterThanOrEqual(AA);
    }
  }

  const botaoPorTexto = (texto: string) =>
    [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLElement;

  it("pagamento confirmado: 'Retornar à Vitrine' continua legível sobre o branco com QUALQUER cor da loja", async () => {
    await chegarNaTelaFinal("pago");
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");

    const botao = botaoPorTexto("Retornar à Vitrine");
    expect(botao).toBeDefined();
    exigirBotaoLegivel(botao, BRANCO);
  });

  it("pagamento fora do prazo: 'Retornar à Vitrine' continua legível sobre o branco com QUALQUER cor da loja", async () => {
    await chegarNaTelaFinal("pago_apos_expirar");
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");

    const botao = botaoPorTexto("Retornar à Vitrine");
    expect(botao).toBeDefined();
    exigirBotaoLegivel(botao, BRANCO);
  });

  it("visitante com 11 unidades: 'Entrar ou criar conta' do aviso do limite continua legível com QUALQUER cor da loja", async () => {
    estado.unidades = 11;
    await montar();
    // A barra com o aviso nasce com atraso (useDeferredRender).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });

    const botao = botaoPorTexto("Entrar ou criar conta");
    expect(
      botao,
      "o aviso do limite de unidades precisa estar na tela",
    ).toBeDefined();
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
});

describe("CheckoutView — nenhum botão de texto usa a cor da loja como cor de letra", () => {
  // As telas de pedido recebido e de total zero ("Retornar à Vitrine",
  // "Escolher outro frete", "Tirar o cupom") só aparecem depois de fluxos
  // longos; a leitura do código cobre todas de uma vez. `text-primary` puro
  // só serve sobre `bg-primary` CHEIO (aí a cor da letra é outro assunto);
  // `text-primary-foreground` é outra classe e não casa.
  const fonte = readFileSync("src/views/customer/CheckoutView.tsx", "utf8");

  it("toda classe `text-primary` do arquivo está num elemento com `bg-primary` cheio", () => {
    const culpados: string[] = [];
    for (const [, classes] of fonte.matchAll(/className="([^"]*)"/g)) {
      const fichas = (classes ?? "").split(/\s+/);
      if (fichas.includes("text-primary") && !fichas.includes("bg-primary"))
        culpados.push(classes ?? "");
    }
    expect(culpados).toEqual([]);
  });
});

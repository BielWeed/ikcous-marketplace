// @vitest-environment jsdom
//
// A VISITANTE DEIXA O E-MAIL DEPOIS DA COMPRA (lote 579, decisão do sócio de
// 28/11/2026). Quem compra sem conta nunca recebia comprovante, e o
// "Rastrear sem Conta" exige o e-mail gravado no pedido: era um beco. Agora a
// tela "Pedido recebido!" da visitante convida, UMA vez, a deixar o e-mail; a
// tela grava pela RPC informar_email_da_visitante (com o id completo do
// pedido) e pede o comprovante à edge send-order-confirmation (que lê o
// destinatário do banco). O teto diário de e-mails da loja vale: se ele barrar,
// a tela diz isso, sem fingir que enviou. Quem tem conta não vê o convite.
//
// Dublês copiados de checkout-convidado-sai-do-beco-na-tela-de-sucesso.test.tsx
// (o mesmo caminho até a tela de sucesso); o que muda é o dublê do supabase.
// E-mail de teste inventado, no domínio reservado .test.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { concluirBuscaDeCepSemEndereco } from "./duble-busca-de-cep";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn();
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// Mutável: convidado x autenticado por teste (mesmo padrão do arquivo
// copiado) — o botão da tela de sucesso muda de comportamento com isto.
let mockUser: { id: string } | null = null;
// Mutável: o teste "sem WhatsApp" esvazia isto sem afetar os outros.
let mockWhatsappNumber: string | undefined = "34999998888";

// A conferência da sessão antes de enviar (caça 7) tem suíte própria
// (checkout-pedido-chave-voltar-e-sessao.test.tsx); aqui a sessão está viva.
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: mockUser
        ? [
            {
              id: "addr-1",
              user_id: "user-1",
              name: "Casa",
              recipient_name: "Cliente Teste",
              cep: "38500-000",
              street: "Rua Teste",
              number: "100",
              neighborhood: "Centro",
              city: "Monte Carmelo",
              state: "MG",
              is_default: true,
            },
          ]
        : [],
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
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
      clearCart,
      addToCart,
      // ENTREGA LOCAL selecionada (regra frete × pagamento do dono,
      // 21/09/2026): a guarda do Finalizar (`finalizarBloqueadoPorFrete`)
      // passou a exigir a ESCOLHA de entrega — o servidor recusa id ausente
      // (FRETE V2 EMENDA, ELSIF do bloco 4). O assunto deste arquivo é outro;
      // sem a opção, o botão travaria por um motivo que ele não prova.
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: mockUser ? "38500-000" : "01310-100",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// O convite só fala com o banco por duas portas: a RPC que grava o e-mail e a
// edge que manda o comprovante. Qualquer outra RPC falha como falharia com o
// objeto vazio do arquivo de origem (nenhum caminho deste checkout a usa).
const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, functions: { invoke } },
}));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

const EMAIL = "cliente.teste@exemplo.test";
let respostaDaEdge: { data: unknown; error: unknown } = {
  data: { ok: true },
  error: null,
};
// O checkout usa outras RPCs e edges (frete, endereço); só estas duas são do convite.
const gravacoes = () =>
  rpc.mock.calls.filter(([nome]) => nome === "informar_email_da_visitante");
const comprovantes = () =>
  invoke.mock.calls.filter(([nome]) => nome === "send-order-confirmation");

function digitarNoConvite(valor: string) {
  const campo = document.getElementById(
    "convite-comprovante-email",
  ) as HTMLInputElement | null;
  expect(campo).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo!.dispatchEvent(new Event("input", { bubbles: true }));
}

async function enviarConvite() {
  const botao = localizarBotaoPorTexto(document.body, "Receber por e-mail");
  expect(botao).not.toBeUndefined();
  await act(async () => {
    botao!.click();
  });
  // A RPC e a edge são duas promessas encadeadas.
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("CheckoutView — a visitante deixa o e-mail na tela de sucesso (lote 579)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    updateOrderStatus.mockClear();
    clearCart.mockClear();
    addToCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    rpc.mockReset();
    invoke.mockReset();
    rpc.mockImplementation((nome: string) => {
      if (nome === "informar_email_da_visitante") {
        return Promise.resolve({
          data: { ok: true, motivo: "gravado" },
          error: null,
        });
      }
      throw new TypeError(`rpc inesperada no teste: ${nome}`);
    });
    respostaDaEdge = { data: { ok: true }, error: null };
    // Só a edge do comprovante responde; as outras (a cotação do frete) falham
    // como falhariam com o objeto vazio do arquivo de origem.
    invoke.mockImplementation((nome: string) => {
      if (nome === "send-order-confirmation") {
        return Promise.resolve(respostaDaEdge);
      }
      throw new TypeError(`edge inesperada no teste: ${nome}`);
    });
    mockUser = null;
    mockWhatsappNumber = "34999998888";
    const armazem = new Map<string, string>();
    concluirBuscaDeCepSemEndereco();
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function chegarNaTelaDeSucesso() {
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
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      if (!mockUser) {
        digitar("guest-street", "Rua Teste");
        digitar("guest-number", "100");
        digitar("guest-neighborhood", "Centro");
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    if (!mockUser) {
      await act(async () => {
        digitar("guest-cep", "01310-100");
        await Promise.resolve();
      });
      await act(async () => {
        digitar("guest-city", "Cidade Teste");
        await Promise.resolve();
      });
      await act(async () => {
        digitar("guest-state", "SP");
        await Promise.resolve();
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    await act(async () => {
      botaoFinalizar.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hospedeiro.textContent).toContain("Pedido recebido!");
  }

  it("a visitante vê o convite, envia o e-mail e a tela confirma; o campo some", async () => {
    await chegarNaTelaDeSucesso();
    expect(hospedeiro.textContent).toContain(
      "Quer receber o comprovante e acompanhar o pedido por e-mail?",
    );
    // O campo é opcional: o resto da tela (WhatsApp, voltar) continua ali.
    expect(localizarBotaoPorTexto(hospedeiro, "WhatsApp")).not.toBeUndefined();

    await act(async () => {
      digitarNoConvite(`  ${EMAIL} `);
    });
    await enviarConvite();

    // O id COMPLETO do pedido vai para o banco; o e-mail vai aparado.
    expect(gravacoes()).toEqual([
      [
        "informar_email_da_visitante",
        { p_order_id: "ped-999", p_email: EMAIL },
      ],
    ]);
    // O comprovante: só o id e a marca da visitante; o destinatário é do banco.
    expect(comprovantes()).toEqual([
      [
        "send-order-confirmation",
        { body: { orderId: "ped-999", comoVisitante: true } },
      ],
    ]);
    expect(hospedeiro.textContent).toContain(
      `Pronto! Enviamos o comprovante para ${EMAIL}.`,
    );
    expect(document.getElementById("convite-comprovante-email")).toBeNull();
    expect(
      localizarBotaoPorTexto(hospedeiro, "Receber por e-mail"),
    ).toBeUndefined();
  });

  it("e-mail com formato errado: a tela pede para conferir e não chama o banco", async () => {
    await chegarNaTelaDeSucesso();
    await act(async () => {
      digitarNoConvite("cliente sem arroba");
    });
    await enviarConvite();
    expect(gravacoes()).toEqual([]);
    expect(comprovantes()).toEqual([]);
    expect(hospedeiro.textContent).toContain(
      "Confira o e-mail: ele precisa ter o formato nome@provedor.com.",
    );
    // Continua dando para corrigir.
    expect(document.getElementById("convite-comprovante-email")).not.toBeNull();
  });

  it("o teto diário barra o comprovante: a tela diz que NÃO enviou e que o e-mail ficou guardado", async () => {
    respostaDaEdge = {
      data: { ok: false, motivo: "teto_diario" },
      error: null,
    };
    await chegarNaTelaDeSucesso();
    await act(async () => {
      digitarNoConvite(EMAIL);
    });
    await enviarConvite();
    expect(gravacoes()).toHaveLength(1);
    expect(comprovantes()).toHaveLength(1);
    expect(hospedeiro.textContent).toContain(
      "Seu e-mail ficou guardado, mas a loja atingiu o limite de e-mails de hoje e o comprovante não foi enviado.",
    );
    expect(hospedeiro.textContent).not.toContain("Enviamos o comprovante");
    expect(document.getElementById("convite-comprovante-email")).toBeNull();
  });

  it("o banco recusa (fora do prazo): a tela diz, não chama a edge e o campo some", async () => {
    rpc.mockImplementation((nome: string) => {
      if (nome === "informar_email_da_visitante") {
        return Promise.resolve({
          data: { ok: false, motivo: "fora_do_prazo" },
          error: null,
        });
      }
      throw new TypeError(`rpc inesperada no teste: ${nome}`);
    });
    await chegarNaTelaDeSucesso();
    await act(async () => {
      digitarNoConvite(EMAIL);
    });
    await enviarConvite();
    expect(gravacoes()).toHaveLength(1);
    expect(comprovantes()).toEqual([]);
    expect(hospedeiro.textContent).toContain(
      "O prazo para informar o e-mail deste pedido acabou.",
    );
    expect(document.getElementById("convite-comprovante-email")).toBeNull();
  });

  it("quem tem conta não vê o convite", async () => {
    mockUser = { id: "user-1" };
    await chegarNaTelaDeSucesso();
    expect(hospedeiro.textContent).not.toContain(
      "Quer receber o comprovante e acompanhar o pedido por e-mail?",
    );
    expect(document.getElementById("convite-comprovante-email")).toBeNull();
    expect(gravacoes()).toEqual([]);
    expect(comprovantes()).toEqual([]);
  });
});

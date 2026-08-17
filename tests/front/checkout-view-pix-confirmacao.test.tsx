// @vitest-environment jsdom
//
// CHECKOUT-090: a tela do PIX avisa o cliente quando o pagamento é
// confirmado, em vez de mostrar o QR para sempre. Modelo estrutural copiado
// de checkout-view-cancelar-pagamento-falho.test.tsx (mesmos dublês, mesma
// forma de chegar em "Finalize o pagamento") — este arquivo acrescenta o que
// muda a partir de lá: o `onRealtimeEvent` capturado do `useOrders` mocado,
// e um dublê de `supabase.from("marketplace_orders")` controlável para a
// verificação periódica (rede de segurança contra WebSocket caído).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const updateOrderStatus = vi.fn().mockResolvedValue(undefined);
const clearCart = vi.fn();
const addToCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;
type EventoRealtime = (payload: {
  eventType: string;
  new?: Record<string, unknown>;
}) => void;

// Mutável porque a suíte precisa provar os dois lados: sessão autenticada
// (realtime liga, verificação periódica liga) e convidado (as duas ficam
// desligadas — a política de RLS não dá caminho nenhum pelo banco para
// convidado, ver o relatório da tarefa).
let mockUser: { id: string } | null = { id: "user-1" };

// Capturado toda vez que CheckoutView chama useOrders(...) — é assim que o
// teste dispara um "evento de realtime" sem montar o canal do Supabase de
// verdade.
let onRealtimeEventCapturado: EventoRealtime | null = null;

// Mutável: o teste 6 (sem whatsapp_number) precisa esvaziar isto sem tocar
// nos outros. O default é um número válido — os testes de "fora do prazo"
// que não mexem nele exercitam o caminho COM WhatsApp configurado.
let mockWhatsappNumber: string | undefined = "34999998888";

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
      whatsappNumber: mockWhatsappNumber,
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [
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
    ],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

let mockCart = [
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
];
let mockCartTotal = 100;
let mockShippingFee = 0;

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: mockCart,
    cartTotal: mockCartTotal,
    shippingFee: mockShippingFee,
    clearCart: () => {
      clearCart();
      mockCart = [];
      mockCartTotal = 0;
      mockShippingFee = 0;
    },
    addToCart: (
      product: unknown,
      quantity: number,
      variantId?: string,
      variantNames?: string,
    ) => addToCart(product, quantity, variantId, variantNames),
    selectedShippingOption: null,
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// A captura do terceiro argumento (`options.onRealtimeEvent`) é o ponto
// central deste arquivo — sem ela não dá para simular o webhook confirmando
// o pagamento sem montar um canal de realtime de verdade.
//
// Achado 2 da revisão (16/08/2026): os dois primeiros argumentos também são
// capturados, e HÁ um teste que os afirma (abaixo) — sem isso, reverter
// `useOrders(true, false, {...})` para `useOrders(false, true, {...})`
// (LITERALMENTE o bug CHECKOUT-090 que esta branch corrige: `enabled=false`
// desliga o efeito inteiro na primeira linha de useOrders.ts, nenhuma
// assinatura de realtime é criada) deixava esta suíte inteira verde.
let useOrdersArgsCapturados: [boolean | undefined, boolean | undefined] = [
  undefined,
  undefined,
];

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    enabled?: boolean,
    isAdmin?: boolean,
    options?: { onRealtimeEvent?: EventoRealtime },
  ) => {
    useOrdersArgsCapturados = [enabled, isAdmin];
    onRealtimeEventCapturado = options?.onRealtimeEvent ?? null;
    return { createOrder, updateOrderStatus };
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// Dublê de `supabase.from("marketplace_orders")...select("payment_status,
// expires_at")...eq("id", ...)...single()` — é a rota que a verificação
// periódica usa. `mockRespostaPoll` é mutável por teste; `fromSpy` conta
// quantas vezes a consulta saiu (prova de "não dispara em segundo plano" e
// de "para depois de confirmar").
//
// Achado ANOTADO da revisão (16/08/2026): antes deste dublê IGNORAVA os
// argumentos de `select()` e `eq()` — trocar `.eq("id", orderId)` por
// `.eq("id", "qualquer-coisa")` no código deixava a suíte inteira verde,
// porque `single()` sempre devolvia `mockRespostaPoll` não importa o que
// fosse pedido. Agora `selectSpy`/`eqSpy` gravam os argumentos de verdade
// (afirmados no teste "consulta as colunas certas...", abaixo) e `single()`
// só devolve `mockRespostaPoll` quando o `id` pedido é o do pedido em tela
// ("ped-999") — consultar por outro id volta vazio, com erro, igual um
// `.single()` de verdade contra uma linha que não existe.
const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
let mockRespostaPoll: {
  data: { payment_status: string | null; expires_at: string | null } | null;
  error: { message: string } | null;
} = { data: { payment_status: "aguardando", expires_at: null }, error: null };

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      fromSpy(tabela);
      return {
        select: (colunas: string) => {
          selectSpy(colunas);
          return {
            eq: (coluna: string, valor: string) => {
              eqSpy(coluna, valor);
              return {
                single: () =>
                  coluna === "id" && valor === "ped-999"
                    ? Promise.resolve(mockRespostaPoll)
                    : Promise.resolve({
                        data: null,
                        error: { message: "not found" },
                      }),
              };
            },
          };
        },
      };
    },
  },
}));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

vi.mock("@/lib/flags", () => ({
  PAGAMENTO_ONLINE_LIGADO: true,
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

function definirVisibilidade(estado: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: estado,
    configurable: true,
  });
}

describe("CheckoutView — confirmação de pagamento na tela do PIX (CHECKOUT-090)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    updateOrderStatus.mockClear();
    clearCart.mockClear();
    addToCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    fromSpy.mockClear();
    selectSpy.mockClear();
    eqSpy.mockClear();
    onRealtimeEventCapturado = null;
    useOrdersArgsCapturados = [undefined, undefined];
    mockUser = { id: "user-1" };
    mockWhatsappNumber = "34999998888";
    mockRespostaPoll = {
      data: { payment_status: "aguardando", expires_at: null },
      error: null,
    };
    mockCart = [
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
    ];
    mockCartTotal = 100;
    mockShippingFee = 0;
    definirVisibilidade("visible");
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
    vi.useFakeTimers();
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
    vi.restoreAllMocks();
  });

  async function chegarNaTelaDeAguardarPagamento(
    CheckoutViewComponente: TelaCheckout,
  ) {
    await act(async () => {
      raiz.render(
        <CheckoutViewComponente
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;

    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      if (!mockUser) {
        digitar("guest-street", "Rua Teste");
        digitar("guest-number", "100");
        digitar("guest-neighborhood", "Centro");
      }
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    // useDeferredRender(380) — precisa do relógio fake avançar de verdade
    // para o botão "Finalizar Pedido" nascer.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(420);
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;

    await act(async () => {
      botaoFinalizar.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  // Achado 2 da revisão (16/08/2026): protege a linha que era a causa-raiz
  // do CHECKOUT-090. Sem este teste, `useOrders(false, true, {...})` (o
  // bug) e `useOrders(true, false, {...})` (a correção) passam pelos MESMOS
  // 8 outros testes — nenhum deles lê os dois primeiros argumentos.
  it("chama useOrders com (enabled=true, isAdmin=false) — enabled=false desliga o realtime inteiro, isAdmin=true é do admin, não do cliente", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    expect(useOrdersArgsCapturados).toEqual([true, false]);
  });

  it("evento de realtime com payment_status 'pago' troca o QR pela confirmação, com valor e número do pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
    expect(hospedeiro.textContent).toContain("reservado");

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
    expect(hospedeiro.textContent).toContain("R$ 100,00");
    // O identificador vem do MESMO formato que numeroDoPedido() usa no
    // backend (webhook-mercadopago/index.ts) e o SuccessView já usa aqui:
    // últimos 6 caracteres do id ("ped-999" → "ed-999"), maiúsculos.
    expect(hospedeiro.textContent).toContain("#ED-999");
    // Item 4 do relatório da tarefa: 'pago' NUNCA pode cair na tela de fora
    // do prazo — os dois estados não podem se confundir em nenhuma direção.
    expect(hospedeiro.textContent).not.toContain("prazo de reserva venceu");
  });

  // Achado 1 da revisão (16/08/2026), e decisão de produto do Gabriel
  // (16/08/2026): `pago_apos_expirar` NÃO é pagamento legítimo do ponto de
  // vista do pedido — a varredura que grava esse status
  // (20260807000000_reserva_com_expiracao.sql:113-116) também grava
  // `status='cancelled'` e chama `devolver_estoque` ANTES. A spec do webhook
  // (2026-08-07-fase-3-webhook-design.md:79) é explícita: esse status "não
  // toca estoque nem status" — o pedido CONTINUA cancelado. A decisão do
  // Gabriel (mesma spec, linha 136) é que ninguém automático mexe em estoque
  // ou dinheiro depois disso: ele decide caso a caso, reativando o pedido se
  // a mercadoria ainda existir ou estornando pelo painel do MP se não
  // existir. Por isso o push que o webhook manda ao lojista tem título
  // "Pagamento fora do fluxo", não "Pedido pago". Mostrar "a loja já está
  // preparando seu pedido" para um pedido cancelado, cujo estoque já foi
  // devolvido e pode ter sido vendido a outra pessoa, é a mentira que este
  // teste existe para impedir — e o cliente ainda precisa de UMA tela, não
  // de nenhuma: daí a segunda metade do teste, que prova que a tela de "fora
  // do prazo" aparece com o dinheiro recebido, o prazo vencido e o caminho
  // para falar com a loja.
  it("evento de realtime com payment_status 'pago_apos_expirar' NÃO confirma — mostra a tela de fora do prazo, com valor e número do pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago_apos_expirar" },
      });
    });

    // Metade negativa (não apagar): nunca pode parecer a tela de sucesso.
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");
    expect(hospedeiro.textContent).not.toContain(
      "a loja já está preparando seu pedido",
    );
    // Metade positiva: a tela própria do estado, com as três informações que
    // o Gabriel decidiu (pagamento recebido, prazo vencido, loja contata).
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
    expect(hospedeiro.textContent).toContain("R$ 100,00");
    expect(hospedeiro.textContent).toContain("#ED-999");
  });

  it("payment_status 'pago_apos_expirar' pela verificação periódica também mostra a tela de fora do prazo, não a de sucesso", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // A verificação periódica (rede de segurança / mecanismo principal no
    // celular) tem que respeitar a MESMA regra do realtime.
    fromSpy.mockClear();
    mockRespostaPoll = {
      data: { payment_status: "pago_apos_expirar", expires_at: null },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fromSpy).toHaveBeenCalledWith("marketplace_orders");
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");
    expect(hospedeiro.textContent).not.toContain(
      "a loja já está preparando seu pedido",
    );
    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
    expect(hospedeiro.textContent).toContain("R$ 100,00");
    expect(hospedeiro.textContent).toContain("#ED-999");
  });

  it("no estado fora do prazo, o QR e o aviso de reserva de 30 minutos saem do DOM", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    expect(hospedeiro.textContent).toContain(
      "Se o pagamento não sair em 30 minutos",
    );

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago_apos_expirar" },
      });
    });

    expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
    expect(hospedeiro.textContent).not.toContain(
      "Se o pagamento não sair em 30 minutos",
    );
  });

  it("na tela de fora do prazo, sem whatsapp_number configurado, não quebra e não mostra o botão de WhatsApp", async () => {
    mockWhatsappNumber = "";
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago_apos_expirar" },
      });
    });

    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
    expect(
      localizarBotaoPorTexto(hospedeiro, "Falar com a Loja"),
    ).toBeUndefined();
  });

  it("evento de realtime para OUTRO pedido é ignorado — não confirma a tela por engano", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "outro-pedido", payment_status: "pago" },
      });
    });

    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");
  });

  it("o realtime NÃO chega, e a verificação periódica (a cada 10s) é quem descobre a confirmação", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    fromSpy.mockClear();
    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: null },
      error: null,
    };

    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(fromSpy).toHaveBeenCalledWith("marketplace_orders");
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
  });

  it("a verificação periódica PARA depois de confirmar — não fica consultando o banco para sempre", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // Primeiro tick: ainda 'aguardando' — só prova que o intervalo está
    // rodando de verdade antes da confirmação.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fromSpy).toHaveBeenCalledTimes(1);

    // Confirma pelo realtime — o efeito de polling depende de
    // `pagamentoConfirmado` e limpa o `setInterval` anterior sem recriar
    // outro (o guard de topo do efeito devolve cedo).
    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");

    fromSpy.mockClear();

    // Passa MUITO tempo (equivalente a 6 ticks de 10s) — se o intervalo não
    // tivesse sido limpo, `fromSpy` teria sido chamado de novo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("a verificação periódica NÃO dispara consulta com a aba em segundo plano", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    fromSpy.mockClear();
    definirVisibilidade("hidden");
    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: null },
      error: null,
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fromSpy).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");
  });

  // Achado 3 da revisão (16/08/2026): no celular, esconder a aba por ~3s já
  // derruba a liderança do realtime (useLeaderElection: 300ms de debounce +
  // resignLeadership) e mais ~4s depois o canal é removido (useOrders.ts,
  // refCount-- -> removeChannel) — o `postgres_changes` não tem replay, o
  // UPDATE que chegou nesse intervalo está perdido para sempre. No fluxo
  // dominante no celular (abrir o app do banco, pagar, voltar para cá) só
  // esperar o próximo tick de 10s não basta: o navegador aplica "intensive
  // throttling" a timer de aba em segundo plano, e o tick pode demorar bem
  // mais que 10s. Este teste prova que voltar a ficar visível dispara a
  // verificação NA HORA, sem esperar o intervalo.
  it("ao voltar de segundo plano com o pagamento já confirmado no banco, a tela confirma IMEDIATAMENTE — não espera o próximo tick de 10s", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // Cliente sai da aba para pagar no app do banco.
    fromSpy.mockClear();
    definirVisibilidade("hidden");
    document.dispatchEvent(new Event("visibilitychange"));

    // Enquanto a aba estava escondida, o pagamento foi confirmado no banco —
    // é exatamente o que o cliente estava fazendo lá fora.
    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: null },
      error: null,
    };

    // Cliente volta para a aba, bem antes dos 10s do próximo tick.
    definirVisibilidade("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fromSpy).toHaveBeenCalledWith("marketplace_orders");
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
  });

  // Reescrito (16/08/2026, pagamento online exige conta — decisão do
  // Gabriel, achado da revisão): este teste chamava
  // `chegarNaTelaDeAguardarPagamento` já como CONVIDADO — isso sim deixou
  // de ser alcançável pela UI, porque o clique em "Pagar agora com PIX"
  // sem sessão navega para "auth" em vez de selecionar o método (ver
  // `tests/front/checkout-view-flag-on.test.tsx`, "convidado: clicar em
  // 'Pagar agora com PIX' NÃO seleciona o método"). Mas isso só cobre quem
  // TENTA ENTRAR sem conta — não cobre o cliente LOGADO cuja sessão CAI
  // com a tela já aberta e o polling já rodando: a guarda `!user?.id` do
  // useEffect de polling (dep de `user?.id`, CheckoutView.tsx) reage à
  // MUDANÇA limpando o intervalo anterior — é isso que este teste prova,
  // não a barreira de entrada (já coberta em checkout-view-flag-on).
  it("sessão cai (refresh do token falha) com a tela do PIX já aberta e o polling já rodando: o polling PARA — dep `user?.id` desmonta o intervalo", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    // Prova que o polling está de fato ativo ANTES da sessão cair — sem
    // isto o teste não distingue "nunca ligou" de "desligou".
    fromSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fromSpy).toHaveBeenCalledWith("marketplace_orders");

    // Sessão cai com a tela ainda aberta — `aguardandoPagamento` é
    // `useState` local, o componente não desmonta. `raiz.render` de novo
    // com o MESMO tipo de componente re-renderiza (React reconcilia, não
    // desmonta) e `useAuth()` lê o `mockUser` atualizado, como uma
    // renderização disparada pelo AuthContext real faria quando
    // `setUser(null)` roda.
    mockUser = null;
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    fromSpy.mockClear();
    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: null },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fromSpy).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");
  });

  it("depois de confirmado, o aviso de reserva de 30 minutos SOME da tela", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    expect(hospedeiro.textContent).toContain(
      "Se o pagamento não sair em 30 minutos",
    );

    await act(async () => {
      onRealtimeEventCapturado?.({
        eventType: "UPDATE",
        new: { id: "ped-999", payment_status: "pago" },
      });
    });

    expect(hospedeiro.textContent).not.toContain(
      "Se o pagamento não sair em 30 minutos",
    );
  });

  // Achado BLOQUEANTE da revisão (16/08/2026): o guard antigo parava o
  // polling assim que `expires_at <= Date.now()` — mas os dois status que a
  // tela espera só são gravados DEPOIS do relógio vencer (a varredura roda
  // a cada 5 min, o webhook do MP levou ~90s no incidente real). Os quatro
  // testes abaixo usam `expires_at` NO PASSADO desde a primeira consulta —
  // exatamente o cenário em que o guard antigo matava o polling antes do
  // valor aparecer.
  it("com expires_at já vencido, o polling NÃO para pelo relógio — confirma o pagamento quando ele chega", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const agora = Date.now();
    const expiresAtVencido = new Date(agora - 60_000).toISOString();

    fromSpy.mockClear();
    mockRespostaPoll = {
      data: { payment_status: "aguardando", expires_at: expiresAtVencido },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fromSpy).toHaveBeenCalledWith("marketplace_orders");
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");

    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: expiresAtVencido },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");
  });

  it("com expires_at já vencido, 'expirado' não para o polling — mostra a tela de fora do prazo quando pago_apos_expirar chega", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const agora = Date.now();
    const expiresAtVencido = new Date(agora - 60_000).toISOString();

    mockRespostaPoll = {
      data: { payment_status: "expirado", expires_at: expiresAtVencido },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // 'expirado' não é terminal — a tela continua esperando, sem trocar de
    // estado (é exatamente o que a varredura pode gravar antes do
    // pagamento chegar).
    expect(hospedeiro.textContent).not.toContain("prazo de reserva venceu");
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");

    mockRespostaPoll = {
      data: {
        payment_status: "pago_apos_expirar",
        expires_at: expiresAtVencido,
      },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(hospedeiro.textContent).toContain("prazo de reserva venceu");
  });

  it.each(["recusado", "estornado"])(
    "payment_status '%s' para a verificação periódica — não fica consultando para sempre",
    async (status) => {
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await chegarNaTelaDeAguardarPagamento(CheckoutView);

      fromSpy.mockClear();
      mockRespostaPoll = {
        data: { payment_status: status, expires_at: null },
        error: null,
      };
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(fromSpy).toHaveBeenCalledTimes(1);

      fromSpy.mockClear();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });

      expect(fromSpy).not.toHaveBeenCalled();
    },
  );

  // Achado BLOQUEANTE da 2ª revisão (16/08/2026), reescrita OBRIGATÓRIA
  // deste teste: a versão anterior comparava `expires_at` com uma folga fixa
  // de relógio (29/31 min) — presa por construção na faixa que o próprio
  // guard antigo usava. O guard NOVO não compara relógio nenhum: conta
  // TICKS do `setInterval` (ver `TETO_TICKS_VERIFICACAO_PAGAMENTO`,
  // CheckoutView.tsx). Este teste prova as duas metades: (1) um `expires_at`
  // JÁ 40 min vencido DESDE O PRIMEIRO TICK — que sob o guard antigo teria
  // parado o polling na primeira consulta (40 min > 30 min de folga) — não
  // interrompe nada, porque `expires_at` deixou de decidir; (2) o polling
  // ainda assim para depois de 360 ticks (60 min a 10s cada).
  it("o teto de 360 ticks (60 min) para o polling — NÃO pelo relógio: expires_at vencido desde o início não interrompe antes da hora, e o resultado do ÚLTIMO tick é USADO, não só consultado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const agora = Date.now();
    fromSpy.mockClear();
    mockRespostaPoll = {
      data: {
        payment_status: "aguardando",
        // 40 min já vencido, ANTES do primeiro tick e mantido fixo — sob o
        // guard antigo (relógio, 30 min de folga) isto teria parado o
        // polling logo na primeira consulta. Este valor NUNCA muda ao
        // longo do teste, de propósito: se algum dia alguém reintroduzir a
        // comparação com o relógio, a suíte cai já nos primeiros ticks.
        expires_at: new Date(agora - 40 * 60_000).toISOString(),
      },
      error: null,
    };

    // 100 ticks (1.000.000ms) — bem além do que o guard antigo teria
    // tolerado (pararia no tick 1). Prova que expires_at vencido não
    // decide mais nada.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100 * 10_000);
    });
    expect(fromSpy).toHaveBeenCalledTimes(100);

    // Completa os ticks 101 a 359 — ainda DENTRO do teto de 360: continua
    // consultando normalmente. Sem esta metade, um mutante que apagasse o
    // teto por completo (nunca parar) passaria despercebido.
    fromSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(259 * 10_000);
    });
    expect(fromSpy).toHaveBeenCalledTimes(259);

    // Tick 360 — atinge o teto, e o pagamento vira 'pago' EXATAMENTE neste
    // tick (entre o 359 e o 360). Achado da 3ª revisão (16/08/2026): o
    // código antigo gravava `parado = true` de forma SÍNCRONA logo após
    // disparar `verificarPagamento()` — como essa função suspende no
    // primeiro `await` (a consulta ao Supabase), o `parado = true` da linha
    // seguinte executava ANTES da consulta resolver, e
    // `if (parado || error || !data) return;` descartava a resposta em
    // 100% dos casos, porque `await` sempre cede ao menos um microtask. O
    // pedido pago no último tick nunca confirmava a tela. As duas
    // asserções abaixo provam as duas metades: a consulta é FEITA (contagem
    // de chamadas) e a resposta dela é USADA (texto confirmado na tela) —
    // um teste que só afirmasse a primeira passa com o defeito presente.
    fromSpy.mockClear();
    mockRespostaPoll = {
      data: { payment_status: "pago", expires_at: null },
      error: null,
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fromSpy).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Pagamento Confirmado");

    // Passa bem além do teto: nenhuma consulta nova — já parou (e já
    // confirmou).
    fromSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  // O PAR do teste acima, e ele é obrigatório — achado da 5ª revisão
  // (16/08/2026). Aquele teste prova que o resultado do último tick é USADO,
  // e para isso o tick 360 precisa responder 'pago'. Só que confirmar a tela
  // derruba o polling SOZINHA: `setStatusPagamentoPix("confirmado")` muda uma
  // dependência do efeito, a limpeza roda e o efeito volta pelo early-return.
  // Ou seja, o `not.toHaveBeenCalled()` do final daquele teste passa mesmo com
  // o teto REMOVIDO — a mesma cadeia que o teste de 'recusado'/'estornado' já
  // usa sem teto nenhum envolvido.
  //
  // As duas provas são mutuamente exclusivas por construção: depois de
  // confirmar não há mais o que observar. Por isso este teste chega ao teto
  // com a resposta ainda 'aguardando' — a tela NÃO confirma, então a única
  // coisa capaz de parar o polling é o teto. Sem ele, o repositório não tem
  // nenhum teste que prove o teto (grep por `teto|360|TETO` em tests/ só bate
  // neste arquivo), e o próximo que mexer no efeito perde a rede contra
  // polling perpétuo: uma consulta a cada 10 s, para sempre, por aba de
  // checkout abandonada.
  it("o teto de 360 ticks para o polling mesmo SEM confirmação — sem este par, apagar o teto inteiro deixaria a suíte verde", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    fromSpy.mockClear();
    // 'aguardando' do começo ao fim: a tela nunca confirma, nenhum estado
    // terminal é alcançado, e nada além do teto pode interromper o efeito.
    mockRespostaPoll = {
      data: { payment_status: "aguardando", expires_at: null },
      error: null,
    };

    // Ticks 1 a 360 — o último atinge o teto.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(360 * 10_000);
    });
    expect(fromSpy).toHaveBeenCalledTimes(360);
    expect(hospedeiro.textContent).not.toContain("Pagamento Confirmado");

    // Muito além do teto, ainda 'aguardando': se o teto tivesse sido apagado,
    // estas seriam 30 consultas novas.
    fromSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300 * 1_000);
    });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("a verificação periódica consulta pelas colunas certas e pelo id do pedido em tela", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    selectSpy.mockClear();
    eqSpy.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(selectSpy).toHaveBeenCalledWith("payment_status, expires_at");
    expect(eqSpy).toHaveBeenCalledWith("id", "ped-999");
  });

  // Nenhum teste desta suíte caía se o `document.removeEventListener` da
  // limpeza do efeito de polling fosse apagado — o vazamento nunca quebra
  // nada NA HORA, só acumula um listener por checkout aberto que nunca sai
  // (visibilitychange, sem ser removido, dispara verificarPagamento contra
  // um componente já desmontado a cada troca de aba, para sempre). Este
  // teste captura o MESMO listener passado a `addEventListener` e prova que
  // `removeEventListener` é chamado com essa MESMA referência ao desmontar
  // — não com uma função nova (que pareceria limpar, mas deixaria o
  // listener original vivo).
  it("o listener de visibilitychange é removido ao desmontar — sem isso, cada checkout aberto vaza um listener no document", async () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const chamadaDeRegistro = addSpy.mock.calls.find(
      ([evento]) => evento === "visibilitychange",
    );
    expect(chamadaDeRegistro).toBeDefined();
    const listenerRegistrado = chamadaDeRegistro![1];

    await act(async () => {
      raiz.unmount();
    });

    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      listenerRegistrado,
    );
  });
});

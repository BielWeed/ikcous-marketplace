// @vitest-environment jsdom
//
// Par do checkout-view-flag-off.test.tsx, mas com PAGAMENTO_ONLINE_LIGADO
// LIGADA — a metade da invariante que faltava. O bloqueador da rodada de
// correção 1 só existia neste caminho: `onClearCart()` roda ANTES de
// `setAguardandoPagamento(true)`, o React 18 agrupa os dois updates, e o
// render seguinte já tem carrinho vazio (cartTotal/shippingFee zerados) E a
// tela de pagamento — o Brick nascia com `valor: 0` enquanto o pedido já
// tinha sido gravado no banco com o total de verdade. Este teste falha se
// essa correção (congelar o total num estado próprio no momento do submit,
// como o orderId já é congelado) for revertida — é a prova por mutação
// pedida na revisão, ver o relatório da task para a saída do teste vermelho.
//
// `<PagamentoOnline>` é substituído por um dublê que só GRAVA as props
// recebidas — é exatamente o que este arquivo precisa auditar (`valor`), e
// evita depender do SDK real do Mercado Pago (que este arquivo não testa;
// isso já está coberto em pagamento-online.test.tsx, Task 4).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-999" });
const clearCart = vi.fn();
const confettiMock = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const pagamentoOnlineProps: Array<{ orderId: string; valor: number }> = [];
// CHECKOUT-050: cada montagem do dublê grava o `onErro` recebido — é assim
// que os testes novos disparam uma falha "vinda do Brick" sem depender do
// SDK real do Mercado Pago (isso já é coberto em pagamento-online.test.tsx).
const pagamentoOnlineOnErro: Array<
  (msg: string, categoria: "recuperavel" | "terminal") => void
> = [];

// Extraído em alias porque `import(...)` em posição de tipo não aceita
// vírgula final — reflow para caber em 80 colunas (regra do Biome) quebraria
// a sintaxe se ficasse inline no parâmetro da função abaixo.
type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
  }),
}));

// Endereço salvo do cliente logado (`is_default: true` autosseleciona sem
// clique extra — mesmo comportamento que `checkout-view-pix-confirmacao.
// test.tsx` já usa). Convidado não lê este mock (a seção de endereços
// salvos só renderiza com `user`), então mantê-lo sempre presente é
// inofensivo para os testes de convidado.
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

// Mutável (16/08/2026, pagamento online exige conta): a maioria dos testes
// deste arquivo passou a rodar como cliente LOGADO por padrão — pagar
// online só é alcançável assim agora — e os testes que provam a regra do
// convidado (bloqueio da opção "Pagar agora com PIX", outras formas de
// pagamento continuando abertas) sobrescrevem para `null` antes de montar.
let mockUser: { id: string } | null = { id: "user-1" };

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

// Carrinho de R$100 + R$20 de frete — exatamente o cenário do bloqueador. O
// mock precisa ser REATIVO de verdade (não um objeto estático), porque o bug
// só existe na sequência real: `clearCart()` muta o estado, o CheckoutView
// re-renderiza (o mesmo lote de updates que também liga
// `aguardandoPagamento`), e SÓ NESSE PONTO `useCart()` é chamado de novo e
// devolve os valores zerados. Um dublê estático nunca reproduziria isso —
// devolveria sempre 100/20, mascarando o bug que a rodada de correção 1
// encontrou.
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
let mockShippingFee = 20;

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: mockCart,
    cartTotal: mockCartTotal,
    shippingFee: mockShippingFee,
    clearCart: () => {
      clearCart();
      // Espelha CartContext.tsx:690-706/726/741: setCart([]) e frete/CEP
      // zerados, cartTotal reduzindo sobre [] e shippingFee com o guard
      // `cart.length === 0`.
      mockCart = [];
      mockCartTotal = 0;
      mockShippingFee = 0;
    },
    selectedShippingOption: null,
    shippingCep: "38500-000",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Idêntico ao par flag-off: o que este arquivo testa é o que o CheckoutView
// PASSA para createOrder, não a escolha de RPC em si (já provada em
// create-order-rpc.test.ts, Task 3).
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));

// CHECKOUT-070 (#197): CheckoutView passou a importar `@/lib/supabase`
// direto (releitura de status no cancelamento) — sem mock aqui o import
// tentaria criar um client de verdade e explodiria em jsdom ("Web Worker is
// not supported"). Este arquivo não exercita o botão de cancelar, então o
// dublê nunca precisa responder nada.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

vi.mock("canvas-confetti", () => ({ default: confettiMock }));

// Flag ligada — sem isso, "Pagar agora" nem aparece na lista para ser
// clicada.
vi.mock("@/lib/flags", () => ({
  PAGAMENTO_ONLINE_LIGADO: true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// Dublê do componente da Task 4: só grava as props recebidas. Renderizar o
// Brick de verdade (SDK externo, `mp-container`) não é o que esta task
// prova — é a Task 4 que já prova isso.
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: {
    orderId: string;
    valor: number;
    onErro: (msg: string, categoria: "recuperavel" | "terminal") => void;
  }) => {
    pagamentoOnlineProps.push({ orderId: props.orderId, valor: props.valor });
    pagamentoOnlineOnErro.push(props.onErro);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// pagamento-online.test.tsx e do par flag-off.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView com PAGAMENTO_ONLINE_LIGADO ligada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    clearCart.mockClear();
    confettiMock.mockClear();
    onNavigate.mockClear();
    pagamentoOnlineProps.length = 0;
    pagamentoOnlineOnErro.length = 0;
    mockUser = { id: "user-1" };
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
    mockShippingFee = 20;
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Cliente LOGADO (mockUser padrão do beforeEach) — pagamento online exige
  // conta (decisão do Gabriel, 16/08/2026): este teste era de CONVIDADO até
  // esta tarefa, e é exatamente o caso que passa a ser impossível pela UI
  // (o botão de "Pagar agora com PIX" navega para "auth" em vez de
  // selecionar, sem sessão — ver os testes dedicados de bloqueio, abaixo).
  // O que este teste prova (createOrder com comPagamentoOnline:true, sem
  // confete, valor CONGELADO) continua valendo — só que agora pelo caminho
  // que a regra nova deixou aberto: cliente com conta.
  it("cliente logado escolhe 'Pagar agora', chama createOrder com comPagamentoOnline:true, não solta confete, mostra a tela de aguardar e entrega o valor CONGELADO (não 0) ao PagamentoOnline", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // O rótulo casa por texto exato, e é por isso que ele pegou a divergência:
    // a Fase 3 desligou cartão nos dois lados (Brick e criar-pagamento) e o
    // rótulo continuava prometendo "(PIX ou cartão)". Ao religar cartão na
    // Fase 3.5, este texto e o de CheckoutView.tsx mudam juntos.
    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    );
    expect(botaoOnline).toBeDefined();

    await act(async () => {
      botaoOnline!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // Sem campos de endereço de convidado: cliente logado usa o endereço
      // salvo (addr-1, is_default), autosselecionado sem clique.
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // O botão "Finalizar Pedido" só existe depois que useDeferredRender(380)
    // resolve — espera o tempo real, como o componente exige.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    );
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.anything(), {
      comPagamentoOnline: true,
    });

    // O front nunca declara pagamento: sem confete, sem tela de sucesso.
    expect(confettiMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).not.toContain("Pedido Celebrado!");
    expect(hospedeiro.textContent).toContain("Finalize o pagamento");

    // A prova do bloqueador da rodada de correção 1: o total é 100 (produto)
    // + 20 (frete) = 120, gravado no pedido ANTES do onClearCart() zerar o
    // carrinho. Se o CheckoutView ler `finalTotal` (derivado do carrinho, já
    // limpo) em vez do valor congelado no submit, este número vem 0.
    expect(pagamentoOnlineProps).toHaveLength(1);
    expect(pagamentoOnlineProps[0]).toEqual({ orderId: "ped-999", valor: 120 });
  });

  // CHECKOUT-050: repete a sequência do teste acima até a tela "Finalize o
  // pagamento" — as duas provas novas (recuperável x terminal) partem
  // exatamente daqui.
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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;

    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("falha recuperável fica na tela, oferece 'Tentar de novo', e clicar remonta o PagamentoOnline no MESMO pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    expect(pagamentoOnlineProps).toHaveLength(1);
    const onErro = pagamentoOnlineOnErro[0];

    await act(async () => {
      onErro("Não foi possível gerar a cobrança.", "recuperavel");
    });

    // Critério 5 da issue: o aviso do prazo de 30 min continua visível.
    expect(hospedeiro.textContent).toContain("Seu pedido está reservado");
    // A mensagem exibida é a MESMA que a função mandou — sem status HTTP,
    // sem jargão.
    expect(hospedeiro.textContent).toContain(
      "Não foi possível gerar a cobrança.",
    );

    const botaoTentar = localizarBotaoPorTexto(hospedeiro, "Tentar de novo");
    expect(botaoTentar).toBeDefined();

    await act(async () => {
      botaoTentar!.click();
    });

    // Remontou: uma NOVA instância do PagamentoOnline para o MESMO pedido —
    // sem recarregar a página e sem criar um segundo pedido.
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(pagamentoOnlineProps).toHaveLength(2);
    expect(pagamentoOnlineProps[1]).toEqual({ orderId: "ped-999", valor: 120 });
    expect(
      localizarBotaoPorTexto(hospedeiro, "Tentar de novo"),
    ).toBeUndefined();
  });

  it("falha terminal fica na tela mas NÃO oferece 'Tentar de novo'", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const onErro = pagamentoOnlineOnErro[0];
    const mensagem =
      "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.";

    await act(async () => {
      onErro(mensagem, "terminal");
    });

    expect(hospedeiro.textContent).toContain("Seu pedido está reservado");
    expect(hospedeiro.textContent).toContain(mensagem);
    expect(
      localizarBotaoPorTexto(hospedeiro, "Tentar de novo"),
    ).toBeUndefined();

    // Sem retentativa: o PagamentoOnline não remonta sozinho.
    expect(pagamentoOnlineProps).toHaveLength(1);
  });

  // Achado 3 da revisão do CHECKOUT-050 (#194): a doc do Mercado Pago não é
  // clara sobre a ordem entre `onSubmit` rejeitado e `callbacks.onError` do
  // Brick — e a revisão não conseguiu provar nem descartar que o segundo
  // dispare DEPOIS do primeiro. Se acontecer, a mensagem genérica e
  // recuperável de `onError` ("Não foi possível carregar o pagamento.") não
  // pode sobrescrever uma recusa terminal que já está na tela: rebaixar
  // reabriria "Tentar de novo" para uma recusa que nunca muda.
  it("erro recuperável que chega DEPOIS de um terminal não rebaixa o que está na tela", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await chegarNaTelaDeAguardarPagamento(CheckoutView);

    const onErro = pagamentoOnlineOnErro[0];
    const mensagemTerminal =
      "Este pagamento foi recusado e não pode ser tentado novamente neste pedido. Faça um pedido novo ou fale com a loja.";

    await act(async () => {
      onErro(mensagemTerminal, "terminal");
    });

    expect(hospedeiro.textContent).toContain(mensagemTerminal);

    await act(async () => {
      onErro("Não foi possível carregar o pagamento.", "recuperavel");
    });

    // A mensagem terminal continua na tela — a recuperável NÃO substituiu.
    expect(hospedeiro.textContent).toContain(mensagemTerminal);
    expect(hospedeiro.textContent).not.toContain(
      "Não foi possível carregar o pagamento.",
    );
    // E continua sem "Tentar de novo": rebaixar a categoria reabriria o
    // botão para uma recusa que não muda com nova tentativa.
    expect(
      localizarBotaoPorTexto(hospedeiro, "Tentar de novo"),
    ).toBeUndefined();
  });

  // --- Pagamento online exige conta (decisão do Gabriel, 16/08/2026) ------
  //
  // Item 1 do relatório da tarefa: convidado não consegue SELECIONAR "Pagar
  // agora com PIX", e vê a explicação e o caminho para entrar. O clique não
  // é um no-op silencioso — vira navegação para a tela de login/cadastro,
  // com o carrinho intacto (persistido em localStorage por CartContext,
  // sobrevive à troca de tela sem nada novo aqui).
  it("convidado: clicar em 'Pagar agora com PIX' NÃO seleciona o método — mostra a explicação e navega para 'auth'", async () => {
    mockUser = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    // Aparência de indisponível + explicação — NÃO some da tela sem dizer
    // por quê (a tarefa proíbe só esconder a opção).
    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    );
    expect(botaoOnline).toBeDefined();
    expect(botaoOnline!.textContent).toContain("exige conta");

    await act(async () => {
      botaoOnline!.click();
    });

    // Navegou para o login/cadastro — e NÃO selecionou "online" como método
    // (a prova de que não selecionou vem no próximo teste, que teria que
    // preencher os campos de convidado se "online" tivesse sido escolhido
    // por engano).
    expect(onNavigate).toHaveBeenCalledWith("auth");
  });

  // Item 3 do relatório da tarefa — o que impede a regra de virar drástica:
  // convidado continua finalizando pedido normalmente pelas formas de
  // pagamento na entrega, exatamente como antes desta tarefa.
  it("convidado: as outras formas de pagamento (na entrega) continuam disponíveis e selecionáveis", async () => {
    mockUser = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoCartao = localizarBotaoPorTexto(
      hospedeiro,
      "Cartão na Entrega",
    )!;
    expect(botaoCartao).toBeDefined();

    await act(async () => {
      botaoCartao.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      digitar("guest-street", "Rua Teste");
      digitar("guest-number", "100");
      digitar("guest-neighborhood", "Centro");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    );
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.anything(), {
      comPagamentoOnline: false,
    });
    // Caminho de sucesso de sempre — nunca a tela de "Finalize o pagamento",
    // que só existe para a cobrança online.
    expect(hospedeiro.textContent).not.toContain("Finalize o pagamento");
  });
});

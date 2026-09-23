// @vitest-environment jsdom
//
// REGRA DO FRETE × PAGAMENTO (dono, 21/09/2026): envio por TRANSPORTADORA
// (Melhor Envio/Frenet — qualquer id ≠ "local-delivery", incluindo o
// gratuito externo "free-shipping-promo") exige pagamento ANTECIPADO;
// entrega local preserva as modalidades da loja. Esta suíte prova as
// TRANSIÇÕES da tela (a guarda pura tem matriz própria em
// pagamento-incompativel-com-frete.test.ts):
//
//   1. entrega local: o grupo "Na entrega" segue na tela e selecionável;
//   2. local -> transportadora (ida e volta de passo/carrinho, estado
//      stale): o grupo "Na entrega" SAI, "online" é auto-selecionado (com
//      conta + flag ligada) e a orientação fica visível;
//   3. transportadora + pagamento online DESLIGADO: bloqueio com
//      explicação, SEM fallback "na entrega";
//   4. transportadora + online + SESSÃO CAÍDA (o efeito de expiração de
//      CheckoutView que rebaixa online -> pix): a nova auto-seleção NÃO
//      pode entrar em ping-pong com ele — estabiliza fora de "online".
//
// Montagem copiada de checkout-view-flag-on.test.tsx (mesmos mocks e
// helpers); o que muda é `mockSelectedShippingOption`, mutável por caso.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-1" });
const toastError = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
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

let mockUser: { id: string } | null = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const item = () => ({
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
});

let mockCart = [item()];
let mockCartTotal = 100;
let mockShippingFee = 20;
// Mutável: cada caso classifica a modalidade pelo ID — "local-delivery" é
// entrega local; "melhor-envio-*" (ou qualquer outro id resolvível) é
// transportadora. Mesmo contrato da edge calculate-shipping.
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 20,
  deliveryDays: 1,
  provider: "local",
};

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: mockCart,
      cartTotal: mockCartTotal,
      shippingFee: mockShippingFee,
      clearCart: () => {
        mockCart = [];
        mockCartTotal = 0;
        mockShippingFee = 0;
        mockSelectedShippingOption = null;
      },
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: null,
      setSelectedShippingOption: (opt: typeof mockSelectedShippingOption) => {
        mockSelectedShippingOption = opt;
      },
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

// A flag é LIDA POR CHAMADA no render — mutável por caso (o caso 3 desliga).
let flagPagamentoOnline = true;
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => flagPagamentoOnline,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de checkout deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

// Mesmo `digitar` dos outros arquivos de checkout: dispara o `input` pelo
// setter nativo para o react-hook-form reagir (preencher `.value` direto
// não notifica ninguém).
function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Extraído em alias porque `import(...)` em posição de tipo não aceita
// vírgula final — reflow para caber em 80 colunas (regra do Biome) quebraria
// a sintaxe se ficasse inline no parâmetro. Mesmo padrão (e mesmo motivo) de
// checkout-view-flag-on.test.tsx.
type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

async function montar(CheckoutViewComponente: TelaCheckout) {
  await act(async () => {
    raizGlobal.render(
      <CheckoutViewComponente
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

let raizGlobal: Root;
let hospedeiroGlobal: HTMLDivElement;

describe("CheckoutView — transportadora exige pagamento antecipado", () => {
  beforeEach(() => {
    createOrder.mockClear();
    onNavigate.mockClear();
    mockUser = { id: "user-1" };
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    flagPagamentoOnline = true;
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
    hospedeiroGlobal = document.createElement("div");
    document.body.appendChild(hospedeiroGlobal);
    raizGlobal = createRoot(hospedeiroGlobal);
  });

  afterEach(() => {
    act(() => {
      raizGlobal.unmount();
    });
    hospedeiroGlobal.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("entrega local preserva o grupo 'Na entrega' com as três modalidades, selecionáveis", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    for (const rotulo of [
      "Pix na Entrega",
      "Cartão na Entrega",
      "Dinheiro na Entrega",
    ]) {
      const botao = localizarBotaoPorTexto(hospedeiroGlobal, rotulo);
      expect(botao, rotulo).toBeDefined();
    }
    // Nenhum aviso de transportadora com entrega local.
    expect(hospedeiroGlobal.textContent).not.toContain(
      "exige pagamento antecipado",
    );

    // Selecionável: clique marca o rádio (o mesmo radiogroup dos dois
    // grupos — a escolha continua sendo uma só).
    const dinheiro = localizarBotaoPorTexto(
      hospedeiroGlobal,
      "Dinheiro na Entrega",
    )!;
    await act(async () => {
      dinheiro.click();
      await esperarMicrotarefas();
    });
    expect(dinheiro.getAttribute("aria-checked")).toBe("true");
  });

  it("IDA: trocar o frete para transportadora esconde 'Na entrega', auto-seleciona 'online' (com conta e flag ligada) e mostra a orientação", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    // Estado inicial: local + "Pix na Entrega" selecionado (o padrão do
    // componente) — o método fica STALE quando o frete muda.
    const pix = localizarBotaoPorTexto(hospedeiroGlobal, "Pix na Entrega")!;
    expect(pix.getAttribute("aria-checked")).toBe("true");

    // Volta ao carrinho e escolhe transportadora (o mock é o mesmo lugar
    // onde o CartContext gravaria a escolha).
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosSedex",
      name: "Sedex",
      price: 20,
      deliveryDays: 3,
      provider: "melhor_envio",
    };
    await act(async () => {
      raizGlobal.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // O grupo "Na entrega" SAIU — dinheiro na porta de um correio de
    // outra cidade não é mais uma promessa da tela.
    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Pix na Entrega"),
    ).toBeUndefined();
    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Dinheiro na Entrega"),
    ).toBeUndefined();

    // "online" foi AUTO-SELECIONADO e a orientação está visível.
    const online = localizarBotaoPorTexto(
      hospedeiroGlobal,
      "Pagar agora com PIX",
    )!;
    expect(online).toBeDefined();
    expect(online.getAttribute("aria-checked")).toBe("true");
    expect(hospedeiroGlobal.textContent).toContain(
      "Envio por transportadora exige pagamento antecipado",
    );
  });

  it("VOLTA: de transportadora de volta para entrega local, o grupo 'Na entrega' retorna e 'online' segue válido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    mockSelectedShippingOption = {
      id: "frenet-SEDEX",
      name: "Frenet Sedex",
      price: 25,
      deliveryDays: 2,
      provider: "frenet",
    };
    await montar(CheckoutView);
    // O efeito de transição auto-selecionou "online" (flag ligada +
    // conta) — estado de partida da volta.
    const online = localizarBotaoPorTexto(
      hospedeiroGlobal,
      "Pagar agora com PIX",
    )!;
    expect(online.getAttribute("aria-checked")).toBe("true");

    mockSelectedShippingOption = {
      id: "local-delivery",
      name: "Entrega Local",
      price: 20,
      deliveryDays: 1,
      provider: "local",
    };
    await act(async () => {
      raizGlobal.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Pix na Entrega"),
    ).toBeDefined();
    // Local aceita "online" também — nada de rebaixar o método que a
    // pessoa já escolheu.
    expect(online.getAttribute("aria-checked")).toBe("true");
    expect(hospedeiroGlobal.textContent).not.toContain(
      "exige pagamento antecipado",
    );
  });

  it("transportadora com pagamento online DESLIGADO: sem 'na entrega', sem fallback — bloqueio com a explicação de falar com a loja", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    flagPagamentoOnline = false;
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosPAC",
      name: "PAC",
      price: 18,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
    await montar(CheckoutView);

    // Sem pagamento online não existe "Pagar agora" — e o grupo "Na
    // entrega" também não pode existir: seria o fallback proibido.
    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Pagar agora com PIX"),
    ).toBeUndefined();
    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Dinheiro na Entrega"),
    ).toBeUndefined();

    // A explicação diz O QUE FAZER. Frase da revisão da supervisão: quem
    // recebe em outra cidade NÃO pode "escolher entrega local" — com a
    // loja sem pagamento pelo app, a saída honesta é falar com a loja.
    expect(hospedeiroGlobal.textContent).toContain(
      "esta loja não recebe pagamento pelo app",
    );
    expect(hospedeiroGlobal.textContent).toContain(
      "Fale com a loja para combinar a entrega",
    );
  });

  // O CASO DA EXPIRAÇÃO: o efeito de "pagamento online exige conta"
  // (CheckoutView ~1211) rebaixa online -> pix quando a sessão vira
  // convidado. A auto-seleção nova não pode re-selecionar "online" de
  // volta — senão os dois efeitos alternam para sempre. Com
  // transportadora + convidado o certo é FICAR travado (com a saída de
  // entrar na conta ou escolher entrega local).
  it("EXPIRAÇÃO: transportadora + online + sessão que cai estabiliza FORA de 'online', sem alternar em loop", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosSedex",
      name: "Sedex",
      price: 20,
      deliveryDays: 3,
      provider: "melhor_envio",
    };
    await montar(CheckoutView);

    const online = localizarBotaoPorTexto(
      hospedeiroGlobal,
      "Pagar agora com PIX",
    )!;
    // Partida: logado + transportadora -> auto-selecionado "online".
    expect(online.getAttribute("aria-checked")).toBe("true");

    // A sessão cai com a tela aberta (mesmo mecanismo do teste irmão em
    // checkout-view-flag-on.test.tsx: re-render lê o mock atualizado).
    mockUser = null;
    await act(async () => {
      raizGlobal.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
      await esperarMicrotarefas();
    });

    // Estabiliza FORA de "online": o efeito de expiração rebaixou para
    // "pix" e a auto-seleção NÃO voltou (sem conta ela nem considera).
    // O rádio "online" agora é a opção bloqueada por falta de conta.
    expect(online.getAttribute("aria-checked")).toBe("false");
    expect(online.textContent).toContain("exige conta");

    // PROVA DO NÃO-LOOP: vários ciclos de microtarefas e o estado nunca
    // volta a "online". Se houvesse ping-pong entre os dois efeitos, um
    // destes ciclos releria aria-checked=true.
    const observacoes: Array<string | null> = [];
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      observacoes.push(online.getAttribute("aria-checked"));
    }
    expect(observacoes.every((v) => v === "false")).toBe(true);
    // E nenhum pedido nasceu no meio da instabilidade.
    expect(createOrder).not.toHaveBeenCalled();
  });

  // A PROVA DO BLOQUEIO com FORMULÁRIO E ENDEREÇO VÁLIDOS: o caso 3 acima
  // prova os textos, mas o botão ali já nascia desabilitado por causa do
  // formulário vazio — a trava da regra não era a única hipótese. Aqui o
  // cliente logado tem endereço salvo (addr-1, is_default, autosselecionado)
  // e nome/WhatsApp preenchidos: `isValid` sobe, e o ÚNICO motivo restante
  // de botão apagado é a regra transportadora × pagamento. E o handler é
  // EXERCITADO de verdade: `click()` num botão disabled é ignorado pelo DOM
  // — o onClick REAL é capturado dos props do React (__reactProps$) e
  // invocado, com assert de existência, provando que a guarda bloqueia e
  // que `createOrder` nem é chamado.
  function capturarOnClickFinalizar(botao: HTMLButtonElement): () => void {
    const chaveProps = Object.keys(botao).find((k) =>
      k.startsWith("__reactProps$"),
    );
    expect(
      chaveProps,
      "botão sem props do React (__reactProps$)",
    ).toBeDefined();
    const onClick = (botao as unknown as Record<string, unknown>)[
      chaveProps!
    ] as { onClick?: () => void } | undefined;
    expect(typeof onClick?.onClick, "botão sem onClick capturado").toBe(
      "function",
    );
    return onClick!.onClick!;
  }

  it("flag DESLIGADA + transportadora: formulário e endereço VÁLIDOS -> Finalizar travado pela regra; o handler invocado não chama createOrder e explica a regra", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    flagPagamentoOnline = false;
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosPAC",
      name: "PAC",
      price: 18,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
    await montar(CheckoutView);

    // Cliente logado: sem campos de endereço de convidado — o endereço
    // válido é o salva (addr-1), autosselecionado. O formulário válido é
    // nome + WhatsApp.
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
    });
    // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026): as
    // três opções deste arquivo são `melhor-envio-*` — sem o CPF válido o
    // formulário fica inválido e mascara a regra que o teste quer provar
    // atrás de "preencha todos os campos" (mensagem genérica de validação).
    await act(async () => {
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar.disabled).toBe(true);

    // O disabled do DOM ignora o clique — quem prova a guarda é o HANDLER
    // real, capturado dos props do React e invocado direto.
    const onClickReal = capturarOnClickFinalizar(botaoFinalizar);
    await act(async () => {
      onClickReal();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // Aviso ESPECÍFICO da regra (a variante da flag desligada — nunca o
    // genérico), e nenhum pedido.
    expect(toastError).toHaveBeenCalledWith(
      "Esta loja não recebe pagamento pelo app, então o envio por transportadora não está disponível. Fale com a loja para combinar a entrega.",
    );
    expect(createOrder).not.toHaveBeenCalled();
  });

  // CONTROLE POSITIVO do caso acima: os MESMOS campos válidos, mesma
  // transportadora, com a flag LIGADA — o Finalizar HABILITA. Sem este
  // controle, "botão travado" provaria qualquer coisa (até formulário
  // inválido disfarçado).
  it("controle positivo: mesmos campos válidos com a flag LIGADA habilitam o Finalizar", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    flagPagamentoOnline = true;
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosPAC",
      name: "PAC",
      price: 18,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
    await montar(CheckoutView);

    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
    });
    // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026): as
    // três opções deste arquivo são `melhor-envio-*` — sem o CPF válido o
    // formulário fica inválido e mascara a regra que o teste quer provar
    // atrás de "preencha todos os campos" (mensagem genérica de validação).
    await act(async () => {
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    expect(botaoFinalizar.disabled).toBe(false);
  });

  // ONLINE STALE + FLAG DESLIGANDO DEPOIS: "online" auto-selecionado com a
  // flag ligada, a lojista desliga o pagamento online (a flag é lida por
  // chamada — um re-render basta), e o método fica STALE em "online". A
  // guarda tem de travar o par que não pode ser pago (o handler invocado
  // explica e não chama createOrder).
  it("flag desligando DEPOIS de online selecionado: stale é travado pelo handler, sem createOrder", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    mockSelectedShippingOption = {
      id: "melhor-envio-CorreiosPAC",
      name: "PAC",
      price: 18,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
    await montar(CheckoutView);

    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
    });
    // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026): as
    // três opções deste arquivo são `melhor-envio-*` — sem o CPF válido o
    // formulário fica inválido e mascara a regra que o teste quer provar
    // atrás de "preencha todos os campos" (mensagem genérica de validação).
    await act(async () => {
      digitar("checkout-cpf", "11144477735");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    expect(
      localizarBotaoPorTexto(document.body, "Finalizar Pedido")!.disabled,
    ).toBe(false);

    // A lojista desliga o pagamento online; o próximo render relê a flag.
    flagPagamentoOnline = false;
    await act(async () => {
      digitar("checkout-name", "Cliente Teste 2");
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    const botaoStale = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    expect(botaoStale.disabled).toBe(true);

    const onClickStale = capturarOnClickFinalizar(botaoStale);
    await act(async () => {
      onClickStale();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(toastError).toHaveBeenCalledWith(
      "Esta loja não recebe pagamento pelo app, então o envio por transportadora não está disponível. Fale com a loja para combinar a entrega.",
    );
    expect(createOrder).not.toHaveBeenCalled();
  });

  // O GRATUITO EXTERNO DE VERDADE, sem helper que copie a classificação:
  // "free-shipping-promo" (provider "free", price 0) é o id que a edge
  // calculate-shipping devolve no caminho de TRANSPORTADORA após
  // isLocal=false. A modalidade é decidida pelo ID dentro do próprio
  // CheckoutView (`selectedShippingOption?.id === "local-delivery"`) —
  // price 0 não pode derrubá-la para "local": grátis de transportadora
  // continua exigindo antecipado, e o grupo "Na entrega" continua fora.
  it("opção REAL 'free-shipping-promo' (price 0): 'Na entrega' escondido, orientação do PIX no app visível e 'online' auto-selecionado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    mockSelectedShippingOption = {
      id: "free-shipping-promo",
      name: "Frete Grátis Promo",
      price: 0,
      deliveryDays: 5,
      provider: "free",
    };
    await montar(CheckoutView);

    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Pix na Entrega"),
    ).toBeUndefined();
    expect(
      localizarBotaoPorTexto(hospedeiroGlobal, "Dinheiro na Entrega"),
    ).toBeUndefined();

    // A orientação do grupo de pagamento aparece, e o antecipado foi
    // auto-selecionado (flag ligada + conta) — a promoção gratuita não
    // abriu exceção na regra do dono.
    expect(hospedeiroGlobal.textContent).toContain(
      "só oferecemos o PIX no app aqui",
    );
    const online = localizarBotaoPorTexto(
      hospedeiroGlobal,
      "Pagar agora com PIX",
    )!;
    expect(online.getAttribute("aria-checked")).toBe("true");
  });
});

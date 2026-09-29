// @vitest-environment jsdom
//
// P1 DO PR #711 — a loja podia oferecer "Pagar agora com PIX" sem ter a chave
// de assinatura do webhook; a edge `criar-pagamento` recusava (409
// `pixSemChaveDeAssinatura`) e o cliente travava antes do QR. Agora o checkout
// pergunta à edge (`{ acao: "metodos" }` → `{ pix: boolean }`) e:
//   - `false`  -> esconde SÓ o PIX pelo app (o cartão, que divide a flag
//                 `pagamentoOnlineLigado()`, continua); sem cartão, o online
//                 inteiro some e o checkout age como online desligado;
//   - `true`   -> como sempre foi;
//   - QUALQUER outra coisa (erro, rede, 4xx/5xx, corpo estranho, edge antiga)
//                 -> DESCONHECIDO: oferece o PIX (fail-open — a edge continua
//                 sendo quem recusa de verdade; a sonda é orientação de tela).
// Uma consulta só por sessão de página.
//
// Montagem copiada de checkout-view-cartao-online.test.tsx; aqui o módulo
// `pix-disponivel` é o REAL e só o `supabase.functions.invoke` é dublê.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConfigDoCartao } from "@/lib/config-do-cartao";

const { invoke, toastInfo } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastInfo: vi.fn(),
}));
const createOrder = vi.fn().mockResolvedValue({ id: "ped-777" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const propsDoPagamento: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

let mockFormasNaEntrega: string[] | undefined;
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      formasPagamentoEntrega: mockFormasNaEntrega,
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

let mockUser: { id: string; email?: string } | null = {
  id: "user-1",
  email: "cliente@exemplo.com",
};
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
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 20,
  deliveryDays: 1,
  provider: "local",
};
const TRANSPORTADORA = {
  id: "melhor-envio-CorreiosSedex",
  name: "Sedex",
  price: 20,
  deliveryDays: 3,
  provider: "melhor_envio",
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
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: toastInfo },
}));

let mockOnlineLigado = true;
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => mockOnlineLigado,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

let mockConfigDoCartao: ConfigDoCartao | null = null;
vi.mock("@/hooks/useConfigDoCartao", () => ({
  useConfigDoCartao: () => mockConfigDoCartao,
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: (props: Record<string, unknown>) => {
    propsDoPagamento.push(props);
    return null;
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  PRAZO_DA_SONDA_MS,
  buscarPixDisponivel,
  esquecerPixDisponivel,
  interpretarRespostaDoPix,
  lerPixDisponivel,
} from "@/lib/pix-disponivel";

// O que o dublê da edge devolve em `criar-pagamento` + `metodos`.
type Resposta = { data: unknown; error: unknown };
let sondaDaEdge: () => Promise<Resposta> | Resposta;
const respondePix = (pix: unknown): Resposta => ({
  data: { pix },
  error: null,
});

const chamadasDaSonda = () =>
  invoke.mock.calls.filter((c) => c[0] === "criar-pagamento");

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function botaoPorTexto(
  no: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...no.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
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

type TelaCheckout = typeof import("@/views/customer/CheckoutView").CheckoutView;

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function montar(Tela: TelaCheckout) {
  await act(async () => {
    raiz.render(
      <Tela onNavigate={onNavigate} onSetBackOverride={onSetBackOverride} />,
    );
  });
  await act(async () => {
    await esperarMicrotarefas();
  });
}

async function remontar(Tela: TelaCheckout) {
  await act(async () => {
    raiz.render(
      <Tela onNavigate={onNavigate} onSetBackOverride={onSetBackOverride} />,
    );
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

async function clicar(botao: HTMLElement) {
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
  });
}

// Formulário e endereço VÁLIDOS: cliente logada com endereço salvo (addr-1)
// só precisa de nome + WhatsApp, e transportadora exige CPF. Sem isto o
// Finalizar nasce apagado por outro motivo e "travado" provaria qualquer coisa.
async function preencherFormulario() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    if (document.getElementById("checkout-cpf")) {
      digitar("checkout-cpf", "11144477735");
    }
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

async function finalizar() {
  await preencherFormulario();
  const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
  expect(botao.disabled).toBe(false);
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

// `click()` num botão disabled é ignorado pelo DOM: quem prova a guarda do
// SUBMIT é o onClick REAL, capturado dos props do React (mesmo andaime de
// checkout-transportadora-exige-antecipado.test.tsx).
function capturarOnClick(botao: HTMLButtonElement): () => void {
  const chaveProps = Object.keys(botao).find((k) =>
    k.startsWith("__reactProps$"),
  );
  expect(chaveProps, "botão sem props do React").toBeDefined();
  const props = (botao as unknown as Record<string, unknown>)[chaveProps!] as
    | { onClick?: () => void }
    | undefined;
  expect(typeof props?.onClick, "botão sem onClick").toBe("function");
  return props!.onClick!;
}

const grupoDePagamento = () => hospedeiro.querySelector('[role="radiogroup"]')!;
const opcaoPix = () => botaoPorTexto(grupoDePagamento(), "Pagar agora com PIX");
const opcaoCartao = () =>
  botaoPorTexto(grupoDePagamento(), "Cartão de crédito ou débito");
const CARTAO_LIGADO: ConfigDoCartao = {
  credito: true,
  debito: true,
  parcelasMax: 6,
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (nome: string) =>
    nome === "criar-pagamento"
      ? sondaDaEdge()
      : { data: null, error: { message: "fora do escopo deste teste" } },
  );
  toastInfo.mockReset();
  esquecerPixDisponivel();
  sondaDaEdge = () => respondePix(true);
});

describe("interpretarRespostaDoPix — só um booleano explícito decide", () => {
  it.each([
    [{ pix: true }, true],
    [{ pix: false }, false],
    [{ pix: true, outro: 1 }, true],
  ])("%o → %s", (corpo, esperado) => {
    expect(interpretarRespostaDoPix(corpo)).toBe(esperado);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["objeto vazio", {}],
    ["string", "false"],
    ["string JSON", '{"pix":false}'],
    ["número", 0],
    ["array", [false]],
    ["pix como string 'false'", { pix: "false" }],
    ["pix como string 'true'", { pix: "true" }],
    ["pix como 0", { pix: 0 }],
    ["pix como 1", { pix: 1 }],
    ["pix null", { pix: null }],
    ["pix objeto", { pix: {} }],
    ["campo com outro nome", { pixDisponivel: false }],
    ["corpo de erro da edge", { error: "Pedido inválido." }],
  ])("lixo (%s) é DESCONHECIDO, nunca 'esconder'", (_nome, corpo) => {
    expect(interpretarRespostaDoPix(corpo)).toBeNull();
  });
});

describe("buscarPixDisponivel / lerPixDisponivel — a chamada e o fail-open", () => {
  it("chama a MESMA edge do pagamento com { acao: 'metodos' }", async () => {
    sondaDaEdge = () => respondePix(false);
    expect(await buscarPixDisponivel()).toBe(false);
    expect(invoke).toHaveBeenCalledWith("criar-pagamento", {
      body: { acao: "metodos" },
    });
  });

  it.each([
    [
      "erro de status (4xx/5xx)",
      () => ({ data: null, error: { message: "409" } }),
    ],
    [
      "erro mesmo com corpo dizendo false",
      () => ({ data: { pix: false }, error: { message: "500" } }),
    ],
    ["rede que rejeita", () => Promise.reject(new Error("Failed to fetch"))],
    [
      "invoke que lança direto",
      () => {
        throw new Error("boom");
      },
    ],
    [
      "edge antiga: corpo sem o campo",
      () => ({ data: { error: "Pedido inválido." }, error: null }),
    ],
    ["corpo nulo", () => ({ data: null, error: null })],
  ])("%s → null (desconhecido)", async (_nome, sonda) => {
    sondaDaEdge = sonda as () => Resposta;
    expect(await buscarPixDisponivel()).toBeNull();
  });

  it("sem supabase.functions (cliente incompleto) → null, não lança", async () => {
    invoke.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined");
    });
    expect(await buscarPixDisponivel()).toBeNull();
  });

  it("consultas SIMULTÂNEAS dividem uma ida só à edge (efeito duplo, duas telas)", async () => {
    sondaDaEdge = () => respondePix(false);
    const [a, b] = await Promise.all([lerPixDisponivel(), lerPixDisponivel()]);
    expect([a, b]).toEqual([false, false]);
    expect(chamadasDaSonda()).toHaveLength(1);
  });

  it("NADA fica guardado entre aberturas: a PWA dura dias, então um 'false' de ontem não pode esconder o PIX hoje", async () => {
    sondaDaEdge = () => respondePix(false);
    expect(await lerPixDisponivel()).toBe(false);
    // A lojista cadastra a chave; a próxima abertura do checkout pergunta de novo.
    sondaDaEdge = () => respondePix(true);
    expect(await lerPixDisponivel()).toBe(true);
    // E o desconhecido também não fica preso.
    sondaDaEdge = () => ({ data: null, error: { message: "rede" } });
    expect(await lerPixDisponivel()).toBeNull();
    sondaDaEdge = () => respondePix(false);
    expect(await lerPixDisponivel()).toBe(false);
    expect(chamadasDaSonda()).toHaveLength(4);
  });

  it("edge ANTIGA (não conhece a ação): o 400 'Pedido inválido.' real do supabase-js é DESCONHECIDO, nunca 'esconder'", async () => {
    // Forma real do supabase-js v2 numa resposta não-2xx: `data` nulo e o
    // corpo dentro de `error.context` (um Response).
    sondaDaEdge = () => ({
      data: null,
      error: Object.assign(
        new Error("Edge Function returned a non-2xx status code"),
        {
          name: "FunctionsHttpError",
          context: new Response(JSON.stringify({ error: "Pedido inválido." }), {
            status: 400,
          }),
        },
      ),
    });
    expect(await buscarPixDisponivel()).toBeNull();
  });

  it("a sonda que NÃO responde estoura o prazo e vira desconhecido (a auto-seleção não fica esperando para sempre)", async () => {
    vi.useFakeTimers();
    try {
      sondaDaEdge = () => new Promise<Resposta>(() => {});
      const pendente = buscarPixDisponivel();
      await vi.advanceTimersByTimeAsync(PRAZO_DA_SONDA_MS + 1);
      expect(await pendente).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CheckoutView — o PIX pelo app segue a sonda da edge", () => {
  beforeEach(() => {
    createOrder.mockReset();
    createOrder.mockResolvedValue({ id: "ped-777" });
    onNavigate.mockClear();
    propsDoPagamento.length = 0;
    mockUser = { id: "user-1", email: "cliente@exemplo.com" };
    mockCart = [item()];
    mockCartTotal = 100;
    mockShippingFee = 20;
    mockSelectedShippingOption = { ...ENTREGA_LOCAL };
    mockConfigDoCartao = CARTAO_LIGADO;
    mockOnlineLigado = true;
    mockFormasNaEntrega = undefined;
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

  it("REPRODUZ o defeito: sonda {pix:false} + cartão ligado → não há opção PIX no app; o cartão fica e vira o submétodo do pedido", async () => {
    sondaDaEdge = () => respondePix(false);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    expect(opcaoPix()).toBeUndefined();
    expect(grupoDePagamento().textContent).not.toContain("PIX");
    expect(grupoDePagamento().textContent).toContain("No app");
    // O PIX NA ENTREGA é outra coisa (paga na mão) e continua.
    expect(botaoPorTexto(grupoDePagamento(), "Pix na Entrega")).toBeDefined();

    await clicar(opcaoCartao()!);
    expect(opcaoCartao()!.getAttribute("aria-checked")).toBe("true");
    await finalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].paymentMethod).toBe("online");
    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");
  });

  it("PIX escolhido ANTES de a sonda voltar e depois escondido: o padrão efetivo vira cartão, e o pedido nunca sai como PIX", async () => {
    let soltar!: (r: Resposta) => void;
    sondaDaEdge = () => new Promise<Resposta>((ok) => (soltar = ok));
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    // Sonda ainda no ar: desconhecido -> oferece o PIX, como sempre foi.
    await clicar(opcaoPix()!);
    expect(opcaoPix()!.getAttribute("aria-checked")).toBe("true");

    await act(async () => {
      soltar(respondePix(false));
      await esperarMicrotarefas();
    });

    expect(opcaoPix()).toBeUndefined();
    expect(opcaoCartao()!.getAttribute("aria-checked")).toBe("true");
    await finalizar();
    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");
  });

  it("não cria pedido Pix ao finalizar enquanto a sonda pendente ainda pode responder false", async () => {
    let soltar!: (r: Resposta) => void;
    sondaDaEdge = () => new Promise<Resposta>((ok) => (soltar = ok));
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(opcaoPix()!);

    await preencherFormulario();
    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(botao.disabled).toBe(true);
    const onClickReal = capturarOnClick(botao);
    await act(async () => {
      onClickReal();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();

    await act(async () => {
      soltar(respondePix(false));
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(opcaoPix()).toBeUndefined();
  });

  it("cartão pode finalizar enquanto a sonda de Pix está pendente", async () => {
    let soltar!: (r: Resposta) => void;
    sondaDaEdge = () => new Promise<Resposta>((ok) => (soltar = ok));
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(opcaoCartao()!);

    await finalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");
    await act(async () => {
      soltar(respondePix(false));
      await esperarMicrotarefas();
    });
  });

  it("sonda Pix sem resposta libera o envio após o prazo (fail-open)", async () => {
    sondaDaEdge = () => new Promise<Resposta>(() => {});
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(opcaoPix()!);
    await preencherFormulario();
    expect(botaoPorTexto(document.body, "Finalizar Pedido")!.disabled).toBe(true);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, PRAZO_DA_SONDA_MS));
      await esperarMicrotarefas();
    });
    expect(botaoPorTexto(document.body, "Finalizar Pedido")!.disabled).toBe(false);
    await clicar(botaoPorTexto(document.body, "Finalizar Pedido")!);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(propsDoPagamento.at(-1)!.metodo).toBe("pix");
  }, 12_000);

  it("transportadora + sonda {pix:false} + cartão: auto-seleciona online JÁ no cartão, e o aviso não promete PIX", async () => {
    sondaDaEdge = () => respondePix(false);
    mockSelectedShippingOption = { ...TRANSPORTADORA };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);

    expect(opcaoPix()).toBeUndefined();
    expect(opcaoCartao()!.getAttribute("aria-checked")).toBe("true");
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo.mock.calls[0][0]).not.toMatch(/PIX/);
    expect(grupoDePagamento().textContent).not.toMatch(/só oferecemos o PIX/);

    await finalizar();
    expect(propsDoPagamento.at(-1)!.metodo).toBe("cartao");
  });

  it("sonda {pix:false} e cartão DESLIGADO → nenhuma opção online: só as formas na entrega", async () => {
    sondaDaEdge = () => respondePix(false);
    mockConfigDoCartao = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    expect(grupoDePagamento().textContent).not.toContain("No app");
    expect(opcaoPix()).toBeUndefined();
    expect(opcaoCartao()).toBeUndefined();
    expect(botaoPorTexto(grupoDePagamento(), "Pix na Entrega")).toBeDefined();
    expect(
      botaoPorTexto(grupoDePagamento(), "Dinheiro na Entrega"),
    ).toBeDefined();
  });

  it("ACEITE — sonda {pix:false}, sem cartão, transportadora: NÃO auto-seleciona online e o Finalizar fica travado; o submit real não cria pedido", async () => {
    sondaDaEdge = () => respondePix(false);
    mockConfigDoCartao = null;
    mockSelectedShippingOption = { ...TRANSPORTADORA };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);
    await preencherFormulario();

    expect(toastInfo).not.toHaveBeenCalled();
    expect(grupoDePagamento().textContent).not.toContain("No app");
    expect(grupoDePagamento().textContent).toContain(
      "esta loja não recebe pagamento pelo app",
    );
    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(botao).toBeDefined();
    expect(botao.disabled).toBe(true);

    const onClickReal = capturarOnClick(botao);
    await act(async () => {
      onClickReal();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("CONTROLE do aceite: os MESMOS campos, transportadora e cartão desligado, com a sonda {pix:true}, habilitam o Finalizar (auto-seleciona o PIX)", async () => {
    sondaDaEdge = () => respondePix(true);
    mockConfigDoCartao = null;
    mockSelectedShippingOption = { ...TRANSPORTADORA };
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);
    await preencherFormulario();

    expect(opcaoPix()!.getAttribute("aria-checked")).toBe("true");
    expect(botaoPorTexto(document.body, "Finalizar Pedido")!.disabled).toBe(
      false,
    );
  });

  it("PIX escolhido ANTES de a sonda voltar {pix:false}, sem cartão: fica 'online' stale, o Finalizar trava e o submit real não cria pedido", async () => {
    let soltar!: (r: Resposta) => void;
    sondaDaEdge = () => new Promise<Resposta>((ok) => (soltar = ok));
    mockConfigDoCartao = null;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await clicar(opcaoPix()!);
    await preencherFormulario();
    expect(botaoPorTexto(document.body, "Finalizar Pedido")!.disabled).toBe(
      true,
    );

    await act(async () => {
      soltar(respondePix(false));
      await esperarMicrotarefas();
    });

    const botao = botaoPorTexto(document.body, "Finalizar Pedido")!;
    expect(botao.disabled).toBe(true);
    const onClickReal = capturarOnClick(botao);
    await act(async () => {
      onClickReal();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("sonda {pix:false}, sem cartão, e a forma na entrega selecionada some da loja: o fallback cai na 1ª forma na entrega, nunca em 'online'", async () => {
    sondaDaEdge = () => respondePix(false);
    mockConfigDoCartao = null;
    mockFormasNaEntrega = ["cash"];
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);

    expect(grupoDePagamento().textContent).not.toContain("No app");
    expect(
      botaoPorTexto(grupoDePagamento(), "Dinheiro na Entrega")!.getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
  });

  it("CONTROLE do fallback: com a sonda {pix:true} o mesmo cenário cai em 'online' (PIX), como sempre foi", async () => {
    sondaDaEdge = () => respondePix(true);
    mockConfigDoCartao = null;
    mockFormasNaEntrega = ["cash"];
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);

    expect(opcaoPix()!.getAttribute("aria-checked")).toBe("true");
  });

  it("sonda {pix:true} → o PIX aparece como hoje, ao lado do cartão, e sai como PIX", async () => {
    sondaDaEdge = () => respondePix(true);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    const texto = grupoDePagamento().textContent ?? "";
    expect(texto.indexOf("Pagar agora com PIX")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("Cartão de crédito ou débito")).toBeGreaterThan(
      texto.indexOf("Pagar agora com PIX"),
    );

    await clicar(opcaoPix()!);
    await finalizar();
    expect(propsDoPagamento.at(-1)!.metodo).toBe("pix");
  });

  it.each([
    ["erro HTTP (5xx)", () => ({ data: null, error: { message: "503" } })],
    [
      "erro HTTP (409 do PIX sem chave, corpo ilegível)",
      () => ({ data: null, error: { message: "409" } }),
    ],
    ["rede que rejeita", () => Promise.reject(new Error("Failed to fetch"))],
    [
      "edge antiga (não conhece a ação)",
      () => ({ data: { error: "Pedido inválido." }, error: null }),
    ],
    ["corpo estranho ({pix:'false'} string)", () => respondePix("false")],
    ["corpo vazio", () => ({ data: null, error: null })],
  ])(
    "FAIL-OPEN: %s → o PIX continua sendo oferecido (a edge é quem recusa)",
    async (_nome, sonda) => {
      sondaDaEdge = sonda as () => Resposta;
      const { CheckoutView } = await import("@/views/customer/CheckoutView");
      await montar(CheckoutView);

      expect(opcaoPix()).toBeDefined();
      await clicar(opcaoPix()!);
      expect(opcaoPix()!.getAttribute("aria-checked")).toBe("true");
      await finalizar();
      expect(propsDoPagamento.at(-1)!.metodo).toBe("pix");
    },
  );

  it("UMA consulta por ABERTURA do checkout: re-renderizar não repete a ida à edge; abrir de novo pergunta de novo", async () => {
    sondaDaEdge = () => respondePix(true);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);
    await remontar(CheckoutView);
    await remontar(CheckoutView);
    expect(chamadasDaSonda()).toHaveLength(1);
    expect(chamadasDaSonda()[0][1]).toEqual({ body: { acao: "metodos" } });

    // Nova abertura (a PWA ficou dias aberta): o `false` de antes não vale.
    act(() => {
      raiz.unmount();
    });
    sondaDaEdge = () => respondePix(false);
    raiz = createRoot(hospedeiro);
    await montar(CheckoutView);
    expect(chamadasDaSonda()).toHaveLength(2);
    expect(opcaoPix()).toBeUndefined();
  });

  it("convidado NÃO consulta a edge (online exige conta): o PIX aparece travado, como hoje", async () => {
    mockUser = null;
    sondaDaEdge = () => respondePix(false);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    expect(chamadasDaSonda()).toHaveLength(0);
    expect(opcaoPix()).toBeDefined();
    expect(opcaoPix()!.textContent).toContain("exige conta");
  });

  it("pagamento pelo app desligado na loja NÃO consulta a edge", async () => {
    mockOnlineLigado = false;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await montar(CheckoutView);

    expect(chamadasDaSonda()).toHaveLength(0);
    expect(grupoDePagamento().textContent).not.toContain("No app");
  });
});

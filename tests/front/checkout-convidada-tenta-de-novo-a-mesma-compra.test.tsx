// @vitest-environment jsdom
//
// A cliente SEM CONTA toca "Finalizar" e o servidor não responde em 30 s (ou
// devolve um erro que o app não reconhece). Até esta correção o painel dela só
// oferecia "Ver meus pedidos" — que leva a uma busca que exige e-mail e o
// número do pedido, e ela não tem nenhum dos dois (o formulário de convidado
// nunca pede e-mail e o número nunca chegou). O botão Finalizar ficava travado
// e a única saída era desistir.
//
// A saída agora é "Tentar de novo", que REENVIA EXATAMENTE a compra que ficou
// sem resposta: mesma chave de idempotência, mesmo conteúdo, nunca remontado a
// partir do formulário. Reenviar é seguro porque o banco devolve o pedido que
// já nasceu para a mesma chave (create_marketplace_order_v23/v24, passo 0).
//
// Harness copiado de checkout-conferir-antes-tranca-o-finalizar.test.tsx
// (render real via react-dom/client + jsdom), com estado mutável do teste
// (usuário, carrinho, loja, rede) em `vi.hoisted` para o dublê ler fresco a
// cada render.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

const { estado, produto } = vi.hoisted(() => {
  const produto = {
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
  return {
    produto,
    estado: {
      user: null as null | { id: string },
      enderecos: [] as unknown[],
      cart: [{ product: produto, quantity: 1 }] as unknown[],
      cartTotal: 100,
      config: {
        shippingCoverage: "local",
        originCep: "38500-000",
        localCepRange: "01310-100",
        enableCoupons: false,
        whatsappNumber: "",
      } as Record<string, unknown>,
      offline: false,
    },
  };
});

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: estado.enderecos,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: estado.cart,
      cartTotal: estado.cartTotal,
      shippingFee: 0,
      clearCart,
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
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
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

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

const botaoFinalizar = () => botaoPorTexto("Finalizar Pedido");
const botaoTentarDeNovo = () =>
  document.body.querySelector(
    'button[data-acao="reenviar_mesma_compra"]',
  ) as HTMLButtonElement | null;

async function preencherEClicarFinalizar() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    digitar("guest-street", "Rua Teste");
    digitar("guest-number", "100");
    digitar("guest-neighborhood", "Centro");
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-cep", "01310-100");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-city", "Cidade Teste");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-state", "SP");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
  await act(async () => {
    botaoFinalizar()!.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — convidada sem resposta do servidor tem saída: tentar de novo a MESMA compra", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  const elemento = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    return (
      <CheckoutView
        onNavigate={onNavigate}
        onSetBackOverride={onSetBackOverride}
      />
    );
  };

  async function montar() {
    const el = await elemento();
    await act(async () => {
      raiz.render(el);
    });
  }

  async function renderizarDeNovo() {
    const el = await elemento();
    await act(async () => {
      raiz.render(el);
      await esperarMicrotarefas();
    });
  }

  async function clicarTentarDeNovo() {
    await act(async () => {
      botaoTentarDeNovo()!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    toastError.mockReset();
    onNavigate.mockReset();
    estado.user = null;
    estado.enderecos = [];
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    estado.offline = false;
    estado.config = {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    };
    sessionStorage.clear();
    pararABuscaDeCep();
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

  it("erro sem código (não se sabe se o pedido nasceu): o painel oferece 'Tentar de novo', nunca 'Ver meus pedidos', e o Finalizar segue travado", async () => {
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    const botao = botaoTentarDeNovo();
    expect(botao).not.toBeNull();
    expect(botao!.textContent).toBe("Tentar de novo");
    expect(
      document.querySelector('button[data-acao="conferir_antes"]'),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("Ver meus pedidos");
    // A frase diz a verdade: vamos reenviar a MESMA compra e ela não sai em dobro.
    const alerta = document.querySelector('[role="alert"]')!.textContent!;
    expect(alerta).toContain("não sai em dobro");
    expect(alerta).not.toContain("confira seus pedidos");
    // O toast diz a MESMA coisa que o painel (nunca "verifique se já apareceu").
    const textoDoToast = String(toastError.mock.calls.at(-1)?.[0]);
    expect(textoDoToast).toContain("não sai em dobro");
    expect(textoDoToast).not.toContain("Verifique se ele já apareceu");
    // O aviso que acompanha o botão travado aponta a saída certa.
    const aviso = document.querySelector(
      '[data-testid="aviso-como-destravar-finalizar"]',
    );
    expect(aviso?.textContent).toContain("Tentar de novo");
    expect(aviso?.textContent).toContain("não foi criado");
    // Travado de propósito: o único caminho de reenvio é o congelado.
    expect(botaoFinalizar()!.disabled).toBe(true);
  });

  it("sem resposta em 30 s: mesma frase honesta no painel E no toast, e 'Tentar de novo' no lugar de 'Ver meus pedidos'", async () => {
    createOrder.mockImplementationOnce(() => new Promise(() => {}));
    await montar();
    const agendar = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, prazo, ...args) =>
        agendar(callback, prazo === 30_000 ? 1 : prazo, ...args),
    );
    await preencherEClicarFinalizar();

    expect(botaoTentarDeNovo()).not.toBeNull();
    expect(document.body.textContent).not.toContain("Ver meus pedidos");
    expect(document.body.textContent).not.toContain("confira seus pedidos");
    const textoDoToast = String(toastError.mock.calls.at(-1)?.[0]);
    expect(textoDoToast).toContain("não sai em dobro");
  });

  it("reenvia a MESMA chave e o MESMO conteúdo, e no sucesso mostra o pedido e limpa o carrinho uma vez", async () => {
    createOrder.mockRejectedValueOnce({});
    createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
    await montar();
    await preencherEClicarFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);

    await clicarTentarDeNovo();

    expect(createOrder).toHaveBeenCalledTimes(2);
    const [primeiro, segundo] = createOrder.mock.calls;
    expect(segundo[0].idempotencyKey).toBe(primeiro[0].idempotencyKey);
    expect(segundo[0]).toEqual(primeiro[0]);
    expect(segundo[1]).toEqual(primeiro[1]);
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Pedido Celebrado");
    // A chave cumpriu o papel: a próxima compra nasce com chave nova.
    expect(sessionStorage.getItem("ikcous-chave-do-pedido")).toBeNull();
  });

  it("o reenvio usa o payload CONGELADO da tentativa sem resposta, mesmo que o carrinho tenha mudado depois", async () => {
    createOrder.mockRejectedValueOnce({});
    createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
    await montar();
    await preencherEClicarFinalizar();
    const primeiro = structuredClone(createOrder.mock.calls[0][0]);
    expect(primeiro.items[0].quantity).toBe(1);
    expect(primeiro.totalAmount).toBe(100);

    // O carrinho muda por baixo (3 unidades, R$ 300). Remontar o payload a
    // partir da tela giraria outra chave e poderia criar um SEGUNDO pedido.
    estado.cart = [{ product: produto, quantity: 3 }];
    estado.cartTotal = 300;
    await renderizarDeNovo();
    expect(botaoFinalizar()!.disabled).toBe(true);

    await clicarTentarDeNovo();

    expect(createOrder).toHaveBeenCalledTimes(2);
    const reenviado = createOrder.mock.calls[1][0];
    expect(reenviado.items).toEqual(primeiro.items);
    expect(reenviado.items[0].quantity).toBe(1);
    expect(reenviado.totalAmount).toBe(100);
    expect(reenviado.idempotencyKey).toBe(primeiro.idempotencyKey);
    expect(reenviado).toEqual(primeiro);
  });

  it("reenvio que falha de novo mantém o painel e a mesma chave para a terceira tentativa", async () => {
    createOrder.mockRejectedValueOnce({});
    createOrder.mockRejectedValueOnce({});
    createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
    await montar();
    await preencherEClicarFinalizar();
    const chave = createOrder.mock.calls[0][0].idempotencyKey;

    await clicarTentarDeNovo();
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(botaoTentarDeNovo()).not.toBeNull();
    expect(botaoFinalizar()!.disabled).toBe(true);

    await clicarTentarDeNovo();
    expect(createOrder).toHaveBeenCalledTimes(3);
    expect(createOrder.mock.calls[2][0].idempotencyKey).toBe(chave);
    expect(document.body.textContent).toContain("Pedido Celebrado");
  });

  it("toque duplo em 'Tentar de novo' envia UMA vez só", async () => {
    createOrder.mockRejectedValueOnce({});
    createOrder.mockImplementationOnce(() => new Promise(() => {}));
    await montar();
    await preencherEClicarFinalizar();

    const botao = botaoTentarDeNovo()!;
    await act(async () => {
      botao.click();
      botao.click();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(2);
  });

  it("sem internet: não envia, avisa, e o painel continua com a saída", async () => {
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    estado.offline = true;
    await renderizarDeNovo();
    await clicarTentarDeNovo();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls.at(-1)?.[0])).toContain("Sem conexão");
    expect(botaoTentarDeNovo()).not.toBeNull();

    // A internet volta: o MESMO botão reenvia a mesma compra.
    estado.offline = false;
    createOrder.mockResolvedValueOnce({ id: "pedido-1234abcd" });
    await renderizarDeNovo();
    await clicarTentarDeNovo();
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(createOrder.mock.calls[1][0].idempotencyKey).toBe(
      createOrder.mock.calls[0][0].idempotencyKey,
    );
  });

  it("se a pessoa entrou numa conta no meio do caminho, o payload de convidada NÃO é reenviado", async () => {
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    // O banco só devolve o pedido da chave para o mesmo dono: reenviar o
    // payload de convidada sob uma sessão de conta criaria um pedido NOVO.
    estado.user = { id: "user-1" };
    await renderizarDeNovo();
    const botao = botaoTentarDeNovo();
    if (botao) {
      await act(async () => {
        botao.click();
        await esperarMicrotarefas();
      });
    }

    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("com WhatsApp da loja cadastrado, oferece 'Falar com a loja'; sem WhatsApp, não mostra", async () => {
    estado.config = { ...estado.config, whatsappNumber: "34999998888" };
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    const falar = botaoPorTexto("Falar com a loja");
    expect(falar).toBeDefined();
    const abrir = vi.spyOn(globalThis, "open").mockImplementation(() => null);
    await act(async () => {
      falar!.click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/wa\.me\/5534999998888\?text=/);
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
    // Nenhuma promessa de que o pedido existe: a mensagem é de dúvida.
    expect(decodeURIComponent(String(url))).not.toContain("#");
  });

  it("sem WhatsApp cadastrado, 'Falar com a loja' não aparece", async () => {
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    expect(botaoTentarDeNovo()).not.toBeNull();
    expect(botaoPorTexto("Falar com a loja")).toBeUndefined();
  });

  it("fechar o aviso devolve o Finalizar (a pessoa assumiu que o pedido não nasceu) e o painel some", async () => {
    createOrder.mockRejectedValueOnce({});
    await montar();
    await preencherEClicarFinalizar();

    await act(async () => {
      (
        document.body.querySelector(
          'button[aria-label="Fechar o aviso"]',
        ) as HTMLButtonElement
      ).click();
      await esperarMicrotarefas();
    });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(botaoFinalizar()!.disabled).toBe(false);
    expect(botaoTentarDeNovo()).toBeNull();
  });
});

describe("CheckoutView — com conta o painel de 'conferir antes' continua exatamente como era", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    toastError.mockReset();
    onNavigate.mockReset();
    estado.user = { id: "user-1" };
    estado.enderecos = [
      {
        id: "addr-1",
        user_id: "user-1",
        name: "Casa",
        recipient_name: "Cliente Teste",
        cep: "01310-100",
        street: "Rua Teste",
        number: "100",
        neighborhood: "Centro",
        city: "Cidade Teste",
        state: "SP",
        is_default: true,
      },
    ];
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    estado.offline = false;
    estado.config = {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "34999998888",
    };
    sessionStorage.clear();
    pararABuscaDeCep();
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

  it("logada, erro sem código: 'Ver meus pedidos' (conferir_antes), sem 'Tentar de novo' nem 'Falar com a loja', Finalizar travado", async () => {
    createOrder.mockRejectedValueOnce({});
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
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      botaoPorTexto("Dinheiro na Entrega")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      botaoFinalizar()!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('button[data-acao="conferir_antes"]'),
    ).not.toBeNull();
    expect(botaoTentarDeNovo()).toBeNull();
    expect(botaoPorTexto("Falar com a loja")).toBeUndefined();
    expect(document.body.textContent).toContain("Ver meus pedidos");
    expect(botaoFinalizar()!.disabled).toBe(true);
  });
});

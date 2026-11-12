// @vitest-environment jsdom
//
// CAÇA 02/11 (grupo G1-checkout, achados a0 e a1): os campos de TEXTO LIVRE do
// checkout tinham duas frestas. (a0) Um nome só de espaços passava no zod
// (`min(1)` conta espaço) e acendia o Finalizar: o pedido saía com nome em
// branco. (a1) Observação do pedido e complemento do endereço não tinham teto
// de tamanho: colar um textão ia inteiro para o pedido. Aqui o visitante
// preenche o formulário até ficar VÁLIDO (o controle prova que o botão acende)
// e só então se mexe no campo sob teste. Harness de
// `checkout-convidado-10-acende-e-11-apaga-o-finalizar.test.tsx`.
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
    stock: 50,
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
const removeFromCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

// A conferência da sessão antes de enviar (caça 7) tem suíte própria
// (checkout-pedido-chave-voltar-e-sessao.test.tsx); aqui a sessão está viva.
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

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
      removeFromCart,
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

function preencherValido(nome: string) {
  digitar("checkout-name", nome);
  digitar("checkout-tel", "34999999999");
  digitar("guest-street", "Rua Teste");
  digitar("guest-number", "100");
  digitar("guest-neighborhood", "Centro");
}

describe("CheckoutView (visitante) — nome e campos de texto livre", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.user = null;
    estado.enderecos = [];
    estado.offline = false;
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    estado.config = {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    };
    createOrder.mockReset();
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

  /** Monta o checkout do visitante e preenche tudo; `depois` mexe num campo
   * ANTES do último assentamento (para o Finalizar refletir o valor final). */
  async function montarEPreencher(nome: string, depois?: () => void) {
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
      preencherValido(nome);
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
    if (depois) {
      await act(async () => {
        depois();
        await esperarMicrotarefas();
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
  }

  it("controle: com nome de verdade e formulário válido, o Finalizar está aceso", async () => {
    await montarEPreencher("Cliente Teste");

    expect(botaoFinalizar()).toBeDefined();
    expect(botaoFinalizar()!.disabled).toBe(false);
  });

  it("a0: nome só de espaços NÃO acende o Finalizar, e nenhum pedido é criado", async () => {
    await montarEPreencher("   ");

    expect(botaoFinalizar()).toBeDefined();
    expect(botaoFinalizar()!.disabled).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it.each(["\u{200B}", "\u{2800}"])(
    "nome invisível %j não libera o pedido e mostra o erro no campo",
    async (nome) => {
      await montarEPreencher(nome);
      expect(botaoFinalizar()!.disabled).toBe(true);
      await act(async () => {
        (document.getElementById("checkout-name") as HTMLInputElement).focus();
      });
      await act(async () => {
        (document.getElementById("checkout-name") as HTMLInputElement).blur();
        await esperarMicrotarefas();
      });
      expect(document.getElementById("erro-checkout-name")?.textContent).toBe(
        "Nome é obrigatório",
      );
      expect(createOrder).not.toHaveBeenCalled();
    },
  );

  it("a0 (borda): nome com espaços nas pontas continua válido, e o pedido leva o nome já aparado", async () => {
    createOrder.mockResolvedValue({ id: "ped-1" });
    await montarEPreencher("  Maria Teste  ");

    expect(botaoFinalizar()!.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar()!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].customer.name).toBe("Maria Teste");
  });

  it.each(["   ", "\u{200B}\u{2800}\u{3164}"])(
    "r173: observação e complemento vazios visualmente %j não vão no pedido",
    async (texto) => {
      createOrder.mockResolvedValue({ id: "ped-1" });
      await montarEPreencher("Cliente Teste", () => {
        digitar("guest-complement", texto);
        const notas = document.getElementById("order-notes")!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(notas, texto);
        notas.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(botaoFinalizar()!.disabled).toBe(false);
      await act(async () => {
        botaoFinalizar()!.click();
        await esperarMicrotarefas();
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].notes).toBe(
        "Frete Escolhido: Entrega Local (Prazo: 1 dia)",
      );
      expect(
        createOrder.mock.calls[0][0].addressData.complement,
      ).toBeUndefined();
    },
  );

  it.each([
    ["   ", "Produto Teste: Cor: Azul"],
    ["\u{200B}\u{2800}", "Produto Teste: Cor: Azul"],
    [
      "  Deixar na portaria  ",
      "Deixar na portaria\n\nProduto Teste: Cor: Azul",
    ],
  ])(
    "r173: observação %j não cria prefixo vazio nas escolhas",
    async (texto, esperado) => {
      estado.cart = [
        { product: produto, quantity: 1, variantNames: "Cor: Azul" },
      ];
      createOrder.mockResolvedValue({ id: "ped-1" });
      await montarEPreencher("Cliente Teste", () => {
        digitar("guest-complement", "  Casa dos fundos  ");
        const notas = document.getElementById("order-notes")!;
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(notas, texto);
        notas.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        botaoFinalizar()!.click();
        await esperarMicrotarefas();
      });
      expect(createOrder).toHaveBeenCalledTimes(1);
      expect(createOrder.mock.calls[0][0].notes).toBe(
        `${esperado}\n\nFrete Escolhido: Entrega Local (Prazo: 1 dia)`,
      );
      expect(createOrder.mock.calls[0][0].addressData.complement).toBe(
        "Casa dos fundos",
      );
    },
  );

  it("observação de exatamente 500 caracteres chega inteira ao pedido", async () => {
    const texto = `${"a".repeat(499)}z`;
    createOrder.mockResolvedValue({ id: "ped-1" });
    await montarEPreencher("Cliente Teste", () => {
      const notas = document.getElementById("order-notes")!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(notas, texto);
      notas.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(botaoFinalizar()!.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar()!.click();
      await esperarMicrotarefas();
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].notes).toBe(
      `${texto}\n\nFrete Escolhido: Entrega Local (Prazo: 1 dia)`,
    );
  });

  it("a1: observação do pedido e complemento têm teto de tamanho no próprio campo (500 e 100)", async () => {
    await montarEPreencher("Cliente Teste");

    const notas = document.getElementById("order-notes");
    const complemento = document.getElementById("guest-complement");
    expect(notas?.getAttribute("maxlength")).toBe("500");
    expect(complemento?.getAttribute("maxlength")).toBe("100");
  });

  it("a1: complemento passando de 100 caracteres (colado por fora do campo) não acende o Finalizar; com 100 acende", async () => {
    await montarEPreencher("Cliente Teste", () =>
      digitar("guest-complement", "x".repeat(101)),
    );
    expect(botaoFinalizar()!.disabled).toBe(true);

    await act(async () => {
      digitar("guest-complement", "x".repeat(100));
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(botaoFinalizar()!.disabled).toBe(false);
  });

  // r50-c: o formulário do visitante não tinha teto em nome, rua, número,
  // bairro e cidade (só no complemento e na observação), enquanto o endereço
  // da conta limita a 120/200 (AddressForm.tsx). O texto gigante ia inteiro
  // para o pedido, a ficha, a etiqueta e o recibo. Mesmos tetos da conta.
  const TETOS_DO_VISITANTE: ReadonlyArray<{
    id: string;
    campo: string;
    teto: number;
  }> = [
    { id: "checkout-name", campo: "nome", teto: 120 },
    { id: "guest-street", campo: "rua", teto: 200 },
    { id: "guest-number", campo: "número", teto: 20 },
    { id: "guest-neighborhood", campo: "bairro", teto: 120 },
    { id: "guest-city", campo: "cidade", teto: 120 },
  ];

  it("r50-c: nome, rua, número, bairro e cidade têm teto no próprio campo (120/200/20/120/120)", async () => {
    await montarEPreencher("Cliente Teste");

    for (const { id, teto } of TETOS_DO_VISITANTE) {
      expect(
        document.getElementById(id)?.getAttribute("maxlength"),
        `maxlength de #${id}`,
      ).toBe(String(teto));
    }
  });

  for (const { id, campo, teto } of TETOS_DO_VISITANTE) {
    it(`r50-c: ${campo} com ${teto + 1} caracteres (colado por fora do campo) não acende o Finalizar, mostra o aviso e não cria pedido; com ${teto} acende`, async () => {
      await montarEPreencher("Cliente Teste", () =>
        digitar(id, "x".repeat(teto + 1)),
      );
      expect(botaoFinalizar()!.disabled).toBe(true);
      expect(createOrder).not.toHaveBeenCalled();

      // O aviso aparece pelo caminho de sempre: depois que a pessoa sai do
      // campo, com o campo marcado como inválido e ligado à mensagem.
      await act(async () => {
        (document.getElementById(id) as HTMLInputElement).focus();
      });
      await act(async () => {
        (document.getElementById(id) as HTMLInputElement).blur();
        await esperarMicrotarefas();
        await esperarMicrotarefas();
      });
      const campoEl = document.getElementById(id) as HTMLInputElement;
      expect(campoEl.getAttribute("aria-invalid")).toBe("true");
      const idDoErro = campoEl.getAttribute("aria-describedby");
      expect(idDoErro).toBeTruthy();
      expect(document.getElementById(idDoErro!)?.textContent).toContain(
        `Máximo de ${teto} caracteres`,
      );

      await act(async () => {
        digitar(id, "x".repeat(teto));
        await esperarMicrotarefas();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(botaoFinalizar()!.disabled).toBe(false);
    });
  }

  it("r50-c (borda): nome de 120 caracteres com espaços nas pontas continua válido (o teto conta o nome já aparado)", async () => {
    createOrder.mockResolvedValue({ id: "ped-1" });
    await montarEPreencher(`  ${"n".repeat(120)}  `);

    expect(botaoFinalizar()!.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar()!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].customer.name).toBe("n".repeat(120));
  });
});

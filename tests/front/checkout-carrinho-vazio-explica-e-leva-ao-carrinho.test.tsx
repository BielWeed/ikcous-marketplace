// @vitest-environment jsdom
//
// Checkout aberto com o carrinho VAZIO e nada a retomar (F5 na tela "Pedido
// realizado", app reaberto em /checkout, link direto). A guarda do App só vale
// no Voltar do aparelho; aqui a tela "Finalizar compra" montava inteira --
// campos, sem item, sem resumo, botão apagado -- sem dizer por quê. Agora a
// tela diz "Seu carrinho está vazio" e oferece "Voltar ao carrinho".
//
// Ficam de fora, e provados como controle/borda: carrinho com itens, carrinho
// ainda sendo lido da conta (não é "vazio" ainda), pagamento a retomar
// (`retomarPedidoId`) e a compra sem resposta guardada para reenviar (o
// painel "Tentar de novo" mora no formulário e precisa continuar alcançável).
//
// Carrinho SALVO da conta que não foi lido (a leitura falhou ou passou de 8 s):
// lista vazia aqui também NÃO é "vazio" -- a tela avisa e oferece "Tentar de
// novo" (o mesmo sinal `carrinhoSalvoNaoLido` da tela do carrinho).
import { guardarReciboDoCheckout } from "@/lib/recibo-do-checkout";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
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

// Referências ESTÁVEIS entre renders (um objeto novo por render reativaria,
// em laço, os efeitos que dependem de `user`).
const { usuario, estado } = vi.hoisted(() => {
  const usuario = { id: "user-1" };
  return {
    usuario,
    estado: {
      user: usuario as { id: string } | null,
      lendoOCarrinho: false,
      carrinhoSalvoNaoLido: false,
    },
  };
});
const { relerCarrinhoSalvo } = vi.hoisted(() => ({
  relerCarrinhoSalvo: vi.fn(),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      isLoading: estado.lendoOCarrinho,
      carrinhoSalvoNaoLido: estado.carrinhoSalvoNaoLido,
      relerCarrinhoSalvo,
      cartTotal: 0,
      shippingFee: 0,
      clearCart: () => {},
      addToCart: () => {},
      selectedShippingOption: null,
      shippingCep: null,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => true }));

const { lerPedido } = vi.hoisted(() => ({ lerPedido: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => lerPedido(),
          single: () =>
            Promise.resolve({
              data: { payment_status: "aguardando", expires_at: null },
              error: null,
            }),
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

const FRASE_DO_CARRINHO_VAZIO = "Seu carrinho está vazio";
const FRASE_DO_CARRINHO_NAO_LIDO =
  "Não conseguimos carregar seu carrinho salvo agora. Estamos tentando de novo.";
const ITEM = {
  product: {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 50,
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
};

describe("CheckoutView — carrinho vazio e nada a retomar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onNavigate = vi.fn();

  beforeEach(() => {
    estado.user = usuario;
    estado.lendoOCarrinho = false;
    estado.carrinhoSalvoNaoLido = false;
    relerCarrinhoSalvo.mockReset();
    relerCarrinhoSalvo.mockResolvedValue(undefined);
    lerPedido.mockReset();
    onNavigate.mockReset();
    sessionStorage.clear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  async function esvaziar() {
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  async function renderizar(
    props: Partial<{
      retomarPedidoId: string;
      cart: (typeof ITEM)[];
    }> = {},
  ) {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={() => {}}
          {...(props as Record<string, unknown>)}
        />,
      );
    });
    await esvaziar();
  }

  // A barra de baixo do formulário (Finalizar, avisos) só monta depois de
  // `useDeferredRender(380)`; quem prova AUSÊNCIA dela espera esse prazo.
  async function esperarABarraMontar() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
  }
  const botaoFinalizar = () =>
    document.body.querySelector('button[aria-label="Finalizar pedido"]');

  const botoes = () =>
    Array.from(hospedeiro.querySelectorAll("button")).map((b) =>
      (b.textContent ?? "").trim(),
    );
  const botao = (rotulo: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === rotulo,
    ) as HTMLButtonElement | undefined;
  const texto = () => hospedeiro.textContent ?? "";

  it("diz que o carrinho está vazio e 'Voltar ao carrinho' leva ao carrinho", async () => {
    await renderizar();
    await esperarABarraMontar();

    expect(texto()).toContain(FRASE_DO_CARRINHO_VAZIO);
    const voltar = botao("Voltar ao carrinho");
    expect(voltar).toBeDefined();
    // Nada do formulário de compra sem item: nem campos, nem o Finalizar.
    expect(hospedeiro.querySelector("form, input")).toBeNull();
    expect(botaoFinalizar()).toBeNull();

    await act(async () => {
      voltar?.click();
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("convidado (sem conta) com carrinho vazio também recebe a explicação", async () => {
    estado.user = null;
    await renderizar();

    expect(texto()).toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(botoes()).toContain("Voltar ao carrinho");
  });

  it("carrinho ainda sendo lido da conta: não diz 'vazio' (ainda não dá para saber)", async () => {
    estado.lendoOCarrinho = true;
    await renderizar();

    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(botoes()).not.toContain("Voltar ao carrinho");
    expect(texto()).toContain("Carregando seu carrinho");
  });

  it("carrinho salvo da conta que não carregou: avisa em vez de dizer 'vazio', e o 'Tentar de novo' relê", async () => {
    estado.carrinhoSalvoNaoLido = true;
    await renderizar();

    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(texto()).toContain(FRASE_DO_CARRINHO_NAO_LIDO);
    // Nada do formulário de compra sem item: nem campos, nem o Finalizar.
    expect(hospedeiro.querySelector("form, input")).toBeNull();
    expect(botoes()).toEqual(["Tentar de novo", "Voltar ao carrinho"]);

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    expect(relerCarrinhoSalvo).toHaveBeenCalledTimes(1);

    await act(async () => {
      botao("Voltar ao carrinho")?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("cart");
  });

  it("carrinho salvo não lido, mas há recibo do pedido desta conta: o recibo manda (o pedido JÁ foi feito)", async () => {
    estado.carrinhoSalvoNaoLido = true;
    guardarReciboDoCheckout("user-1", "0f8fad5b-d9cb-469f-a165-70867728950e");
    await renderizar();

    expect(texto()).not.toContain(FRASE_DO_CARRINHO_NAO_LIDO);
    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(botoes()).not.toContain("Tentar de novo");
  });

  it("carrinho com item: nada de 'vazio' — o formulário de compra monta", async () => {
    await renderizar({ cart: [ITEM] });
    await esperarABarraMontar();

    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(botaoFinalizar()).not.toBeNull();
    expect(botoes()).not.toContain("Voltar ao carrinho");
    expect(hospedeiro.querySelector("h1")?.textContent).toBe(
      "Finalizar compra",
    );
  });

  it("pagamento a retomar com carrinho vazio: a retomada manda, nunca a frase de vazio", async () => {
    lerPedido.mockResolvedValue({
      data: null,
      error: { message: "FetchError: Failed to fetch" },
    });
    await renderizar({ retomarPedidoId: "ped-999" });

    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(botoes()).not.toContain("Voltar ao carrinho");
    expect(botoes()).toEqual(["Tentar de novo", "Ver meus pedidos"]);
  });

  it("pagamento retomado com sucesso e carrinho vazio: a frase de vazio não aparece nem por um quadro", async () => {
    lerPedido.mockResolvedValue({
      data: { total: 149.9, metodo_online: "pix" },
      error: null,
    });
    let viuAFrase = false;
    const observador = new MutationObserver(() => {
      if ((hospedeiro.textContent ?? "").includes(FRASE_DO_CARRINHO_VAZIO)) {
        viuAFrase = true;
      }
    });
    observador.observe(hospedeiro, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await renderizar({ retomarPedidoId: "ped-999" });
    await esperarABarraMontar();
    observador.disconnect();

    expect(viuAFrase).toBe(false);
    expect(texto()).not.toContain(FRASE_DO_CARRINHO_VAZIO);
  });

  it("compra sem resposta guardada (convidada): o 'Tentar de novo' do formulário continua alcançável", async () => {
    sessionStorage.setItem(
      "ikcous-pedido-sem-resposta-v1",
      JSON.stringify({
        versao: 1,
        expiraEm: Date.now() + 10 * 60_000,
        pedido: {
          orderData: { idempotencyKey: "chave-1", items: [] },
          ehOnline: false,
          metodoOnline: "pix",
          itens: [],
          valor: 50,
          contaEsperada: null,
          semConta: true,
        },
      }),
    );
    estado.user = null;
    await renderizar();
    await esperarABarraMontar();

    // O painel mora na barra de baixo (portal no body), não no hospedeiro.
    const tudo = document.body.textContent ?? "";
    expect(tudo).not.toContain(FRASE_DO_CARRINHO_VAZIO);
    expect(tudo).toContain("O pedido não foi confirmado");
    expect(
      Array.from(document.body.querySelectorAll("button")).some((b) =>
        (b.textContent ?? "").includes("Tentar de novo"),
      ),
    ).toBe(true);
  });
});

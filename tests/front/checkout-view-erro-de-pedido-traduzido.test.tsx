// @vitest-environment jsdom
//
// Ponto 1 do defeito, medido em src/views/customer/CheckoutView.tsx:975-982:
// quando fechar o pedido falha, o comprador lia o err.message CRU do banco
// (em inglês, com jargão de coluna/constraint) direto no toast — e o
// `globalThis.alert()` de emergência só disparava quando NÃO havia
// error.message, ou seja, ao contrário: quanto mais incompreensível o erro,
// MENOS aviso o comprador recebia.
//
// Modelo estrutural copiado de checkout-view-flag-off.test.tsx (mesmo
// harness de render real via react-dom/client + jsdom, necessário porque o
// botão "Finalizar Pedido" só existe depois do ciclo de vida de verdade:
// useDeferredRender(380) e a validação do react-hook-form).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
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
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: [
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
    cartTotal: 100,
    shippingFee: 0,
    clearCart,
    selectedShippingOption: null,
    shippingCep: "38500-000",
    // O efeito da reconciliação de CEP (onda 4 do laudo 3108) consome os
    // setters de verdade do contexto; o dublê precisa deles para o efeito
    // rodar sem quebrar (a limpeza dele não afeta o que estes testes afirmam).
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Espalha o módulo REAL (mensagemAmigavelErroPedido incluída) e só troca o
// hook — CheckoutView importa a função de tradução do MESMO módulo, e um
// mock que a omitisse faria a tela quebrar em vez de provar a tradução real.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement | undefined;
}

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

  const botao = localizarBotaoFinalizar()!;
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — o comprador para de ler o erro cru do banco ao fechar o pedido (Ponto 1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    toastError.mockReset();
    alertSpy = vi.spyOn(globalThis, "alert").mockImplementation(() => {});
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

  it("erro técnico cru do banco (violação de restrição): o toast NUNCA mostra o texto técnico, e nunca dispara o alert()", async () => {
    createOrder.mockRejectedValueOnce({
      code: "23505",
      message:
        'duplicate key value violates unique constraint "marketplace_orders_pkey"',
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherEClicarFinalizar();

    expect(toastError).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(toastError.mock.calls[0][0]);
    expect(mensagemMostrada).not.toContain("constraint");
    expect(mensagemMostrada).not.toContain("duplicate key");
    expect(mensagemMostrada).toContain("Falha no Pedido");
    // A lógica ANTERIOR disparava o alert() de emergência exatamente quando
    // HAVIA um error.message cru (a condição era `if (!error.message)`, e
    // aqui error.message existe) — então o alert JÁ NÃO disparava neste caso
    // antes desta correção. Provado aqui para travar que a correção não
    // reativa nenhum alert em cima do toast.
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("erro SEM message (ex.: objeto rejeitado sem forma de PostgrestError): o toast mostra frase honesta, e o alert() de emergência NÃO dispara mais", async () => {
    // Este é o caso que a lógica ANTERIOR tratava como "crítico" e mandava
    // por globalThis.alert() — bloqueando a tela até o cliente clicar OK.
    // Como o toast agora SEMPRE carrega uma frase utilizável
    // (mensagemAmigavelErroPedido nunca devolve vazio), o alert deixou de
    // ter um gatilho útil.
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

    await preencherEClicarFinalizar();

    expect(toastError).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(toastError.mock.calls[0][0]);
    // Correção 22/08/2026 (A2-fix2, bloqueio da revisão): um erro sem `code`
    // e sem `message` é o caso MAIS desconhecido que existe — não tem nem
    // SQLSTATE, nem texto. Presumir "tente de novo" aqui é o buraco que o
    // default falha-fechado (achado B da revisão anterior) fechou. A
    // expectativa velha ("Não foi possível criar seu pedido agora") ficou
    // para trás quando o irmão deste teste (erro-de-pedido-nao-mostra-
    // texto-cru-do-banco.test.ts:120) já foi corrigido — este arquivo não
    // tinha sido atualizado junto.
    expect(mensagemMostrada).toContain("Verifique se ele já apareceu");
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("falha de rede: a frase avisa para conferir se o pedido já apareceu, sem prometer que tentar de novo é seguro", async () => {
    createOrder.mockRejectedValueOnce({
      code: "",
      message: "TypeError: Failed to fetch",
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherEClicarFinalizar();

    expect(toastError).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(toastError.mock.calls[0][0]);
    expect(mensagemMostrada).toContain("Verifique se ele já apareceu");
  });

  it("recusa de negócio (P0001, ex.: estoque insuficiente): o toast mostra o texto da RPC, já em português e específico", async () => {
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message: "Estoque insuficiente para o produto Caneca Azul",
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherEClicarFinalizar();

    expect(toastError).toHaveBeenCalledTimes(1);
    const mensagemMostrada = String(toastError.mock.calls[0][0]);
    expect(mensagemMostrada).toContain(
      "Estoque insuficiente para o produto Caneca Azul",
    );
  });
});

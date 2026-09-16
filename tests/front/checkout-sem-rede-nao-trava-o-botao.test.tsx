// @vitest-environment jsdom
//
// Achado offline (CheckoutView.tsx:1451, laudo de 15/09/2026): sem rede, o
// `supabase.rpc` do `createOrder` resolve com `error.code === ""` (a
// assinatura que o postgrest-js devolve quando o PRÓPRIO fetch lança —
// node_modules/@supabase/postgrest-js/dist/index.cjs:356-364), e
// `classificarRecusaDoPedido` (recusaDoPedido.ts) manda esse código vazio
// para o caso genérico `conferir_antes` — que TRAVA o "Finalizar Pedido"
// (via `aguardandoConferenciaDaRecusa`) e manda "confira se ele já
// apareceu", embora seja PROVADO que nada saiu do aparelho (o fetch nem
// chegou a existir). Convidado nem tem "meus pedidos" para conferir.
//
// Duas partes do defeito, dois grupos de teste:
//   A) `decidirSaidaDoCheckout` (função pura já exportada pela view) tem
//      de reconhecer falha de rede e responder `tentar_de_novo` — mensagem
//      HONESTA, sem travar o botão — sem quebrar a supremacia do P0001 (uma
//      resposta REAL do banco nunca vira "tentar de novo", mesmo com
//      `navigator.onLine` mentindo pela corrida entre a resposta chegar e o
//      evento `offline` disparar).
//   B) A tela: `isOffline` (já lido pelo hook `useOnlineStatus`, hoje só
//      usado no cancelamento) passa a bloquear o Finalizar ANTES do clique
//      (com aviso próprio, mesmo padrão do aviso de frete), e uma falha que
//      chega DURANTE o clique com a assinatura de rede libera o botão em
//      vez de travá-lo.
//
// Modelo estrutural do grupo B copiado de
// checkout-conferir-antes-tranca-o-finalizar.test.tsx (mesmo harness de
// render real via react-dom/client + jsdom — o botão "Finalizar Pedido" só
// existe depois do ciclo de vida de verdade: useDeferredRender(380) e a
// validação do react-hook-form). Os mocks vivem no TOPO do arquivo, fora de
// qualquer `describe`, porque `vi.mock` é hoisted para o topo do módulo de
// qualquer forma — declará-los dentro de um bloco só engana o olho de quem
// lê, e quebra em runtime (referência a variável ainda não inicializada).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CheckoutView importa `supabase` de "@/lib/supabase" (para o fluxo real de
// pedido), e aquele módulo valida variável de ambiente na própria avaliação
// (`src/lib/env.ts`, via `src/lib/supabase.ts:6`). Esta máquina tem `.env`;
// o CI não tem nenhum, e o import explode antes do primeiro teste rodar —
// mesmo padrão de checkout-oferece-saida-na-recusa.test.tsx.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

// Caixa mutável para o `useOnlineStatus` poder mudar de valor entre os
// testes do grupo B sem precisar reescrever o mock inteiro.
const estadoDeRede = { offline: false };

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
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Espalha o módulo REAL (classificarRecusaDoPedido incluída) e só troca o
// hook — mesmo motivo do dublê copiado: um mock que omitisse a
// classificação real faria o defeito nunca aparecer.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estadoDeRede.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn() },
}));

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

function localizarAvisoDeRede() {
  return [...document.body.querySelectorAll('p[role="alert"]')].find((p) =>
    p.textContent?.includes("Sem conexão"),
  );
}

async function preencherFormulario() {
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
}

async function preencherEClicarFinalizar() {
  await preencherFormulario();
  const botao = localizarBotaoFinalizar()!;
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("decidirSaidaDoCheckout — falha de rede vira tentar_de_novo, não conferir_antes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("code vazio + message de TypeError de fetch (fetch nunca saiu do aparelho): tentar_de_novo, mensagem honesta", async () => {
    const { decidirSaidaDoCheckout } = await import(
      "@/views/customer/CheckoutView"
    );
    const r = decidirSaidaDoCheckout({
      code: "",
      message: "TypeError: Failed to fetch",
    });
    expect(r.acao).toBe("tentar_de_novo");
    expect(r.mensagem).toContain("não foi confirmado");
    expect(r.mensagem).toContain("não sai em dobro");
  });

  it("navigator.onLine === false (mesmo sem code nenhum): tentar_de_novo", async () => {
    const original = globalThis.navigator.onLine;
    Object.defineProperty(globalThis.navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      const { decidirSaidaDoCheckout } = await import(
        "@/views/customer/CheckoutView"
      );
      const r = decidirSaidaDoCheckout(new Error("qualquer coisa"));
      expect(r.acao).toBe("tentar_de_novo");
    } finally {
      Object.defineProperty(globalThis.navigator, "onLine", {
        value: original,
        configurable: true,
      });
    }
  });

  it("controle: P0001 com texto do banco NUNCA vira tentar_de_novo, nem com navigator.onLine mentindo", async () => {
    // A corrida entre a resposta chegar e o evento `offline` disparar não
    // pode apagar a prova de que o banco respondeu: se `code` é P0001 e há
    // `message`, o pedido definitivamente NÃO nasceu (RAISE reverte a
    // transação) e a regra já mapeia isso para uma ação própria — sobrepor
    // isso com "tentar de novo" reabriria o pedido em dobro que a regra
    // inteira existe para evitar.
    const original = globalThis.navigator.onLine;
    Object.defineProperty(globalThis.navigator, "onLine", {
      value: false,
      configurable: true,
    });
    try {
      const { decidirSaidaDoCheckout } = await import(
        "@/views/customer/CheckoutView"
      );
      const r = decidirSaidaDoCheckout({
        code: "P0001",
        message: "Estoque insuficiente para o produto Caneca",
      });
      expect(r.acao).toBe("ajustar_estoque");
    } finally {
      Object.defineProperty(globalThis.navigator, "onLine", {
        value: original,
        configurable: true,
      });
    }
  });

  it("controle: code vazio SEM assinatura de rede (mensagem qualquer, sem prefixo de exceção de fetch) continua conferir_antes", async () => {
    // Sem NENHUMA prova de rede (nem onLine false, nem o prefixo que só o
    // postgrest-js escreve quando o próprio fetch lança), o caso continua
    // sendo o desconhecido de sempre — virar "tentar de novo" à toa é o
    // defeito espelhado (duplicar pedido) que a regra evita do outro lado.
    const { decidirSaidaDoCheckout } = await import(
      "@/views/customer/CheckoutView"
    );
    const r = decidirSaidaDoCheckout({ code: "", message: "algo qualquer" });
    expect(r.acao).toBe("conferir_antes");
  });
});

describe("CheckoutView — sem rede não trava o botão nem manda conferir pedido inexistente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estadoDeRede.offline = false;
    createOrder.mockReset();
    clearCart.mockClear();
    toastError.mockReset();
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

  it("já offline ANTES do clique: o Finalizar fica desabilitado com aviso próprio, e nenhum pedido é tentado", async () => {
    estadoDeRede.offline = true;
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherFormulario();

    const botao = localizarBotaoFinalizar()!;
    expect(botao.disabled).toBe(true);
    expect(localizarAvisoDeRede()).not.toBeUndefined();

    // `HTMLElement.click()` em botão `disabled` não dispara o handler no
    // jsdom — clicar mesmo assim é a prova de que a trava impede a
    // tentativa, não só o desenho do botão.
    await act(async () => {
      botao.click();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("falha de rede DURANTE o clique (ainda reportado como online): o painel oferece tentar_de_novo, com mensagem honesta, e o Finalizar continua HABILITADO", async () => {
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

    // Confirma que caiu no ramo certo antes de julgar o botão — senão um
    // teste que sempre passa (porque o painel nem apareceu) passaria oco.
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      document.querySelector('button[data-acao="tentar_de_novo"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="aviso-como-destravar-finalizar"]'),
    ).toBeNull();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    expect(botaoFinalizar.disabled).toBe(false);
  });
});

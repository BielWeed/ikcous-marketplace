// @vitest-environment jsdom
//
// Falha de rede não é "você nunca comprou nada".
//
// Antes: o catch de `fetchUserOrders` só devolvia `[]` (e um aviso que some em
// segundos), então a aba "Meus Pedidos" desenhava "Nenhum pedido — Que tal
// começar a comprar?" para quem acabou de pagar um PIX num aparelho sem cache.
// A cliente achava que o pedido sumiu e pagava de novo ou chamava a loja.
//
// Este arquivo prende a TELA (OrderList): com `loadError` e nenhum pedido em
// memória, a lista diz que não conseguiu carregar e oferece "Tentar de novo";
// a lista vazia DE VERDADE continua dizendo "Nenhum pedido"; e com pedidos já
// em memória a falha vira só um aviso discreto, sem apagar nada. O lado do
// hook está em useorders-falha-de-carregamento-expoe-erro.test.tsx.
//
// Vermelho contra o HEAD: o OrderList antigo não conhece `loadError` — com
// este cenário renderizaria "Nenhum pedido" e a asserção de ausência cairia.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const pedido: Order = {
  id: "11111111-2222-3333-4444-555555555555",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "pending",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

const FALHA = "Não conseguimos carregar seus pedidos agora.";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — falha de carregamento não vira 'Nenhum pedido'", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function renderizar(
    props: Partial<{
      orders: Order[];
      isLoadingOrders: boolean;
      loadError: string | null;
      hasAnyOrders: boolean;
      emptyTitle: string;
      onRetry: () => void;
    }>,
  ) {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[]} onNavigate={() => {}} {...props} />);
    });
    return hospedeiro.textContent ?? "";
  }

  function botaoTentar() {
    return [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Tentar de novo"),
    ) as HTMLButtonElement | undefined;
  }

  it("sem pedido em memória e com erro: mensagem honesta + 'Tentar de novo', nunca 'Nenhum pedido'", async () => {
    const onRetry = vi.fn();
    const texto = await renderizar({ loadError: FALHA, onRetry });

    expect(texto).toContain("Não conseguimos carregar seus pedidos agora");
    expect(texto).not.toContain("Nenhum pedido");
    expect(texto).not.toContain("Que tal começar a comprar");

    const botao = botaoTentar();
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("a mensagem tranquiliza quem acabou de pagar: o pedido não sumiu", async () => {
    const texto = await renderizar({ loadError: FALHA, onRetry: () => {} });

    expect(texto).toContain("não sumiu");
  });

  it("lista vazia DE VERDADE (sem erro): 'Nenhum pedido' continua lá, sem botão", async () => {
    const texto = await renderizar({ loadError: null });

    expect(texto).toContain("Nenhum pedido");
    expect(texto).not.toContain("Não conseguimos carregar");
    expect(botaoTentar()).toBeUndefined();
  });

  it("primeira carga em andamento (sem erro): não mostra erro nem 'Nenhum pedido'", async () => {
    const texto = await renderizar({ isLoadingOrders: true, loadError: null });

    expect(texto).not.toContain("Não conseguimos carregar");
    expect(texto).not.toContain("Nenhum pedido");
  });

  it("releitura depois de falha: o botão FICA montado, 'Carregando…', sem 'Nenhum pedido' e sem novo clique", async () => {
    const onRetry = vi.fn();
    const texto = await renderizar({
      isLoadingOrders: true,
      loadError: FALHA,
      onRetry,
    });

    expect(texto).toContain("Não conseguimos carregar seus pedidos agora");
    expect(texto).not.toContain("Nenhum pedido");
    expect(texto).toContain("Carregando");
    expect(botaoTentar()).toBeUndefined();

    const botao = hospedeiro.querySelector("button") as HTMLButtonElement;
    expect(botao.getAttribute("aria-disabled")).toBe("true");
    // aria-disabled (não `disabled`) mantém o foco; o clique é ignorado.
    expect(botao.disabled).toBe(false);
    await act(async () => {
      botao.click();
    });
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("o foco de quem tocou em 'Tentar de novo' fica no mesmo botão durante a releitura", async () => {
    const onRetry = vi.fn();
    await renderizar({ loadError: FALHA, onRetry });
    const botao = botaoTentar()!;
    botao.focus();
    expect(document.activeElement).toBe(botao);

    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(
        <OrderList
          orders={[]}
          onNavigate={() => {}}
          loadError={FALHA}
          onRetry={onRetry}
          isLoadingOrders
        />,
      );
    });

    expect(botao.isConnected).toBe(true);
    expect(document.activeElement).toBe(botao);
  });

  it("sem internet: o conselho é verificar a conexão", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const texto = await renderizar({ loadError: FALHA, onRetry: () => {} });

    expect(texto).toContain("Verifique sua conexão e tente de novo.");
    expect(texto).not.toContain("Tente de novo em instantes");
  });

  it("com internet (5xx, sessão vencida): não acusa a conexão", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const texto = await renderizar({ loadError: FALHA, onRetry: () => {} });

    expect(texto).toContain("Tente de novo em instantes.");
    expect(texto).not.toContain("Verifique sua conexão");
    expect(texto).toContain("o pedido não sumiu");
  });

  it("com pedidos em memória e recarga falha: a lista fica e só aparece um aviso discreto", async () => {
    const onRetry = vi.fn();
    const texto = await renderizar({
      orders: [pedido],
      hasAnyOrders: true,
      loadError: FALHA,
      onRetry,
    });

    // A lista que já estava na tela NÃO some.
    expect(texto).toContain("Blusa Teste");
    // Nada de tela cheia de erro nem de lista vazia.
    expect(texto).not.toContain("Nenhum pedido");
    expect(texto).not.toContain("Não conseguimos carregar seus pedidos agora");
    // Aviso discreto, com a mesma saída.
    expect(texto).toContain("Não foi possível atualizar");
    const botao = botaoTentar();
    expect(botao).toBeDefined();
    await act(async () => {
      botao!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("aba filtrada vazia mas há pedidos em memória: não vira tela de erro", async () => {
    // A CartView passa só os pedidos da aba ("Em andamento") em `orders`, e o
    // total em memória em `hasAnyOrders` — aba sem pedidos NÃO é falha.
    const texto = await renderizar({
      orders: [],
      hasAnyOrders: true,
      loadError: FALHA,
      emptyTitle: "Sem pedidos ativos",
      onRetry: () => {},
    });

    expect(texto).toContain("Sem pedidos ativos");
    expect(texto).not.toContain("Não conseguimos carregar seus pedidos agora");
  });

  it("sem erro e com pedidos: nenhum aviso, nenhum botão", async () => {
    const texto = await renderizar({
      orders: [pedido],
      hasAnyOrders: true,
      loadError: null,
    });

    expect(texto).toContain("Blusa Teste");
    expect(texto).not.toContain("Não foi possível atualizar");
    expect(botaoTentar()).toBeUndefined();
  });
});

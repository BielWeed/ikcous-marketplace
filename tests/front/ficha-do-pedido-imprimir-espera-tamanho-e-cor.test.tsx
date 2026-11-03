// @vitest-environment jsdom
//
// Caça de bugs, rodada 4 (achado e8): se a lojista tocava em Imprimir enquanto
// o tamanho e a cor dos itens ainda carregavam — ou depois de a leitura falhar —
// o papel saía só com "2x Camiseta", sem "Tamanho M" nem "Cor Azul", e sem
// nenhum aviso. A tela avisava; o papel não. Agora o botão fica desligado
// nesses dois momentos, com o motivo escrito ao lado, e volta quando a leitura
// dá certo. Pedido sem variação, ou com variação apagada do catálogo (leitura
// que deu certo e não achou), imprime como sempre.
//
// Molde: ficha-do-pedido-mostra-variacao.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { variacoesNoBanco, falhas, segurar } = vi.hoisted(() => ({
  falhas: { product_variants: false, vw_produtos_admin: false },
  variacoesNoBanco: [] as Array<{ id: string; name: string; value: string }>,
  // Liga a espera: a consulta de variações só responde quando o teste soltar.
  segurar: {
    ligado: false,
    soltar: [] as Array<() => void>,
  },
}));

vi.mock("@/lib/supabase", () => {
  function construtorDa(tabela: string) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn((_coluna: string, ids: string[]) => {
      const resposta = () =>
        falhas[tabela as keyof typeof falhas]
          ? { data: null, error: { message: "falha de rede" } }
          : {
              data:
                tabela === "product_variants"
                  ? variacoesNoBanco.filter((v) => ids.includes(v.id))
                  : [],
              error: null,
            };
      if (segurar.ligado && tabela === "product_variants") {
        return new Promise((resolver) => {
          segurar.soltar.push(() => resolver(resposta()));
        });
      }
      return Promise.resolve(resposta());
    });
    builder.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: null, error: null }),
    );
    builder.update = vi.fn(() => builder);
    return builder;
  }
  return {
    supabase: {
      from: vi.fn((tabela: string) => construtorDa(tabela)),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() },
      channel: vi.fn(),
      removeChannel: vi.fn(),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type ItemDoPedido = Order["items"][number];

function item(overrides: Partial<ItemDoPedido> = {}): ItemDoPedido {
  return {
    productId: "prod-camiseta",
    name: "Camiseta Básica",
    price: 50,
    quantity: 1,
    image: "",
    ...overrides,
  };
}

function pedidoFake(items: ItemDoPedido[]): Order {
  const subtotal = items.reduce((acc, i) => acc + i.price * i.quantity, 0);
  return {
    id: "ped-imprimir-123456",
    customer: {
      name: "Cliente Teste",
      whatsapp: "349998888777",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items,
    subtotal,
    shipping: 0,
    discount: 0,
    total: subtotal,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    pagamentoRecebidoPor: null,
  };
}

describe("ficha do pedido — Imprimir espera o tamanho e a cor chegarem", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    variacoesNoBanco.length = 0;
    falhas.product_variants = false;
    falhas.vw_produtos_admin = false;
    segurar.ligado = false;
    segurar.soltar.length = 0;
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

  async function assentar() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function renderizarFicha(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
    await assentar();
  }

  const botaoImprimir = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Imprimir Pedido"]',
    );
  const motivo = () => hospedeiro.querySelector("header")?.textContent ?? "";
  const botaoTentar = () =>
    Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes("Tentar de novo"),
    );

  it("leitura da variação falhou: Imprimir fica desligado e diz por quê", async () => {
    falhas.product_variants = true;
    variacoesNoBanco.push({
      id: "var-imp-falha-1",
      name: "Tamanho",
      value: "M",
    });

    await renderizarFicha(pedidoFake([item({ variantId: "var-imp-falha-1" })]));

    expect(botaoImprimir()).not.toBeNull();
    expect(botaoImprimir()?.disabled).toBe(true);
    expect(motivo()).toContain("tamanho e a cor dos itens");
    expect(botaoImprimir()?.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("enquanto a leitura demora: desligado; quando chega, liga e o papel leva o tamanho", async () => {
    segurar.ligado = true;
    variacoesNoBanco.push({
      id: "var-imp-espera-2",
      name: "Tamanho",
      value: "G",
    });

    await renderizarFicha(
      pedidoFake([item({ variantId: "var-imp-espera-2" })]),
    );

    expect(botaoImprimir()?.disabled).toBe(true);
    expect(motivo()).toContain("tamanho e a cor dos itens");

    await act(async () => {
      for (const soltar of segurar.soltar) soltar();
    });
    await assentar();

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(motivo()).not.toContain("tamanho e a cor dos itens");
    expect(hospedeiro.textContent).toContain("Tamanho G");
  });

  it("depois do 'Tentar de novo' bem-sucedido, Imprimir volta", async () => {
    falhas.product_variants = true;
    variacoesNoBanco.push({
      id: "var-imp-tentar-3",
      name: "Cor",
      value: "Azul",
    });

    await renderizarFicha(
      pedidoFake([item({ variantId: "var-imp-tentar-3" })]),
    );
    expect(botaoImprimir()?.disabled).toBe(true);

    falhas.product_variants = false;
    await act(async () => {
      botaoTentar()?.click();
    });
    await assentar();

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(motivo()).not.toContain("tamanho e a cor dos itens");
  });

  it("clicar no botão desligado não abre a impressão", async () => {
    const imprimir = vi.fn();
    vi.stubGlobal("print", imprimir);
    falhas.product_variants = true;

    await renderizarFicha(pedidoFake([item({ variantId: "var-imp-click-4" })]));
    await act(async () => {
      botaoImprimir()?.click();
    });

    expect(imprimir).not.toHaveBeenCalled();
  });

  it("CONTROLE: leitura ok -> Imprimir ligado e sem aviso", async () => {
    variacoesNoBanco.push({ id: "var-imp-ok-5", name: "Tamanho", value: "P" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-imp-ok-5" })]));

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(motivo()).not.toContain("tamanho e a cor dos itens");
  });

  it("BORDA: variação apagada do catálogo (leitura deu certo e não achou) imprime como sempre", async () => {
    await renderizarFicha(
      pedidoFake([item({ variantId: "var-imp-apagada-6" })]),
    );

    expect(botaoImprimir()?.disabled).toBe(false);
  });

  it("BORDA: falha só no código do produto e nenhum item com variação -> o papel não perde nada, Imprimir ligado", async () => {
    falhas.vw_produtos_admin = true;

    await renderizarFicha(
      pedidoFake([item({ productId: "prod-imp-sem-var-7" })]),
    );

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(motivo()).not.toContain("tamanho e a cor dos itens");
  });

  it("BORDA: pedido sem nenhum item com variação, leitura em andamento -> Imprimir ligado", async () => {
    segurar.ligado = true;

    await renderizarFicha(
      pedidoFake([item({ productId: "prod-imp-sem-var-8" })]),
    );

    expect(botaoImprimir()?.disabled).toBe(false);
  });
});

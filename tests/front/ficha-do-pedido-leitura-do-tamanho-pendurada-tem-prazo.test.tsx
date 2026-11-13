// @vitest-environment jsdom
//
// Rede "pendurada" (conecta e não responde) na leitura do tamanho e da cor dos
// itens da ficha do pedido. O botão Imprimir espera essa leitura ("Carregando
// o tamanho e a cor dos itens…") e a consulta não tinha prazo: o botão ficava
// desligado para sempre, sem aviso e sem "Tentar de novo". Contrato provado
// aqui (fake timers + promessa que não resolve):
//   - passou o prazo -> aviso na ficha, Imprimir desligado com o motivo e o
//     botão "Tentar de novo" (o papel nunca sai sem o tamanho e a cor);
//   - o prazo cobre as DUAS consultas (código do produto e variações);
//   - "Tentar de novo" repete a leitura e a resposta tardia da tentativa
//     anterior é descartada;
//   - resposta dentro do prazo não vira erro (controle).
//
// Molde: ficha-do-pedido-imprimir-espera-tamanho-e-cor.test.tsx.
import { PRAZO_DA_LEITURA_DO_TAMANHO_E_COR_MS } from "@/lib/prazo-da-requisicao";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Variacao = { id: string; name: string; value: string };

const { rede } = vi.hoisted(() => ({
  rede: {
    // "pendurado" = a consulta só responde quando o teste soltar.
    modo: {
      product_variants: "ok" as "ok" | "pendurado",
      vw_produtos_admin: "ok" as "ok" | "pendurado",
    },
    banco: [] as Array<{ id: string; name: string; value: string }>,
    soltar: [] as Array<() => void>,
  },
}));

vi.mock("@/lib/supabase", () => {
  function construtorDa(tabela: string) {
    const builder: Record<string, unknown> = {};
    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn(() => builder);
    builder.in = vi.fn((_coluna: string, ids: string[]) => {
      // O estado do banco é fotografado na hora da chamada: uma resposta
      // tardia leva o que o banco dizia quando ela partiu.
      const data =
        tabela === "product_variants"
          ? rede.banco.filter((v) => ids.includes(v.id)).map((v) => ({ ...v }))
          : [];
      const modo =
        tabela === "product_variants"
          ? rede.modo.product_variants
          : rede.modo.vw_produtos_admin;
      if (modo === "pendurado") {
        return new Promise((resolver) => {
          rede.soltar.push(() => resolver({ data, error: null }));
        });
      }
      return Promise.resolve({ data, error: null });
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
    id: "ped-prazo-123456",
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

describe("ficha do pedido — a leitura do tamanho e da cor tem prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    rede.banco.length = 0;
    rede.modo.product_variants = "ok";
    rede.modo.vw_produtos_admin = "ok";
    rede.soltar.length = 0;
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
    vi.useRealTimers();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function renderizarFicha(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
    await avancar(0);
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
  const aviso = () => hospedeiro.querySelector('[role="alert"]');

  function noBanco(...v: Variacao[]) {
    rede.banco.push(...v);
  }

  it("variações penduradas: passou o prazo, o aviso e o 'Tentar de novo' aparecem e Imprimir segue desligado", async () => {
    rede.modo.product_variants = "pendurado";
    noBanco({ id: "var-prazo-1", name: "Tamanho", value: "M" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-prazo-1" })]));

    // Antes do prazo: ainda carregando, sem aviso e sem botão de repetir.
    await avancar(PRAZO_DA_LEITURA_DO_TAMANHO_E_COR_MS - 1_000);
    expect(botaoImprimir()?.disabled).toBe(true);
    expect(motivo()).toContain("Carregando o tamanho e a cor");
    expect(botaoTentar()).toBeUndefined();

    await avancar(1_500);

    expect(aviso()?.textContent).toContain("Não deu para carregar tamanho");
    expect(botaoTentar()).toBeDefined();
    expect(botaoImprimir()?.disabled).toBe(true);
    expect(motivo()).toContain("Tentar de novo");
    expect(motivo()).not.toContain("Carregando o tamanho e a cor");
  });

  it("código do produto pendurado: o prazo também cobre a primeira consulta", async () => {
    rede.modo.vw_produtos_admin = "pendurado";

    await renderizarFicha(
      pedidoFake([item({ productId: "prod-prazo-sem-var-2" })]),
    );
    await avancar(PRAZO_DA_LEITURA_DO_TAMANHO_E_COR_MS + 500);

    expect(aviso()?.textContent).toContain("Não deu para carregar tamanho");
    expect(botaoTentar()).toBeDefined();
  });

  it("'Tentar de novo' repete a leitura; a resposta tardia da tentativa velha é descartada", async () => {
    rede.modo.product_variants = "pendurado";
    noBanco({ id: "var-prazo-3", name: "Tamanho", value: "P" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-prazo-3" })]));
    await avancar(PRAZO_DA_LEITURA_DO_TAMANHO_E_COR_MS + 500);
    expect(botaoTentar()).toBeDefined();

    // A segunda tentativa responde na hora, com o nome já corrigido.
    rede.banco.length = 0;
    noBanco({ id: "var-prazo-3", name: "Tamanho", value: "G" });
    rede.modo.product_variants = "ok";
    await act(async () => {
      botaoTentar()?.click();
    });
    await avancar(0);

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(aviso()).toBeNull();
    expect(hospedeiro.textContent).toContain("Tamanho G");

    // A primeira tentativa (abandonada) responde só agora, com o nome velho.
    await act(async () => {
      for (const soltar of rede.soltar) soltar();
    });
    await avancar(0);

    expect(hospedeiro.textContent).toContain("Tamanho G");
    expect(hospedeiro.textContent).not.toContain("Tamanho P");
    expect(botaoImprimir()?.disabled).toBe(false);
  });

  it("CONTROLE: resposta dentro do prazo não vira aviso e o prazo não dispara depois", async () => {
    noBanco({ id: "var-prazo-4", name: "Cor", value: "Azul" });

    await renderizarFicha(pedidoFake([item({ variantId: "var-prazo-4" })]));
    await avancar(PRAZO_DA_LEITURA_DO_TAMANHO_E_COR_MS + 5_000);

    expect(botaoImprimir()?.disabled).toBe(false);
    expect(aviso()).toBeNull();
    expect(botaoTentar()).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Cor Azul");
  });
});

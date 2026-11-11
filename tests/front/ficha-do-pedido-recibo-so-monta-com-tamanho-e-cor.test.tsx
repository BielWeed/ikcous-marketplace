// @vitest-environment jsdom
// O Ctrl+P não pode recuperar um recibo incompleto enquanto a variação falta.
// Molde: ficha-do-pedido-imprimir-espera-tamanho-e-cor.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { consulta } = vi.hoisted(() => ({
  consulta: {
    pendente: false,
    falha: false,
    soltar: [] as Array<() => void>,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn(() => builder);
      builder.in = vi.fn((_coluna: string, ids: string[]) => {
        const resposta = () =>
          tabela === "product_variants" && consulta.falha
            ? { data: null, error: { message: "falha de rede" } }
            : {
                data:
                  tabela === "product_variants"
                    ? [
                        { id: "var-tamanho", name: "Tamanho", value: "M" },
                        { id: "var-cor", name: "Cor", value: "Azul" },
                      ].filter((v) => ids.includes(v.id))
                    : [],
                error: null,
              };
        if (tabela === "product_variants" && consulta.pendente) {
          return new Promise((resolver) => {
            consulta.soltar.push(() => resolver(resposta()));
          });
        }
        return Promise.resolve(resposta());
      });
      builder.maybeSingle = vi.fn(() =>
        Promise.resolve({ data: null, error: null }),
      );
      builder.update = vi.fn(() => builder);
      return builder;
    }),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pedido(): Order {
  return {
    id: "ped-recibo-123456",
    customer: { name: "Cliente Teste", whatsapp: "", address: "Rua Fictícia" },
    items: [
      {
        productId: "prod-camiseta",
        name: "Camiseta",
        price: 50,
        quantity: 1,
        image: "",
        variantId: "var-tamanho",
      },
      {
        productId: "prod-bone",
        name: "Boné",
        price: 50,
        quantity: 1,
        image: "",
        variantId: "var-cor",
      },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: "2026-09-01T14:32:00.000Z",
    updatedAt: "2026-09-01T14:32:00.000Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — recibo só monta com tamanho e cor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    consulta.pendente = false;
    consulta.falha = false;
    consulta.soltar.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function assentar() {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }

  async function renderizar() {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={pedido()} onStatusChange={vi.fn()} />);
    });
    await assentar();
  }

  const papel = () => document.body.querySelector("[data-tema-fixo]");
  const imprimir = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Imprimir Pedido"]',
    );

  function conferirPapelCompleto() {
    expect(papel()).not.toBeNull();
    expect(papel()?.textContent).toContain("Tamanho M");
    expect(papel()?.textContent).toContain("Cor Azul");
  }

  it("consulta pendente: nenhum recibo imprimível no DOM", async () => {
    consulta.pendente = true;
    await renderizar();

    expect(consulta.soltar.length).toBeGreaterThan(0);
    expect(imprimir()?.disabled).toBe(true);
    expect(papel()).toBeNull();
  });

  it("consulta falhou: nenhum recibo imprimível no DOM", async () => {
    consulta.falha = true;
    await renderizar();

    expect(imprimir()?.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain("Tentar de novo");
    expect(papel()).toBeNull();
  });

  it("consulta concluída: o recibo aparece com tamanho e cor", async () => {
    consulta.pendente = true;
    await renderizar();

    await act(async () => {
      for (const soltar of consulta.soltar) soltar();
    });
    await assentar();

    expect(imprimir()?.disabled).toBe(false);
    conferirPapelCompleto();
  });

  it("tentar de novo com sucesso: o recibo aparece com tamanho e cor", async () => {
    consulta.falha = true;
    await renderizar();

    consulta.falha = false;
    const tentar = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ).find((botao) => botao.textContent?.includes("Tentar de novo"));
    expect(tentar).toBeDefined();
    await act(async () => tentar?.click());
    await assentar();

    expect(imprimir()?.disabled).toBe(false);
    conferirPapelCompleto();
  });
});

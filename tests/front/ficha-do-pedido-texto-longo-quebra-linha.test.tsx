// @vitest-environment jsdom
//
// Ficha do pedido no painel: observação da cliente, anotação da equipe e
// endereço com um link ou uma palavra comprida (150 letras sem espaço) saíam
// cortados, porque o painel esconde o que passa da largura (`overflow-x-hidden`
// no AdminLayout). Agora esses textos quebram a linha (`break-words`) e as
// quebras digitadas (`whitespace-pre-line`) continuam valendo.
//
// jsdom não calcula layout: a prova é a classe de quebra no elemento que
// carrega o texto. A conferência da largura real fica para o navegador.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LINK_COMPRIDO = `https://exemplo.com/${"a".repeat(150)}`;
const NOTA_DA_EQUIPE = `Combinado: ${"b".repeat(150)}`;

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((tabela: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({
              data:
                tabela === "marketplace_order_internal_notes"
                  ? { note: NOTA_DA_EQUIPE }
                  : null,
              error: null,
            }),
          ),
        })),
      })),
    })),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(): Order {
  return {
    id: "ped-texto-longo",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: `Rua ${"c".repeat(150)}`,
      number: "123",
      complement: `Bloco ${"d".repeat(150)}`,
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
      reference: `Perto de ${"e".repeat(150)}`,
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    notes: `Entregar na portaria.\n${LINK_COMPRIDO}`,
  } as Order;
}

describe("OrderDetail: texto comprido quebra a linha em vez de ser cortado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={pedido()} onStatusChange={vi.fn()} />);
    });
    // a anotação da equipe chega depois, de uma leitura assíncrona
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  const paragrafoCom = (trecho: string) =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      p.textContent?.includes(trecho),
    );

  it("observação da cliente: quebra o link e guarda as quebras de linha digitadas", () => {
    const p = paragrafoCom(LINK_COMPRIDO);
    expect(p).toBeDefined();
    expect(p?.className).toContain("break-words");
    expect(p?.className).toContain("whitespace-pre-line");
  });

  it("anotação da equipe: quebra o texto comprido", () => {
    const p = paragrafoCom(NOTA_DA_EQUIPE);
    expect(p).toBeDefined();
    expect(p?.className).toContain("break-words");
    expect(p?.className).toContain("whitespace-pre-line");
  });

  it("endereço, complemento e referência: o bloco inteiro quebra a linha", () => {
    const p = paragrafoCom(`Bloco ${"d".repeat(150)}`);
    expect(p).toBeDefined();
    expect(p?.textContent).toContain(`Ref: Perto de ${"e".repeat(150)}`);
    expect(p?.className).toContain("break-words");
  });
});

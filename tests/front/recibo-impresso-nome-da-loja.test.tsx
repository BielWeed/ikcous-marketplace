// @vitest-environment jsdom
//
// A-3 do laudo de varredura profunda (01/09): o recibo IMPRESSO — o único
// documento que sai no papel e vai para a mão da cliente — saía com o nome
// do MOLDE (`branding.appName`, fixo do build), não o nome da loja que a
// lojista configurou. A vitrine inteira diz "Ateliê da Maria" e o papel
// dizia "IKCOUS". O comentário antigo do componente admitia a dívida
// (importar StoreContext aqui quebrava o jsdom) — o conserto é a PROP
// `storeName`, vinda do ancestral que já pode ler `config.storeName`
// (AdminOrdersView -> OrderDetail -> OrderReceipt), com o fallback para o
// branding preservado quando ninguém passa nada.
//
// Sem @testing-library/react (não instalado) — createRoot + act, mesmo
// padrão de recibo-impresso-mostra-o-desconto.test.tsx e
// order-detail-nao-inventa-cidade.test.tsx.
import { branding } from "@/config/branding";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const NOME_DA_LOJA = "Ateliê da Maria";

function pedidoBase(): Order {
  return {
    id: "pedido-1234567890",
    customer: {
      name: "Maria Teste",
      whatsapp: "11999999999",
      address: "Rua das Flores",
      number: "100",
      neighborhood: "Centro",
    },
    // Sem itens: o cabeçalho do recibo (onde mora o nome da loja) não depende
    // deles, e LazyImage (IntersectionObserver) nem monta — jsdom deste
    // projeto não traz os observers (mesma razão dos testes de ficha que
    // usam `items: []`).
    items: [],
    subtotal: 100,
    shipping: 15,
    discount: 0,
    total: 115,
    paymentMethod: "pix",
    status: "pending",
    createdAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    updatedAt: new Date("2026-08-20T10:00:00Z").toISOString(),
    cancelledAfterShipping: false,
  };
}

describe("OrderReceipt — o recibo impresso sai com o nome da LOJA", () => {
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
  });

  it("com a prop storeName, o papel mostra o nome da loja (não o do molde)", async () => {
    const { OrderReceipt } = await import(
      "@/components/admin/orders/OrderReceipt"
    );

    await act(async () => {
      raiz.render(
        <OrderReceipt order={pedidoBase()} storeName={NOME_DA_LOJA} />,
      );
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(NOME_DA_LOJA);
    // Sinal NOMINAL: o nome do molde NÃO pode estar na folha — "também tem
    // o nome certo em algum lugar" não serve quando o papel é impresso.
    expect(texto).not.toContain(branding.appName);
  });

  it("sem a prop, o fallback é o branding do build (quem montava antes não quebra)", async () => {
    const { OrderReceipt } = await import(
      "@/components/admin/orders/OrderReceipt"
    );

    await act(async () => {
      raiz.render(<OrderReceipt order={pedidoBase()} />);
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(branding.appName);
  });

  it("OrderDetail repassa a prop storeName até o recibo (a cadeia não quebra no meio)", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );

    await act(async () => {
      raiz.render(
        <OrderDetail
          order={pedidoBase()}
          onStatusChange={vi.fn()}
          storeName={NOME_DA_LOJA}
        />,
      );
    });

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(NOME_DA_LOJA);
  });
});

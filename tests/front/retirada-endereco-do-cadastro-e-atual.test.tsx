// @vitest-environment jsdom
//
// RETIRADA NA LOJA DE QUEM TEM CONTA. O banco não copia o endereço de casa para
// o pedido de retirada (migration 20261399997000 pula `store-pickup`), mas
// guarda o `address_id`: o mapper cai no JOIN `user_addresses`, que é o
// cadastro de HOJE. A ficha não pode apresentar esse endereço como se fosse o
// da compra — ele aparece rotulado "Endereço do cadastro (atual)" — e o recibo
// de retirada não o imprime (retirada não precisa de endereço de casa no
// papel). Sem endereço nenhum (apagado ou nunca informado), a ficha diz só
// "Cliente retira na loja." — sem afirmar que a cliente não informou.
// Entrega e pedido com cópia do endereço ficam como eram.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Address, Order } from "@/types";

const ENDERECO_DA_LOJA = "Rua Fictícia da Loja, 100 — Centro";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Passa = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: Passa,
    AlertDialogHeader: Passa,
    AlertDialogFooter: Passa,
    AlertDialogTitle: Passa,
    AlertDialogDescription: Passa,
    AlertDialogAction: Passa,
    AlertDialogCancel: Passa,
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O cadastro ATUAL da cliente (JOIN user_addresses), dado inventado.
const CADASTRO_DE_HOJE: Address = {
  id: "endereco-1",
  user_id: "cliente-1",
  name: "Casa",
  recipient_name: "",
  cep: "38500-000",
  street: "Rua do Cadastro Novo",
  number: "42",
  complement: null,
  neighborhood: "Bairro Inventado",
  city: "Cidade Teste",
  state: "MG",
  reference: null,
  is_default: true,
};

// A cópia do endereço gravada no pedido NO INSTANTE da compra.
const COPIA_DA_COMPRA = {
  street: "Rua da Compra",
  number: "7",
  neighborhood: "Bairro da Compra",
  city: "Cidade Teste",
  state: "MG",
  cep: "38500-111",
};

function linhaDoBanco(
  customerData: Record<string, unknown>,
  address: Address | null,
) {
  return {
    id: "pedido-retirada-com-conta",
    user_id: "cliente-1",
    customer_name: "Cliente Teste",
    customer_data: customerData,
    total: 120,
    subtotal: 120,
    shipping: 0,
    discount: 0,
    payment_method: "cash",
    payment_status: null,
    status: "pending",
    notes: null,
    coupon_code: null,
    tracking_code: null,
    canal: "online",
    vendedor_id: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address,
  };
}

async function mapear(
  customerData: Record<string, unknown>,
  address: Address | null,
): Promise<Order> {
  const { mapOrderFromDB } = await import("@/lib/mappers");
  return mapOrderFromDB(linhaDoBanco(customerData, address) as never);
}

const CLIENTE = { name: "Cliente Teste", whatsapp: "34999999999" };

describe("retirada de quem tem conta: o endereço do cadastro é o de hoje", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
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

  async function montarFicha(pedido: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
    return hospedeiro.textContent ?? "";
  }

  async function montarRecibo(pedido: Order) {
    const { OrderReceipt } = await import(
      "@/components/admin/orders/OrderReceipt"
    );
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} storeName="Loja Teste" />);
    });
    // O recibo é desenhado direto no body (portal), fora do hospedeiro.
    return document.body.textContent ?? "";
  }

  it("ficha: retirada sem cópia mostra o endereço do cadastro rotulado como atual", async () => {
    const texto = await montarFicha(
      await mapear(
        { ...CLIENTE, pickup_address: ENDERECO_DA_LOJA },
        CADASTRO_DE_HOJE,
      ),
    );
    expect(texto).toContain("Endereço do cadastro (atual)");
    expect(texto).not.toContain("Endereço do cliente");
    expect(texto).toContain("Rua do Cadastro Novo");
  });

  it("ficha: retirada com o endereço apagado diz só 'Cliente retira na loja.', sem afirmar que não informou", async () => {
    const texto = await montarFicha(
      await mapear({ ...CLIENTE, pickup_address: ENDERECO_DA_LOJA }, null),
    );
    expect(texto).toContain("Cliente retira na loja.");
    expect(texto).not.toContain("não informou");
    expect(texto).not.toContain("Endereço do cadastro (atual)");
  });

  it("controle: retirada COM cópia do endereço no pedido continua 'Endereço do cliente'", async () => {
    const texto = await montarFicha(
      await mapear(
        {
          ...CLIENTE,
          address: COPIA_DA_COMPRA,
          pickup_address: ENDERECO_DA_LOJA,
        },
        CADASTRO_DE_HOJE,
      ),
    );
    expect(texto).toContain("Endereço do cliente");
    expect(texto).toContain("Rua da Compra");
    expect(texto).not.toContain("(atual)");
  });

  it("controle: entrega com cópia fica igual — 'Endereço de entrega' com a cópia da compra", async () => {
    const texto = await montarFicha(
      await mapear({ ...CLIENTE, address: COPIA_DA_COMPRA }, CADASTRO_DE_HOJE),
    );
    expect(texto).toContain("Endereço de entrega");
    expect(texto).toContain("Rua da Compra");
    expect(texto).not.toContain("(atual)");
    expect(texto).not.toContain("Rua do Cadastro Novo");
  });

  it("controle: entrega SEM cópia (pedido antigo) continua usando o cadastro, sem rótulo novo", async () => {
    const texto = await montarFicha(await mapear(CLIENTE, CADASTRO_DE_HOJE));
    expect(texto).toContain("Endereço de entrega");
    expect(texto).toContain("Rua do Cadastro Novo");
    expect(texto).not.toContain("(atual)");
  });

  it("recibo: retirada sem cópia não imprime o endereço de casa do cadastro, mas mantém o da loja", async () => {
    const texto = await montarRecibo(
      await mapear(
        { ...CLIENTE, pickup_address: ENDERECO_DA_LOJA },
        CADASTRO_DE_HOJE,
      ),
    );
    expect(texto).toContain("RETIRADA NA LOJA:");
    expect(texto).toContain(ENDERECO_DA_LOJA);
    expect(texto).toContain("Cliente Teste");
    expect(texto).not.toContain("Rua do Cadastro Novo");
    expect(texto).not.toContain("Bairro Inventado");
    expect(texto).not.toContain("38500-000");
  });

  it("controle: recibo de retirada COM cópia continua imprimindo o endereço da compra", async () => {
    const texto = await montarRecibo(
      await mapear(
        {
          ...CLIENTE,
          address: COPIA_DA_COMPRA,
          pickup_address: ENDERECO_DA_LOJA,
        },
        CADASTRO_DE_HOJE,
      ),
    );
    expect(texto).toContain("Rua da Compra");
    expect(texto).toContain(ENDERECO_DA_LOJA);
  });
});

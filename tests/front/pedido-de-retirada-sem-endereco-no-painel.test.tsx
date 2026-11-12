// @vitest-environment jsdom
//
// RETIRADA SEM ENDEREÇO DE CASA NO PAINEL. O visitante que RETIRA na loja é
// gravado sem rua/número/bairro/cidade/UF (só CEP, nome e WhatsApp). A ficha
// do pedido não pode desenhar um bloco "Endereço do cliente" vazio, nem um
// "Copiar endereço" que copia nada e comemora, nem um "Ver no Maps" sem
// destino. Quem tem QUALQUER parte do endereço, e toda entrega, fica como era.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ENDERECO_DA_LOJA = "Rua Fictícia de Teste, 100 — Centro";

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

import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DADOS_DO_VISITANTE = {
  name: "Visitante Teste",
  whatsapp: "34999999999",
  cep: "38500-000",
};

function linhaDoBanco(customerData: Record<string, unknown>) {
  return {
    id: "pedido-retirada-sem-endereco",
    user_id: null,
    customer_name: "Visitante Teste",
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
  };
}

async function mapear(customerData: Record<string, unknown>): Promise<Order> {
  const { mapOrderFromDB } = await import("@/lib/mappers");
  return mapOrderFromDB(linhaDoBanco(customerData) as never);
}

describe("ficha do lojista — retirada sem endereço de casa", () => {
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

  async function montar(pedido: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
  }

  const botaoCopiar = () =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Copiar Endereço",
    );
  const linkDoMaps = () =>
    hospedeiro.querySelector('a[title="Ver no Google Maps"]');

  it("visitante em retirada sem rua/bairro/cidade: diz que não informou endereço e mostra o CEP, sem Copiar nem Maps", async () => {
    await montar(
      await mapear({ ...DADOS_DO_VISITANTE, pickup_address: ENDERECO_DA_LOJA }),
    );
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(
      "Cliente retira na loja — não informou endereço de casa",
    );
    expect(texto).toContain("CEP: 38500-000");
    expect(texto).not.toContain("Endereço do cliente");
    expect(botaoCopiar()).toBeUndefined();
    expect(linkDoMaps()).toBeNull();
    // O endereço da LOJA, onde ela busca, continua na ficha.
    expect(
      hospedeiro.querySelector('[aria-label="Retirada na loja"]')?.textContent,
    ).toContain(ENDERECO_DA_LOJA);
  });

  it("sem CEP também: só a linha curta, sem rótulo 'CEP:' solto", async () => {
    await montar(
      await mapear({
        name: "Visitante Teste",
        whatsapp: "34999999999",
        pickup_address: ENDERECO_DA_LOJA,
      }),
    );
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("não informou endereço de casa");
    expect(texto).not.toContain("CEP:");
    expect(botaoCopiar()).toBeUndefined();
    expect(linkDoMaps()).toBeNull();
  });

  it("rua, bairro e cidade só com espaços contam como vazios", async () => {
    await montar(
      await mapear({
        ...DADOS_DO_VISITANTE,
        address: { street: "  ", neighborhood: " ", city: "  " },
        pickup_address: ENDERECO_DA_LOJA,
      }),
    );
    expect(hospedeiro.textContent).toContain("não informou endereço de casa");
    expect(botaoCopiar()).toBeUndefined();
  });

  it("controle: retirada de quem TEM endereço continua com o bloco, o Copiar e o Maps", async () => {
    await montar(
      await mapear({
        address: {
          street: "Rua da Cliente",
          number: "7",
          neighborhood: "Bairro Teste",
          city: "Cidade Teste",
          state: "MG",
          cep: "38500-000",
        },
        pickup_address: ENDERECO_DA_LOJA,
      }),
    );
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Endereço do cliente");
    expect(texto).toContain("Rua da Cliente");
    expect(texto).not.toContain("não informou endereço de casa");
    expect(botaoCopiar()).toBeDefined();
    expect(linkDoMaps()).not.toBeNull();
  });

  it("controle: retirada com SÓ o bairro (qualquer parte do endereço) mantém o bloco de hoje", async () => {
    await montar(
      await mapear({
        ...DADOS_DO_VISITANTE,
        neighborhood: "Bairro Teste",
        pickup_address: ENDERECO_DA_LOJA,
      }),
    );
    expect(hospedeiro.textContent).toContain("Endereço do cliente");
    expect(hospedeiro.textContent).not.toContain(
      "não informou endereço de casa",
    );
    expect(botaoCopiar()).toBeDefined();
  });

  it("controle: entrega continua igual, com Copiar e Maps", async () => {
    await montar(
      await mapear({
        address: {
          street: "Rua da Cliente",
          number: "7",
          neighborhood: "Bairro Teste",
          city: "Cidade Teste",
          state: "MG",
          cep: "38500-000",
        },
      }),
    );
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Endereço de entrega");
    expect(texto).not.toContain("não informou endereço de casa");
    expect(botaoCopiar()).toBeDefined();
    expect(linkDoMaps()).not.toBeNull();
  });

  it("controle: recibo impresso da retirada sem endereço não leva lixo (undefined, vírgula solta, linha vazia)", async () => {
    const { OrderReceipt } = await import(
      "@/components/admin/orders/OrderReceipt"
    );
    const pedido = await mapear({
      ...DADOS_DO_VISITANTE,
      pickup_address: ENDERECO_DA_LOJA,
    });
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} storeName="Loja Teste" />);
    });
    // O recibo é desenhado direto no body (portal), fora do hospedeiro.
    const texto = document.body.textContent ?? "";
    expect(texto).toContain("RETIRADA NA LOJA:");
    expect(texto).toContain("CEP: 38500-000");
    expect(texto).not.toMatch(/undefined|null|,\s*,|•\s*•/);
  });

  it("copiar com endereço vazio (entrega com campos em branco) não copia nem comemora", async () => {
    const escrever = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText: escrever },
      configurable: true,
    });
    try {
      await montar(
        await mapear({
          address: { street: "  ", neighborhood: " ", city: "", cep: "" },
        }),
      );
      const botao = botaoCopiar();
      expect(botao).toBeDefined();
      await act(async () => {
        botao?.click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(escrever).not.toHaveBeenCalled();
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        "Este pedido não tem endereço para copiar.",
      );
      expect(botaoCopiar()?.textContent).not.toContain("Copiado");
    } finally {
      Reflect.deleteProperty(window.navigator, "clipboard");
    }
  });
});

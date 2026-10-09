// @vitest-environment jsdom
//
// Anular venda do balcão (migration 20261204000000) na tela Vender: o botão
// mora no RECIBO, anula o pedido que acabou de ser gravado e, depois, o recibo
// deixa de parecer comprovante de compra. E a retentativa de uma venda que já
// foi gravada e depois ANULADA não mostra um recibo de compra que não vale.
//
// Molde: venda-presencial-fechamento.test.tsx (a view real, a máquina real de
// `useVendaPresencial`, as seções reais; só a rede e o leitor são dublês).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, registrarImplRef, anularImplRef } = vi.hoisted(
  () => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    registrarImplRef: {
      atual: null as
        | ((params: any) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
    anularImplRef: {
      atual: null as
        | ((params: any) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: rpcMock, functions: { invoke: invokeMock } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() => aoLer({ codigo: "78912345", formato: "ean_13" })}
      >
        bipar
      </button>
    ) : null,
}));

import { AdminPdvView } from "@/views/admin/AdminPdvView";

const PRODUTO = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

const ID = "11111111-1111-1111-1111-111111111111";

function respostaDaVenda(extra: Record<string, unknown> = {}, ja = false) {
  return {
    data: {
      ja_existia: ja,
      order: {
        id: ID,
        created_at: "2026-10-08T14:00:00.000Z",
        total: 39.9,
        subtotal: 39.9,
        discount: 0,
        payment_method: "cash" as const,
        user_id: null,
        customer_name: "Venda no balcão",
        customer_data: null,
        status: "delivered",
        ...extra,
      },
      items: [
        {
          id: "item-1",
          product_id: "produto-1",
          variant_id: null,
          quantity: 1,
          price: 39.9,
          product_name: "Camiseta Lisa",
        },
      ],
    },
    error: null,
  };
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function avancar(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("tela Vender — anular a venda pelo recibo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "buscar_por_codigo_barras") {
        return { data: PRODUTO, error: null };
      }
      if (nome === "registrar_venda_presencial") {
        return registrarImplRef.atual?.(params);
      }
      if (nome === "anular_venda_presencial") {
        return anularImplRef.atual?.(params);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    registrarImplRef.atual = async () => respostaDaVenda();
    anularImplRef.atual = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function venderAteORecibo(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "bipar")?.click();
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Fechar venda")?.click();
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Dinheiro")?.click();
    });
    await avancar();
    await act(async () => {
      botao(hospedeiro, "Registrar venda")?.click();
    });
    await avancar();
  }

  it("o recibo oferece 'Anular venda'; anula o pedido que acabou de ser gravado, com o motivo, e vira 'Venda anulada'", async () => {
    anularImplRef.atual = async () => ({
      data: { order_id: ID, ja_anulada: false },
      error: null,
    });
    await venderAteORecibo();
    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(botao(hospedeiro, "Imprimir")).toBeDefined();

    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("forma de pagamento errada"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    await avancar();

    const chamadas = rpcMock.mock.calls.filter(
      ([n]) => n === "anular_venda_presencial",
    );
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0][1]).toEqual({
      p_order_id: ID,
      p_motivo: "forma de pagamento errada",
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Venda anulada");
    expect(texto).toMatch(/Devolva R\$\s39,90 em dinheiro ao cliente\./);
    // não é mais comprovante de compra
    expect(texto).not.toContain("Compra na loja");
    expect(botao(hospedeiro, "Imprimir")).toBeUndefined();
    expect(botao(hospedeiro, "Enviar por WhatsApp")).toBeUndefined();
    // e a próxima venda continua a um clique
    expect(botao(hospedeiro, "Nova venda")).toBeDefined();
  });

  it("servidor sem a função: o recibo continua como compra e a tela diz que a anulação não está liberada", async () => {
    anularImplRef.atual = async () => ({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await venderAteORecibo();
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    await avancar();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "A anulação ainda não está liberada neste servidor. Avise quem cuida do app.",
    );
    expect(hospedeiro.textContent).toContain("Compra na loja");
  });

  it("venda com cliente cadastrado avisa que o motivo pode ser lido por ele", async () => {
    registrarImplRef.atual = async () =>
      respostaDaVenda({ user_id: "cliente-1", customer_name: "Maria" });
    await venderAteORecibo();
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    expect(hospedeiro.textContent).toContain("ele pode ler o motivo");
  });

  it("retentativa de uma venda JÁ gravada e depois ANULADA: não mostra recibo de compra, explica e oferece venda nova", async () => {
    registrarImplRef.atual = async () =>
      respostaDaVenda({ status: "cancelled" }, true);
    await venderAteORecibo();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Esta venda já foi anulada");
    expect(texto).not.toContain("Compra na loja");
    expect(botao(hospedeiro, "Anular venda")).toBeUndefined();
    expect(botao(hospedeiro, "Registrar venda")?.disabled ?? true).toBe(true);
    expect(botao(hospedeiro, "Começar uma venda nova")).toBeDefined();
  });

  it("retentativa de uma venda gravada e ainda válida (ja_existia, entregue) segue mostrando o MESMO recibo", async () => {
    registrarImplRef.atual = async () => respostaDaVenda({}, true);
    await venderAteORecibo();
    expect(hospedeiro.textContent).toContain("Compra na loja");
    expect(hospedeiro.textContent).toContain(
      "Esta venda já tinha sido registrada",
    );
  });
});

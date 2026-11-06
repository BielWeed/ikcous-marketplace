// @vitest-environment jsdom
//
// Caçada R2, achado 6 — o banco grava só o NOME da peça vendida (sem tamanho/
// cor). O recibo recuperava a variação do cupom da TELA; quando a venda
// gravada tem uma peça que a tela não tem mais (retentativa depois de a
// lojista tirar a peça), ela saía só "Camiseta" — na tela, no papel e no aviso
// vermelho "A venda gravada tem 1 peça a mais do que a tela". A view agora lê
// o rótulo em `product_variants` (o mesmo `rotuloDaVariacao` da ficha do
// pedido) só para as peças gravadas que a tela não explica.
//
// Molde: tests/front/venda-presencial-fechamento.test.tsx (view real, RPC
// dublada, rascunho semeado no localStorage).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock, registrarImplRef, variantesImplRef } =
  vi.hoisted(() => ({
    rpcMock: vi.fn(),
    invokeMock: vi.fn(),
    fromMock: vi.fn(),
    registrarImplRef: {
      atual: null as
        | ((params: any) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
    variantesImplRef: {
      atual: null as
        | ((ids: string[]) => Promise<{ data: unknown; error: unknown }>)
        | null,
    },
  }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "lojista-1" }, isAdmin: true }),
}));

import {
  estadoInicialDaVenda,
  serializarRascunho,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

const ITEM_M = {
  chave: "produto-1::variante-m",
  productId: "produto-1",
  variantId: "variante-m",
  nome: "Camiseta",
  variacao: "Tamanho M",
  preco: 40,
  quantidade: 1,
  estoque: 10,
  imagem: "",
};

const GRAVADO_M = {
  id: "item-1",
  product_id: "produto-1",
  variant_id: "variante-m",
  quantity: 1,
  price: 40,
  product_name: "Camiseta",
};

const GRAVADO_G = {
  id: "item-2",
  product_id: "produto-1",
  variant_id: "variante-g",
  quantity: 1,
  price: 40,
  product_name: "Camiseta",
};

function pedido(total: number) {
  return {
    id: "99999999-9999-9999-9999-999999999999",
    created_at: "2026-09-17T12:00:00.000Z",
    total,
    subtotal: total,
    discount: 0,
    payment_method: "cash" as const,
  };
}

function localizarBotaoPorTexto(
  raizDom: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raizDom.querySelectorAll("button")].find((b) =>
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

describe("AdminPdvView — peça gravada que a tela não tem mais (achado 6)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let idsConsultados: string[][];

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    idsConsultados = [];
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string, params: any) => {
      if (nome === "registrar_venda_presencial") {
        return registrarImplRef.atual!(params);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();
    fromMock.mockImplementation((tabela: string) => {
      if (tabela !== "product_variants") {
        throw new Error(`Tabela inesperada: ${tabela}`);
      }
      return {
        select: () => ({
          in: (_coluna: string, ids: string[]) => {
            idsConsultados.push(ids);
            return variantesImplRef.atual!(ids);
          },
        }),
      };
    });
    variantesImplRef.atual = async () => ({
      data: [{ id: "variante-g", name: "Tamanho", value: "G" }],
      error: null,
    });

    // Cupom da tela: só a Camiseta M, já no fechamento com Dinheiro.
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [ITEM_M],
        pagamento: "cash",
      }),
    );
    // O banco já tinha a venda com M E G (a G a lojista tirou da tela).
    registrarImplRef.atual = async () => ({
      data: {
        ja_existia: true,
        order: pedido(80),
        items: [GRAVADO_M, GRAVADO_G],
      },
      error: null,
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
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function registrar(): Promise<void> {
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      localizarBotaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();
  }

  it("a peça gravada que a tela não tem sai COM o tamanho: na linha do recibo, no aviso vermelho e no papel", async () => {
    await registrar();

    const linhas = [...hospedeiro.querySelectorAll(".pdv-receipt-lines li")];
    expect(linhas).toHaveLength(2);
    expect(linhas[0].textContent).toContain("Tamanho M");
    expect(linhas[1].textContent).toContain("Tamanho G");

    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain(
      "1 peça a mais do que a tela: Camiseta Tamanho G.",
    );

    const papel = document.querySelector("[data-tema-fixo]");
    expect(papel?.textContent).toContain("Camiseta - Tamanho G");
  });

  it("só pergunta ao banco pelas peças que a tela NÃO explica (a M já tem rótulo no cupom)", async () => {
    await registrar();

    expect(idsConsultados).toEqual([["variante-g"]]);
  });

  it("se a leitura da variação falhar, o recibo aparece do mesmo jeito (sem o tamanho, sem quebrar)", async () => {
    variantesImplRef.atual = async () => ({
      data: null,
      error: { message: "falha" },
    });

    await registrar();

    expect(hospedeiro.textContent).toContain("Compra na loja");
    const linhas = [...hospedeiro.querySelectorAll(".pdv-receipt-lines li")];
    expect(linhas).toHaveLength(2);
    expect(linhas[1].textContent).not.toContain("Tamanho G");
  });

  it("venda cujas peças a tela explica não faz consulta nenhuma", async () => {
    registrarImplRef.atual = async () => ({
      data: { ja_existia: false, order: pedido(40), items: [GRAVADO_M] },
      error: null,
    });

    await registrar();

    expect(fromMock).not.toHaveBeenCalled();
    expect(hospedeiro.textContent).toContain("Compra na loja");
  });
});

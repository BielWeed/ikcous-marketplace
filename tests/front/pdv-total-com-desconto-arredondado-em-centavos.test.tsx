// @vitest-environment jsdom
//
// Balcão: o desconto entra na conta ARREDONDADO em centavos. Sem isso,
// R$ 1,00 com desconto de R$ 0,55 dá 0.44999999999999996 (em vez de 0.45) — e
// é esse número que vai ao banco como `p_total_esperado`, onde ele é comparado
// com o total que o servidor calcula. Um centavo fantasma ali vira recusa de
// venda no meio do balcão.
//
// Duas camadas: (1) a função pura `totalDaVenda`; (2) a view real, que manda o
// valor à RPC dublada.
//
// Molde: tests/front/admin-pdv-troco-nao-muda-o-registro.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, invokeMock, fromMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  invokeMock: vi.fn(),
  fromMock: vi.fn(),
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
  type ItemDoCupom,
  estadoInicialDaVenda,
  serializarRascunho,
  totalDaVenda,
} from "@/hooks/useVendaPresencial";
import { AdminPdvView } from "@/views/admin/AdminPdvView";

function item(preco: number, quantidade = 1): ItemDoCupom {
  return {
    chave: "produto-1::",
    productId: "produto-1",
    variantId: null,
    nome: "Camiseta",
    variacao: null,
    preco,
    quantidade,
    estoque: 10,
    imagem: "",
  };
}

// Pares escolhidos por MEDIÇÃO: sem o arredondamento do desconto, cada um
// destes dá um resíduo de ponto flutuante (ex.: 0.44999999999999996).
const CASOS_COM_RESIDUO = [
  { preco: 1, quantidade: 1, desconto: 0.55, total: 0.45 },
  { preco: 29.95, quantidade: 1, desconto: 16.01, total: 13.94 },
  { preco: 4.35, quantidade: 1, desconto: 2.01, total: 2.34 },
  { preco: 2, quantidade: 1, desconto: 1.1, total: 0.9 },
];

describe("totalDaVenda — o desconto é arredondado em centavos", () => {
  it.each(CASOS_COM_RESIDUO)(
    "R$ $preco com desconto de R$ $desconto devolve literalmente $total",
    ({ preco, quantidade, desconto, total }) => {
      const estado = {
        ...estadoInicialDaVenda(() => "k1"),
        itens: [item(preco, quantidade)],
        desconto,
        motivoDoDesconto: "cortesia",
      };
      // toBe (Object.is): 0.44999999999999996 NÃO é 0.45.
      expect(totalDaVenda(estado)).toBe(total);
    },
  );

  // Este caso NÃO distingue a mutação (0.01 × 100 já é exato): fica como
  // regressão do exemplo pedido, não como prova do arredondamento.
  it("3 × R$ 33,33 com desconto de R$ 0,01 devolve 99,98", () => {
    const estado = {
      ...estadoInicialDaVenda(() => "k1"),
      itens: [item(33.33, 3)],
      desconto: 0.01,
      motivoDoDesconto: "arredondamento",
    };
    expect(totalDaVenda(estado)).toBe(99.98);
  });

  it("sobre R$ 1,00, nenhum desconto de 0 a 100 centavos deixa o total com mais de duas casas", () => {
    const base = estadoInicialDaVenda(() => "k1");
    for (let centavos = 0; centavos <= 100; centavos++) {
      const estado = {
        ...base,
        itens: [item(1, 1)],
        desconto: centavos / 100,
        motivoDoDesconto: "x",
      };
      const total = totalDaVenda(estado);
      expect(total, `desconto de ${centavos} centavos`).toBe(
        Math.round(total * 100) / 100,
      );
    }
  });

  it("desconto maior que o subtotal só zera o total (clamp), nunca negativo", () => {
    const estado = {
      ...estadoInicialDaVenda(() => "k1"),
      itens: [item(1, 1)],
      desconto: 1.01,
      motivoDoDesconto: "x",
    };
    expect(totalDaVenda(estado)).toBe(0);
  });
});

const RESPOSTA = {
  ja_existia: false,
  order: {
    id: "99999999-9999-9999-9999-999999999999",
    created_at: "2026-11-12T12:00:00.000Z",
    total: 0.45,
    subtotal: 1,
    discount: 0.55,
    payment_method: "cash" as const,
  },
  items: [
    {
      id: "item-1",
      product_id: "produto-1",
      variant_id: null,
      quantity: 1,
      price: 1,
      product_name: "Camiseta",
    },
  ],
};

function botaoPorTexto(
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

describe("AdminPdvView — o total conferido que vai ao banco é o arredondado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    rpcMock.mockReset();
    rpcMock.mockImplementation(async (nome: string) => {
      if (nome === "registrar_venda_presencial") {
        return { data: RESPOSTA, error: null };
      }
      throw new Error(`RPC inesperada: ${nome}`);
    });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    fromMock.mockReset();

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

  async function registrarComDesconto(
    preco: number,
    desconto: number,
  ): Promise<Record<string, unknown>> {
    localStorage.setItem(
      "admin_pdv_venda_draft:lojista-1",
      serializarRascunho({
        ...estadoInicialDaVenda(() => "chave-da-venda-teste"),
        etapa: "fechamento",
        itens: [item(preco)],
        pagamento: "cash",
        desconto,
        motivoDoDesconto: "cortesia",
      }),
    );
    await act(async () => {
      raiz.render(<AdminPdvView onNavigate={vi.fn()} />);
    });
    await avancar();
    await act(async () => {
      botaoPorTexto(hospedeiro, "Registrar venda")!.click();
    });
    await avancar();

    const chamadas = rpcMock.mock.calls.filter(
      ([nome]) => nome === "registrar_venda_presencial",
    );
    expect(chamadas).toHaveLength(1);
    return chamadas[0][1] as Record<string, unknown>;
  }

  it("R$ 1,00 com desconto de R$ 0,55: p_total_esperado é 0.45, não 0.44999999999999996", async () => {
    const argumentos = await registrarComDesconto(1, 0.55);

    expect(argumentos.p_total_esperado).toBe(0.45);
    expect(argumentos.p_desconto).toBe(0.55);
    expect(argumentos.p_observacao).toBe("cortesia");
  });

  it("R$ 29,95 com desconto de R$ 16,01: p_total_esperado é 13.94", async () => {
    const argumentos = await registrarComDesconto(29.95, 16.01);

    expect(argumentos.p_total_esperado).toBe(13.94);
    expect(argumentos.p_desconto).toBe(16.01);
  });
});

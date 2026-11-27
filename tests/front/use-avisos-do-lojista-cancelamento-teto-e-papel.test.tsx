// @vitest-environment jsdom
//
// Duas regras da fonte "cliente cancelou" do sino do lojista que nenhum teste
// prendia (apanhadas por mutacao):
//
// 1. O TETO: a consulta do historico pede os 100 cancelamentos MAIS NOVOS
//    (`order created_at desc` + `limit 100`). Os testes de lista cortada
//    entregam 100 linhas ao hook, mas nenhum conferia o numero que o hook PEDE
//    ao banco: mudar o teto para 99 (ou tirar a ordem) passava em tudo, e o
//    cancelamento mais antigo de um pedido pago sumia sem aviso nenhum.
// 2. QUEM E EXCLUIDO: so quem o `profiles` diz que e `admin`. Autor com papel
//    `customer` ou com perfil sem papel (null) e cancelamento do CLIENTE e
//    aparece. Trocar "e admin" por "nao e customer" escondia o pedido pago
//    cancelado por uma conta sem papel preenchido.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLIENTE = "c1111111-1111-4111-8111-111111111111";
const SEM_PAPEL = "c2222222-2222-4222-8222-222222222222";
const ADMIN = "a1111111-1111-4111-8111-111111111111";

const { historico, perfis, chamadasDoHistorico, loadProductsFalso } =
  vi.hoisted(() => ({
    historico: { resposta: { data: [], error: null } as unknown },
    perfis: { resposta: { data: [], error: null } as unknown },
    chamadasDoHistorico: [] as Array<[string, ...unknown[]]>,
    loadProductsFalso: vi.fn(),
  }));

function construir(tabela: string) {
  const b: Record<string, unknown> = {};
  const registra = (nome: string) =>
    vi.fn((...args: unknown[]) => {
      if (tabela === "marketplace_order_history") {
        chamadasDoHistorico.push([nome, ...args]);
      }
      return b;
    });
  for (const nome of [
    "select",
    "eq",
    "in",
    "or",
    "is",
    "not",
    "gte",
    "order",
    "limit",
    "range",
    "contains",
  ]) {
    // eslint-disable-next-line security/detect-object-injection -- chave de uma lista fixa de métodos do dublê
    b[nome] = registra(nome);
  }
  b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  // biome-ignore lint/suspicious/noThenProperty: dubla o query builder thenable do Supabase
  b.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(
      tabela === "marketplace_order_history"
        ? historico.resposta
        : tabela === "profiles"
          ? perfis.resposta
          : { data: [], count: 0, error: null },
    ).then(resolve as never, reject as never);
  return b;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => construir(tabela)),
    rpc: vi.fn((nome: string) =>
      Promise.resolve(
        nome === "admin_devolucoes_listar"
          ? {
              data: { total: 0, contagem: { solicitada: 0 }, itens: [] },
              error: null,
            }
          : { data: { total_count: 0 }, error: null },
      ),
    ),
  },
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: loadProductsFalso }),
}));

// @ts-expect-error flag interna do React, sem tipo publico.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface Leitura {
  avisos: Array<{ tipo: string }>;
  fontesComFalha: string[];
}

const raizes: Array<{ unmount: () => void }> = [];

async function montar() {
  const { useAvisosDoLojista } = await import("@/hooks/useAvisosDoLojista");
  const leituras: Leitura[] = [];
  function Sonda() {
    leituras.push(useAvisosDoLojista() as unknown as Leitura);
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);
  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});
  return () => leituras[leituras.length - 1];
}

function cancelamento(indice: number, autor: string) {
  const pedido = `3f2a1b8c-4d5e-4f60-9a7b-${String(indice).padStart(12, "0")}`;
  return {
    id: `h${indice}`,
    order_id: pedido,
    old_status: "pending",
    created_by: autor,
    created_at: "2026-11-24T11:00:00.000Z",
    marketplace_orders: {
      id: pedido,
      // Quem cancela e o DONO do pedido (a selecao exige created_by = user_id).
      user_id: autor,
      customer_name: "Maria Silva",
      total: 149.9,
      payment_status: "pago",
      status: "cancelled",
      cancelled_after_shipping: false,
    },
  };
}

beforeEach(() => {
  chamadasDoHistorico.length = 0;
  historico.resposta = { data: [], error: null };
  perfis.resposta = { data: [], error: null };
  loadProductsFalso.mockImplementation(() =>
    Promise.resolve({ products: [], total: 0 }),
  );
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => raiz.unmount());
  }
  document.body.innerHTML = "";
});

describe("useAvisosDoLojista — cancelamento do cliente: teto e quem e excluido", () => {
  it("pede ao banco os 100 cancelamentos MAIS NOVOS (ordem created_at desc, teto 100)", async () => {
    await montar();

    expect(chamadasDoHistorico).toContainEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
    const limite = chamadasDoHistorico.find((c) => c[0] === "limit");
    expect(limite?.[1]).toBe(100);
  });

  // 27/11/2026: o aviso fala da etiqueta ja paga (`etiquetaPaga`) so se a
  // leitura trouxer a coluna; sem ela o pedido chega sem etiqueta e o aviso
  // volta a dizer so "o reembolso e automatico".
  it("pede o shipping_label_id do pedido embutido (o aviso da etiqueta paga depende dele)", async () => {
    await montar();

    const selecao = chamadasDoHistorico.find((c) => c[0] === "select");
    expect(String(selecao?.[1])).toMatch(
      /marketplace_orders\([^)]*\bshipping_label_id\b/,
    );
  });

  it("so o papel admin e excluido: cliente e perfil SEM papel continuam virando aviso", async () => {
    historico.resposta = {
      data: [
        cancelamento(1, CLIENTE),
        cancelamento(2, SEM_PAPEL),
        cancelamento(3, ADMIN),
      ],
      count: 3,
      error: null,
    };
    perfis.resposta = {
      data: [
        { id: CLIENTE, role: "customer" },
        { id: SEM_PAPEL, role: null },
        { id: ADMIN, role: "admin" },
      ],
      error: null,
    };

    const atual = await montar();

    expect(atual().fontesComFalha).toEqual([]);
    // Dois avisos de cancelamento (o do cliente e o do perfil sem papel); o do
    // admin nao vira aviso.
    expect(
      atual().avisos.filter((a) => a.tipo === "cancelamento"),
    ).toHaveLength(2);
  });
});

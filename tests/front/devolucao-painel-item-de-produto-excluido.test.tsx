// @vitest-environment jsdom
//
// Ficha da devolução no PAINEL: a peça de produto EXCLUÍDO não volta ao estoque (migration 20261659000000,
// decisão do sócio de 28/11/2026). A conclusão grava o carimbo da volta (`reestocado_em`) mas não soma estoque:
// a linha do item diz "não voltou ao estoque (produto excluído)" no lugar de "voltou ao estoque".
//
// Quem diz se o produto estava excluído NA HORA da volta é o banco (`vw_produtos_admin.deleted_at` até o carimbo).
// Produto excluído DEPOIS da volta: a peça voltou ao estoque antes, a linha segue "voltou ao estoque". Sem resposta,
// erro ou id ausente: "não sei", a linha fica como sempre. Ids e nomes inventados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

const { from, rpc, estado, tabelas } = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  estado: { detalhe: null as unknown },
  tabelas: {
    produtos: [] as { id: string; deleted_at: string | null }[],
    variacoes: [] as { id: string; product_id: string }[],
    erroDosProdutos: false,
    lidos: new Map<string, string[]>(),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from, rpc },
}));

vi.mock("@/hooks/useDevolucoesAdmin", () => {
  const nada = async () => true;
  return {
    useDevolucaoAdmin: () => ({
      detalhe: estado.detalhe,
      fotos: new Map(),
      carregando: false,
      erro: false,
      emVoo: null,
      recarregar: async () => {},
      aprovar: nada,
      recusar: nada,
      marcarEmTransito: nada,
      marcarRecebida: nada,
      gerarEtiquetaReversa: nada,
      liberarVinculoReverso: nada,
      concluir: nada,
      reprovar: nada,
      cancelar: nada,
    }),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const V1 = "33333333-3333-4333-8333-333333333333";
const VOLTA = "2026-11-20T15:00:00Z";

function item(
  id: string,
  nome: string,
  extra: Partial<{
    product_id: string | null;
    variant_id: string | null;
    reestocado_em: string | null;
  }> = {},
) {
  return {
    id,
    order_item_id: `oi-${id}`,
    product_id: P1,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade: 1,
    valor_unitario: 100,
    condicao: "nova",
    reestocar: true,
    reestocado_em: VOLTA,
    ...extra,
  };
}

function detalheDe(itens: ReturnType<typeof item>[]): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261120-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "troca",
    resolucao_final: "troca",
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "concluida",
    valor_itens: 100 * itens.length,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos: [],
    codigo_rastreio: null,
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-11-15T15:00:00Z",
    prazo_ate: "2026-11-22",
    politica: null,
    created_at: "2026-11-16T10:00:00Z",
    aprovada_em: "2026-11-16T11:00:00Z",
    postada_em: "2026-11-16T12:00:00Z",
    recebida_em: "2026-11-19T12:00:00Z",
    concluida_em: VOLTA,
    encerrada_em: null,
    itens,
    eventos: [],
    pedido: {
      id: "o-1",
      total: 100 * itens.length,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "Cliente Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
    },
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  tabelas.produtos = [];
  tabelas.variacoes = [];
  tabelas.erroDosProdutos = false;
  tabelas.lidos = new Map();
  from.mockReset();
  from.mockImplementation((tabela: string) => ({
    select: () => ({
      in: (_coluna: string, lista: string[]) => {
        tabelas.lidos.set(tabela, lista);
        if (tabela === "vw_produtos_admin")
          return Promise.resolve(
            tabelas.erroDosProdutos
              ? { data: null, error: { message: "falhou" } }
              : {
                  data: tabelas.produtos.filter((p) => lista.includes(p.id)),
                  error: null,
                },
          );
        if (tabela === "product_variants")
          return Promise.resolve({
            data: tabelas.variacoes.filter((v) => lista.includes(v.id)),
            error: null,
          });
        return Promise.resolve({ data: [], error: null });
      },
    }),
  }));
  // A leitura das peças que esperam tamanho: nenhuma.
  rpc.mockReset();
  rpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(detalhe: DevolucaoDetalhe) {
  estado.detalhe = detalhe;
  const { DetalheDaDevolucao } = await import(
    "@/components/admin/devolucoes/DetalheDaDevolucao"
  );
  await act(async () => {
    raiz.render(
      <DetalheDaDevolucao
        id="d-1"
        onFechar={vi.fn()}
        onMudou={vi.fn()}
        onSujoMudou={vi.fn()}
        onAbrirPedido={vi.fn()}
      />,
    );
  });
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

/** O texto da linha de detalhe do item com este nome. */
function linhaDo(nome: string): string {
  const li = Array.from(hospedeiro.querySelectorAll("li")).find((el) =>
    el.textContent?.includes(nome),
  );
  return li?.textContent ?? "";
}

const NAO_VOLTOU = "não voltou ao estoque (produto excluído)";

describe("ficha da devolução: a peça de produto excluído não voltou ao estoque", () => {
  it("produto excluído ANTES da volta: a linha diz que não voltou; o outro item, de produto vivo, voltou", async () => {
    tabelas.produtos = [
      { id: P1, deleted_at: "2026-11-18T09:00:00Z" },
      { id: P2, deleted_at: null },
    ];
    await montar(
      detalheDe([
        item("i-1", "Saia Excluída"),
        item("i-2", "Blusa Viva", { product_id: P2 }),
      ]),
    );
    expect(linhaDo("Saia Excluída")).toContain(NAO_VOLTOU);
    expect(linhaDo("Blusa Viva")).toContain("voltou ao estoque");
    expect(linhaDo("Blusa Viva")).not.toContain(NAO_VOLTOU);
    expect([...(tabelas.lidos.get("vw_produtos_admin") ?? [])].sort()).toEqual(
      [P1, P2].sort(),
    );
  });

  it("produto excluído no mesmo milissegundo da volta: a peça não voltou ao estoque", async () => {
    tabelas.produtos = [{ id: P1, deleted_at: VOLTA }];
    await montar(detalheDe([item("i-1", "Saia Excluída na Volta")]));
    expect(linhaDo("Saia Excluída na Volta")).toContain(NAO_VOLTOU);
  });

  it("produto excluído DEPOIS da volta: a peça voltou ao estoque antes, a linha segue como sempre", async () => {
    tabelas.produtos = [{ id: P1, deleted_at: "2026-11-25T09:00:00Z" }];
    await montar(detalheDe([item("i-1", "Saia Depois")]));
    expect(linhaDo("Saia Depois")).toContain("voltou ao estoque");
    expect(linhaDo("Saia Depois")).not.toContain(NAO_VOLTOU);
  });

  it("item sem produto, só com a variação: o pai da variação decide", async () => {
    tabelas.variacoes = [{ id: V1, product_id: P1 }];
    tabelas.produtos = [{ id: P1, deleted_at: "2026-11-18T09:00:00Z" }];
    await montar(
      detalheDe([
        item("i-1", "Vestido Só Variação", {
          product_id: null,
          variant_id: V1,
        }),
      ]),
    );
    expect(linhaDo("Vestido Só Variação")).toContain(NAO_VOLTOU);
    expect(tabelas.lidos.get("product_variants")).toContain(V1);
  });

  it("a consulta falha: 'não sei', a linha fica como sempre (nunca um aviso falso)", async () => {
    tabelas.erroDosProdutos = true;
    await montar(detalheDe([item("i-1", "Saia Sem Resposta")]));
    expect(linhaDo("Saia Sem Resposta")).toContain("voltou ao estoque");
    expect(linhaDo("Saia Sem Resposta")).not.toContain(NAO_VOLTOU);
  });

  it("nenhum item voltou: nem consulta os produtos", async () => {
    await montar(
      detalheDe([item("i-1", "Saia Que Não Voltou", { reestocado_em: null })]),
    );
    expect(tabelas.lidos.has("vw_produtos_admin")).toBe(false);
    expect(linhaDo("Saia Que Não Voltou")).not.toContain("voltou ao estoque");
  });
});

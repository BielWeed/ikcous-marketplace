// @vitest-environment jsdom
//
// Cartão da devolução do CLIENTE: duas linhas do MESMO produto com variações
// diferentes (camiseta P e camiseta M) não podem aparecer idênticas. O item
// devolvido já traz `variant_id`; o texto da escolha ("Tamanho P") vem de
// `product_variants`, a mesma leitura da ficha do pedido. Se a leitura falha
// (ou o item não tem variação), o cartão aparece como sempre, sem rótulo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

const { from, ids } = vi.hoisted(() => ({
  from: vi.fn(),
  ids: { lidos: [] as string[] },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from, rpc: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const VARIACOES = [
  { id: "v-p", name: "Tamanho", value: "P" },
  { id: "v-m", name: "Tamanho", value: "M" },
];

function detalhe(
  itens: Array<{ id: string; variant_id: string | null; quantidade: number }>,
) {
  return {
    id: "d-1",
    protocolo: "DV1",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "aprovada",
    valor_itens: 200,
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
    entregue_em: null,
    prazo_ate: "2026-11-10",
    politica: { endereco_devolucao: "Rua A, 1" },
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: "2026-11-02T12:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: itens.map((i) => ({
      ...i,
      order_item_id: `oi-${i.id}`,
      valor_unitario: 100,
      product_name: "Camiseta",
    })),
    eventos: [],
    pedido: null,
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  ids.lidos = [];
  from.mockReset();
  from.mockImplementation((tabela: string) => ({
    select: () => ({
      in: (_coluna: string, lista: string[]) => {
        if (tabela === "product_variants") ids.lidos = lista;
        return Promise.resolve({ data: VARIACOES, error: null });
      },
    }),
  }));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(atual: DevolucaoDetalhe) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoVivo={null}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={vi.fn()}
      />,
    );
  });
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const rotulos = () =>
  Array.from(
    hospedeiro.querySelectorAll('[data-testid="variacao-do-item-devolvido"]'),
  ).map((el) => el.textContent);

describe("cartão da devolução: qual variação é qual", () => {
  it("duas linhas do mesmo produto (P e M) mostram cada uma a sua variação", async () => {
    await montar(
      detalhe([
        { id: "i-1", variant_id: "v-p", quantidade: 1 },
        { id: "i-2", variant_id: "v-m", quantidade: 1 },
      ]),
    );
    expect(rotulos()).toEqual(["Tamanho P", "Tamanho M"]);
    expect(ids.lidos).toEqual(["v-m", "v-p"]);
  });

  it("item sem variação não ganha rótulo, e o produto sem variação não consulta nada", async () => {
    await montar(detalhe([{ id: "i-1", variant_id: null, quantidade: 2 }]));
    expect(rotulos()).toEqual([]);
    expect(hospedeiro.textContent).toContain("2× Camiseta");
    expect(from).not.toHaveBeenCalledWith("product_variants");
  });

  it("se a leitura das variações falha, o cartão aparece como sempre, sem rótulo", async () => {
    from.mockImplementation((tabela: string) => ({
      select: () => ({
        in: () =>
          tabela === "product_variants"
            ? Promise.reject(new Error("rede"))
            : Promise.resolve({ data: [], error: null }),
      }),
    }));
    await montar(detalhe([{ id: "i-1", variant_id: "v-p", quantidade: 1 }]));
    expect(rotulos()).toEqual([]);
    expect(hospedeiro.textContent).toContain("1× Camiseta");
  });
});

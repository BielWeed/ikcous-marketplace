// @vitest-environment jsdom
//
// Ficha da devolução no PAINEL: o item mostra "3 × R$ 49,33" (quantidade e o
// preço de UMA unidade, já com o cupom e arredondado). Sem a unidade escrita,
// "R$ 49,33" parecia o total da linha, e não bate com o "Valor dos itens" do
// servidor (R$ 148,00 num pedido de 3 x R$ 50,00 com cupom de R$ 2,00). O
// preço vem marcado "un."; o total da devolução continua o do servidor.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

const { from, ids, estado } = vi.hoisted(() => ({
  from: vi.fn(),
  ids: { lidos: [] as string[] },
  estado: { detalhe: null as unknown },
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

const VARIACOES: unknown[] = [];

function item(
  id: string,
  nome: string,
  quantidade: number,
  valor_unitario: number,
) {
  return {
    id,
    order_item_id: `oi-${id}`,
    product_id: `p-${id}`,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade,
    valor_unitario,
    condicao: null,
    reestocar: null,
    reestocado_em: null,
  };
}

function detalheDe(itens: ReturnType<typeof item>[]): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261106-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "recebida",
    valor_itens: 100 * itens.length,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos: [],
    codigo_rastreio: "AB123456789BR",
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: "2026-11-01T15:00:00Z",
    prazo_ate: "2026-11-08",
    politica: null,
    created_at: "2026-11-02T10:00:00Z",
    aprovada_em: "2026-11-02T11:00:00Z",
    postada_em: "2026-11-02T12:00:00Z",
    recebida_em: "2026-11-03T12:00:00Z",
    concluida_em: null,
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
      customer_name: "Maria Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
    },
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
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

const linhaDoItem = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("li")).find((li) =>
    li.textContent?.includes(nome),
  );

describe("ficha da devolução no painel: o preço do item é por unidade", () => {
  it("3 x R$ 49,33 aparece como preço de uma unidade, marcado 'un.'", async () => {
    const detalhe = detalheDe([item("i-1", "Camiseta", 3, 49.33)]);
    detalhe.valor_itens = 148;
    await montar(detalhe);
    const texto = linhaDoItem("Camiseta")?.textContent?.replace(/\s/g, " ");
    expect(texto).toContain("3 × R$ 49,33 un.");
    expect(hospedeiro.textContent?.replace(/\s/g, " ")).toContain("R$ 148,00");
  });

  it("uma unidade sem cupom também diz 'un.'", async () => {
    await montar(detalheDe([item("i-1", "Boné", 1, 100)]));
    const texto = linhaDoItem("Boné")?.textContent?.replace(/\s/g, " ");
    expect(texto).toContain("1 × R$ 100,00 un.");
  });
});

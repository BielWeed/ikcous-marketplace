// @vitest-environment jsdom
//
// Ficha da devolução no PAINEL: duas linhas do MESMO produto com variações
// diferentes (camiseta Azul P e camiseta Preta M) não podem aparecer idênticas
// para a lojista. Ela confere o que chegou e dá "Voltar ao estoque" por item,
// e o banco repõe a unidade na variação DAQUELA linha — então ela precisa ler
// qual variação é qual, tanto na lista de itens quanto no formulário de
// concluir (inclusive no nome que o leitor de tela fala).
//
// O item devolvido já traz `variant_id`; o texto ("Cor Azul · Tamanho P") vem
// de `product_variants`, a mesma leitura do cartão da cliente. Se a leitura
// falha (ou o item não tem variação), a ficha aparece como sempre.
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

const VARIACOES = [
  { id: "v-azul-p", name: "Cor / Tamanho", value: "Azul / P" },
  { id: "v-preta-m", name: "Cor / Tamanho", value: "Preta / M" },
];

function item(id: string, variant_id: string | null) {
  return {
    id,
    order_item_id: `oi-${id}`,
    product_id: "p-camiseta",
    variant_id,
    product_name: "Camiseta",
    image_url: null,
    quantidade: 1,
    valor_unitario: 100,
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

async function abrirConcluir() {
  const concluir = Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Concluir",
  );
  expect(concluir).toBeTruthy();
  await act(async () => {
    concluir?.click();
  });
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
  expect(
    hospedeiro.querySelector('[data-testid="form-concluir"]'),
  ).not.toBeNull();
}

const rotulosDaLista = () =>
  Array.from(
    hospedeiro.querySelectorAll('[data-testid="variacao-do-item-devolvido"]'),
  ).map((el) => el.textContent);

const nomesAcessiveis = (prefixo: string) =>
  Array.from(hospedeiro.querySelectorAll(`[aria-label^="${prefixo}"]`)).map(
    (el) => el.getAttribute("aria-label"),
  );

describe("ficha da devolução no painel: qual variação é qual", () => {
  it("a lista de itens mostra a cor e o tamanho de cada linha do mesmo produto", async () => {
    await montar(
      detalheDe([item("i-1", "v-azul-p"), item("i-2", "v-preta-m")]),
    );
    expect(rotulosDaLista()).toEqual([
      "Cor Azul · Tamanho P",
      "Cor Preta · Tamanho M",
    ]);
    expect(ids.lidos).toEqual(["v-azul-p", "v-preta-m"]);
  });

  it("o formulário de concluir distingue as linhas, na tela e no nome que o leitor de tela fala", async () => {
    await montar(
      detalheDe([item("i-1", "v-azul-p"), item("i-2", "v-preta-m")]),
    );
    await abrirConcluir();

    const formulario = hospedeiro.querySelector(
      '[data-testid="form-concluir"]',
    );
    const textoDoForm = formulario?.textContent ?? "";
    expect(textoDoForm).toContain("Cor Azul · Tamanho P");
    expect(textoDoForm).toContain("Cor Preta · Tamanho M");

    expect(nomesAcessiveis("Condição de")).toEqual([
      "Condição de Camiseta (Cor Azul · Tamanho P)",
      "Condição de Camiseta (Cor Preta · Tamanho M)",
    ]);
    expect(nomesAcessiveis("Voltar Camiseta")).toEqual([
      "Voltar Camiseta (Cor Azul · Tamanho P) ao estoque",
      "Voltar Camiseta (Cor Preta · Tamanho M) ao estoque",
    ]);
  });

  it("item sem variação não ganha rótulo, o nome continua o de sempre e nada é consultado", async () => {
    await montar(detalheDe([item("i-1", null)]));
    expect(rotulosDaLista()).toEqual([]);
    expect(hospedeiro.textContent).toContain("Camiseta");
    expect(from).not.toHaveBeenCalledWith("product_variants");

    await abrirConcluir();
    expect(nomesAcessiveis("Condição de")).toEqual(["Condição de Camiseta"]);
    expect(nomesAcessiveis("Voltar Camiseta")).toEqual([
      "Voltar Camiseta ao estoque",
    ]);
  });

  it("se a leitura das variações falha, a ficha aparece como sempre, sem rótulo", async () => {
    from.mockImplementation((tabela: string) => ({
      select: () => ({
        in: () =>
          tabela === "product_variants"
            ? Promise.reject(new Error("rede"))
            : Promise.resolve({ data: [], error: null }),
      }),
    }));
    await montar(
      detalheDe([item("i-1", "v-azul-p"), item("i-2", "v-preta-m")]),
    );
    expect(rotulosDaLista()).toEqual([]);
    expect(hospedeiro.textContent).toContain("Camiseta");

    await abrirConcluir();
    expect(nomesAcessiveis("Condição de")).toEqual([
      "Condição de Camiseta",
      "Condição de Camiseta",
    ]);
  });
});

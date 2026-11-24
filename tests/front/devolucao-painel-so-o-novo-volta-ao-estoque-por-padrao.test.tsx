// @vitest-environment jsdom
//
// Conclusão da devolução no painel (AcoesDaDevolucao): "Voltar ao estoque" só
// nasce LIGADO para o item que voltou novo, sem uso. Usada e danificada nascem
// desligadas — se nascessem ligadas, um produto estragado voltaria à prateleira
// e seria vendido de novo. A lojista continua podendo ligar a chave à mão, e o
// que o servidor recebe é o que está na tela.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function item(id: string, nome: string, valor_unitario: number) {
  return {
    id,
    order_item_id: `o-${id}`,
    product_id: `p-${id}`,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade: 1,
    valor_unitario,
    condicao: null,
    reestocar: null,
    reestocado_em: null,
  };
}

function detalheDe(): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261103-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "recebida",
    valor_itens: 200,
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
    itens: [
      item("a", "Camiseta azul", 100),
      item("b", "Calça preta", 100),
      item("c", "Boné verde", 0),
    ],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 200,
      shipping: 0,
      payment_method: "online",
      payment_status: "pago",
      canal: "online",
      customer_name: "Maria Teste",
      whatsapp: "34999990000",
      shipping_label_id: null,
      shipping_option_id: null,
    },
  } as DevolucaoDetalhe;
}

const concluir = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  concluir.mockResolvedValue(null);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function drenar() {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
}

async function montar(detalhe: DevolucaoDetalhe) {
  const { AcoesDaDevolucao } = await import(
    "@/components/admin/devolucoes/AcoesDaDevolucao"
  );
  const ficha = {
    emVoo: null,
    concluir,
    recusar: vi.fn(),
    reprovar: vi.fn(),
  } as unknown as FichaDaDevolucao;
  await act(async () => {
    raiz.render(
      <AcoesDaDevolucao
        ficha={ficha}
        detalhe={detalhe}
        onSujoMudou={vi.fn()}
      />,
    );
  });
  await drenar();
}

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

function condicaoDe(produto: string, texto: string) {
  const botoes = hospedeiro.querySelectorAll(
    `[role="group"][aria-label="Condição de ${produto}"] button`,
  );
  return Array.from(botoes).find((b) => b.textContent?.trim() === texto) as
    | HTMLButtonElement
    | undefined;
}

const chaveDoEstoque = (produto: string) =>
  hospedeiro.querySelector<HTMLButtonElement>(
    `[role="switch"][aria-label="Voltar ${produto} ao estoque"]`,
  );

async function clicar(el: HTMLElement | null | undefined) {
  expect(el).toBeTruthy();
  await act(async () => {
    el?.click();
  });
  await drenar();
}

describe("AcoesDaDevolucao — o que volta ao estoque por padrão", () => {
  it("só 'Nova, sem uso' nasce ligada; usada, danificada e 'Não veio' nascem desligadas e o servidor recebe o que está na tela", async () => {
    await montar(detalheDe());
    await clicar(botao("Concluir"));

    // Sem condição escolhida: a chave está desligada e travada.
    expect(chaveDoEstoque("Camiseta azul")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(chaveDoEstoque("Camiseta azul")?.disabled).toBe(true);

    await clicar(condicaoDe("Camiseta azul", "Nova, sem uso"));
    await clicar(condicaoDe("Calça preta", "Usada"));
    await clicar(condicaoDe("Boné verde", "Danificada"));
    expect(chaveDoEstoque("Camiseta azul")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(chaveDoEstoque("Calça preta")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(chaveDoEstoque("Boné verde")?.getAttribute("aria-checked")).toBe(
      "false",
    );

    // Trocar a condição de nova para danificada derruba o padrão; a lojista
    // pode ligar a chave da usada à mão (decisão dela, o app não impede).
    await clicar(condicaoDe("Camiseta azul", "Danificada"));
    expect(chaveDoEstoque("Camiseta azul")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    await clicar(chaveDoEstoque("Calça preta"));
    expect(chaveDoEstoque("Calça preta")?.getAttribute("aria-checked")).toBe(
      "true",
    );

    // "Não veio" nunca volta ao estoque: a chave desliga e trava mesmo ligada.
    await clicar(condicaoDe("Calça preta", "Não veio"));
    expect(chaveDoEstoque("Calça preta")?.getAttribute("aria-checked")).toBe(
      "false",
    );
    expect(chaveDoEstoque("Calça preta")?.disabled).toBe(true);
    await clicar(condicaoDe("Calça preta", "Usada"));
    await clicar(chaveDoEstoque("Calça preta"));

    await clicar(botao("Concluir devolução"));
    expect(concluir).toHaveBeenCalledTimes(1);
    expect(concluir.mock.calls[0][0].itens).toEqual([
      { item_id: "a", condicao: "danificada", reestocar: false },
      { item_id: "b", condicao: "usada", reestocar: true },
      { item_id: "c", condicao: "danificada", reestocar: false },
    ]);
  });
});

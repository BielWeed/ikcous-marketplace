// @vitest-environment jsdom
//
// Conclusão da devolução no painel (AcoesDaDevolucao): a "Observação da inspeção" é
// nota INTERNA da loja (o banco só a entrega ao admin: migration 20261404000000).
// O rótulo do campo diz isso à lojista antes de ela escrever, para ela não anotar
// ali um recado que acha que a cliente vai ler (a mensagem à cliente é outro campo).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaDevolucao } from "@/hooks/useDevolucoesAdmin";
import type { DevolucaoDetalhe } from "@/types/devolucao";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalheRecebida(): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV261117-AAAAA",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "tamanho_pequeno",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: null,
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "recebida",
    valor_itens: 100,
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
      {
        id: "a",
        order_item_id: "o-a",
        product_id: "p-a",
        variant_id: null,
        product_name: "Camiseta azul",
        image_url: null,
        quantidade: 1,
        valor_unitario: 100,
        condicao: null,
        reestocar: null,
        reestocado_em: null,
      },
    ],
    eventos: [],
    pedido: {
      id: "o-1",
      total: 100,
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

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: null, error: null });
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

describe("a observação da inspeção é só da loja", () => {
  it("o rótulo do campo diz que só a loja vê, e o campo continua opcional e ligado ao rótulo", async () => {
    const { AcoesDaDevolucao } = await import(
      "@/components/admin/devolucoes/AcoesDaDevolucao"
    );
    const ficha = {
      emVoo: null,
      concluir: vi.fn(),
      recusar: vi.fn(),
      reprovar: vi.fn(),
    } as unknown as FichaDaDevolucao;
    await act(async () => {
      raiz.render(
        <AcoesDaDevolucao
          ficha={ficha}
          detalhe={detalheRecebida()}
          onSujoMudou={vi.fn()}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });

    // O formulário de conclusão abre pelo botão "Concluir".
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

    const rotulo = hospedeiro.querySelector(
      'label[for="devolucao-observacao"]',
    );
    expect(rotulo?.textContent?.trim()).toBe(
      "Observação da inspeção (só a loja vê, opcional)",
    );
    // O campo de verdade está ligado a esse rótulo.
    expect(
      hospedeiro.querySelector("textarea#devolucao-observacao"),
    ).toBeTruthy();
    // E a frase antiga, que não dizia quem lê, não sobrou em lugar nenhum da tela.
    expect(hospedeiro.textContent).not.toContain(
      "Observação da inspeção (opcional)",
    );
  });
});

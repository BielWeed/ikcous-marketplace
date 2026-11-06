// @vitest-environment jsdom
//
// Endereço de devolução no cartão do CLIENTE: `solicitar_devolucao` grava uma
// cópia CONGELADA da política (`politica`) no dia do pedido. Se a loja corrige
// o endereço depois, a cliente não pode seguir mandando o pacote para o
// endereço velho: o endereço VIVO (da política atual, lida em
// `devolucao_elegibilidade`) vence o congelado. O congelado só vale quando
// não há endereço vivo (nem o da política atual, nem o da loja).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalheComPolitica(endereco: string | null) {
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
    valor_itens: 100,
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
    politica: { endereco_devolucao: endereco },
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: "2026-11-02T12:00:00Z",
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [
      { id: "i-1", quantidade: 1, valor_unitario: 100, product_name: "Tênis" },
    ],
    eventos: [],
    pedido: null,
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(props: {
  congelado: string | null;
  vivo?: string | null;
  daLoja?: string | null;
}) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={detalheComPolitica(props.congelado)}
        anteriores={[]}
        enderecoVivo={props.vivo}
        enderecoDaLoja={props.daLoja ?? null}
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={vi.fn()}
      />,
    );
  });
  return hospedeiro.textContent ?? "";
}

describe("cartão da devolução: endereço de devolução", () => {
  it("o endereço vivo vence a cópia congelada da política", async () => {
    const texto = await montar({
      congelado: "Rua Velha, 1",
      vivo: "Rua Nova, 99",
    });
    expect(texto).toContain("Envie para: Rua Nova, 99");
    expect(texto).not.toContain("Rua Velha, 1");
  });

  it("sem endereço vivo, mostra o congelado", async () => {
    const texto = await montar({ congelado: "Rua Velha, 1", vivo: null });
    expect(texto).toContain("Envie para: Rua Velha, 1");
  });

  it("sem a propriedade do vivo (leitura da elegibilidade ausente), mostra o congelado", async () => {
    const texto = await montar({
      congelado: "Rua Velha, 1",
      daLoja: "Rua da Loja, 5",
    });
    expect(texto).toContain("Envie para: Rua Velha, 1");
  });

  it("sem vivo e sem congelado, cai no endereço da loja", async () => {
    const texto = await montar({ congelado: null, daLoja: "Rua da Loja, 5" });
    expect(texto).toContain("Envie para: Rua da Loja, 5");
  });
});

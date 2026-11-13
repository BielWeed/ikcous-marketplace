// @vitest-environment jsdom
//
// "Solicitada em" (cartão da devolução no pedido da cliente) e a data da
// devolução na lista do painel são do calendário da LOJA (America/Sao_Paulo),
// qualquer que seja o fuso do aparelho. Uma solicitação criada em 12/11 às
// 22h30 de Brasília (01h30 UTC de 13/11) aparecia como 13/11 para quem abria o
// app em UTC. Datas puras `YYYY-MM-DD` (prazos) já são dia de calendário e não
// passam por fuso. O fuso do processo é trocado por `process.env.TZ` (o Node
// relê na hora) e volta ao que era depois de cada teste.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatarDia } from "@/lib/devolucao";
import type { DevolucaoDetalhe } from "@/types/devolucao";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 12/11/2026 às 22h30 em Brasília = 13/11/2026 às 01h30 UTC.
const SOLICITADA_22H30_BRT = "2026-11-13T01:30:00Z";

const fusoDaMaquina =
  process.env.TZ ?? new Intl.DateTimeFormat().resolvedOptions().timeZone;

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
  process.env.TZ = fusoDaMaquina;
});

describe("formatarDia — carimbo de data/hora no dia da loja", () => {
  it("o instante das 22h30 de Brasília é dia 12 em qualquer fuso do aparelho", () => {
    for (const fuso of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
      process.env.TZ = fuso;
      expect(formatarDia(SOLICITADA_22H30_BRT)).toBe("12/11/2026");
    }
  });

  it("CONTROLE: dia puro do banco não passa por fuso nenhum", () => {
    for (const fuso of ["UTC", "America/Sao_Paulo", "Asia/Tokyo"]) {
      process.env.TZ = fuso;
      expect(formatarDia("2026-11-13")).toBe("13/11/2026");
    }
  });

  it("LIMITE: texto que não é data devolve vazio, como antes", () => {
    expect(formatarDia("lixo")).toBe("");
    expect(formatarDia(null)).toBe("");
  });
});

describe("cartão da devolução no pedido", () => {
  const devolucao = {
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
    status: "solicitada",
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
    prazo_ate: "2026-11-30",
    politica: null,
    created_at: SOLICITADA_22H30_BRT,
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens: [
      {
        id: "i-1",
        quantidade: 1,
        valor_unitario: 100,
        product_name: "Blusa Teste",
      },
    ],
    eventos: [],
    pedido: null,
  } as unknown as DevolucaoDetalhe;

  it("'Solicitada em' mostra 12/11/2026 num aparelho em UTC", async () => {
    process.env.TZ = "UTC";
    const { DevolucaoDoPedidoCard } = await import(
      "@/components/devolucao/DevolucaoDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <DevolucaoDoPedidoCard
          atual={devolucao}
          anteriores={[]}
          enderecoDaLoja={null}
          horarioDaLoja={null}
          onCancelar={vi.fn().mockResolvedValue({ ok: true })}
          onInformarEnvio={vi.fn()}
        />,
      );
    });

    const dt = Array.from(hospedeiro.querySelectorAll("dt")).find(
      (d) => d.textContent === "Solicitada em",
    );
    expect(dt?.nextElementSibling?.textContent).toBe("12/11/2026");
  });
});

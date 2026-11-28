// @vitest-environment jsdom
//
// Caça por mutação no cartão da devolução: quando o servidor RECUSA o
// cancelamento, o cartão mostra a recusa como veio, em vermelho. A troca por
// "Essa devolução já avançou; veja o status acima." vale só para o rastreio
// recusado com o status relido diferente (o erro guarda `statusNoEnvio`); o
// erro do cancelar não guarda status nenhum e nunca vira essa frase.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
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

const RECUSA_DO_SERVIDOR = "Não foi possível cancelar esta devolução agora.";
const JA_AVANCOU = "Essa devolução já avançou; veja o status acima.";

const DEVOLUCAO = {
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
  prazo_ate: "2026-10-30",
  politica: null,
  created_at: "2026-10-20T12:00:00Z",
  aprovada_em: null,
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

const esperarHistorico = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 200));

function botao(texto: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

describe("cartão da devolução — cancelar recusado pelo servidor", () => {
  it("mostra a recusa do servidor como veio, e não 'já avançou'", async () => {
    const { DevolucaoDoPedidoCard } = await import(
      "@/components/devolucao/DevolucaoDoPedidoCard"
    );
    const onCancelar = vi.fn(
      async (): Promise<Desfecho> => ({ ok: false, erro: RECUSA_DO_SERVIDOR }),
    );
    await act(async () => {
      raiz.render(
        <DevolucaoDoPedidoCard
          atual={DEVOLUCAO}
          anteriores={[]}
          enderecoDaLoja={null}
          horarioDaLoja={null}
          onCancelar={onCancelar}
          onInformarEnvio={vi.fn()}
        />,
      );
    });

    await act(async () => {
      botao("Cancelar devolução")?.click();
    });
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    await act(async () => {
      botao("Sim, cancelar")?.click();
      await esperarHistorico();
    });

    expect(onCancelar).toHaveBeenCalledExactlyOnceWith("d-1");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      RECUSA_DO_SERVIDOR,
    );
    expect(
      document.querySelector('[data-testid="cartao-devolucao"]')?.textContent,
    ).not.toContain(JA_AVANCOU);
  });

  // A ficha relê e a devolução chega com OUTRO status depois da recusa: só o
  // rastreio recusado vira "já avançou"; a recusa do cancelar continua a
  // mesma, porque o erro dele não guarda o status de quando foi enviado.
  it("a ficha relê com outro status depois da recusa: continua a recusa do servidor, não 'já avançou'", async () => {
    const { DevolucaoDoPedidoCard } = await import(
      "@/components/devolucao/DevolucaoDoPedidoCard"
    );
    const onCancelar = vi.fn(
      async (): Promise<Desfecho> => ({ ok: false, erro: RECUSA_DO_SERVIDOR }),
    );
    const desenhar = (atual: DevolucaoDetalhe) =>
      raiz.render(
        <DevolucaoDoPedidoCard
          atual={atual}
          anteriores={[]}
          enderecoDaLoja={null}
          horarioDaLoja={null}
          onCancelar={onCancelar}
          onInformarEnvio={vi.fn()}
        />,
      );
    await act(async () => {
      desenhar(DEVOLUCAO);
    });

    await act(async () => {
      botao("Cancelar devolução")?.click();
    });
    await act(async () => {
      botao("Sim, cancelar")?.click();
      await esperarHistorico();
    });
    expect(onCancelar).toHaveBeenCalledExactlyOnceWith("d-1");

    await act(async () => {
      desenhar({ ...DEVOLUCAO, status: "aprovada" });
      await esperarHistorico();
    });

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      RECUSA_DO_SERVIDOR,
    );
    expect(
      document.querySelector('[data-testid="cartao-devolucao"]')?.textContent,
    ).not.toContain(JA_AVANCOU);
  });
});

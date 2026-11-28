// @vitest-environment jsdom
//
// Cliente com o cartão ainda "Aprovada" informa o rastreio (ou toca "Já
// postei"), mas a loja já marcou "Recebida" ou outro aparelho já informou o
// envio. O servidor recusa com "O código de envio só é informado depois da
// aprovação…", o hook relê e o cartão passa a mostrar o status novo. O erro
// vermelho de "depois da aprovação" embaixo contradiria esse status: no lugar
// dele, o cartão diz que a devolução já avançou. Quando o status relido continua
// "aprovada" (a recusa é de verdade), o erro do servidor aparece como veio.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
import type { DevolucaoDetalhe, StatusDevolucao } from "@/types/devolucao";

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

const RECUSA_DO_SERVIDOR =
  "O código de envio só é informado depois da aprovação, em devolução pelos Correios ou transportadora.";
const JA_AVANCOU = "Essa devolução já avançou; veja o status acima.";

function devolucao(
  status: StatusDevolucao,
  metodo: "envio_proprio" | "etiqueta_reversa" = "envio_proprio",
): DevolucaoDetalhe {
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
    metodo_retorno: metodo,
    status,
    valor_itens: 100,
    valor_frete_ida: 0,
    valor_reembolso: null,
    refund_id: null,
    reembolso_manual: false,
    fotos: [],
    codigo_rastreio: status === "em_transito" ? "XY987654321BR" : null,
    codigo_postagem: metodo === "etiqueta_reversa" ? "PL123456789BR" : null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: null,
    entregue_em: null,
    prazo_ate: "2026-10-30",
    politica: null,
    created_at: "2026-10-20T12:00:00Z",
    aprovada_em: "2026-10-21T12:00:00Z",
    postada_em: null,
    recebida_em: status === "recebida" ? "2026-10-25T12:00:00Z" : null,
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

/**
 * Monta o cartão em `aprovada`. O envio é recusado pelo servidor e, como o
 * hook faz, a releitura chega ANTES da resposta: o cartão é redesenhado com
 * `statusRelido` e só então a recusa volta.
 */
async function montarComRecusa(
  statusRelido: StatusDevolucao,
  metodo: "envio_proprio" | "etiqueta_reversa" = "envio_proprio",
) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  const desenhar = (
    atual: DevolucaoDetalhe,
    onInformarEnvio: (id: string, codigo: string) => Promise<Desfecho>,
  ) =>
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={vi.fn().mockResolvedValue({ ok: true })}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  const onInformarEnvio = vi.fn(async (): Promise<Desfecho> => {
    desenhar(devolucao(statusRelido, metodo), onInformarEnvio);
    return { ok: false, erro: RECUSA_DO_SERVIDOR };
  });
  await act(async () => {
    desenhar(devolucao("aprovada", metodo), onInformarEnvio);
  });
  return onInformarEnvio;
}

async function informarPeloCampo(codigo: string) {
  const campo = document.querySelector<HTMLInputElement>(
    "#rastreio-devolucao-d-1",
  ) as HTMLInputElement;
  expect(campo).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, codigo);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    campo
      .closest("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

const cartao = () =>
  document.querySelector('[data-testid="cartao-devolucao"]')?.textContent ?? "";
const alerta = () =>
  document.querySelector('[role="alert"]')?.textContent ?? null;

describe("cartão da devolução — rastreio recusado porque o status já andou", () => {
  it("a loja já marcou Recebida: não mostra o erro de 'depois da aprovação'", async () => {
    const onInformarEnvio = await montarComRecusa("recebida");
    await informarPeloCampo("AB123456789BR");
    expect(onInformarEnvio).toHaveBeenCalledTimes(1);
    expect(cartao()).not.toContain("depois da aprovação");
    expect(alerta()).toBeNull();
    expect(cartao()).toContain(JA_AVANCOU);
  });

  it("outro aparelho já tocou 'Já postei': também diz que já avançou", async () => {
    const onInformarEnvio = await montarComRecusa(
      "em_transito",
      "etiqueta_reversa",
    );
    const japostei = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Já postei o pacote",
    );
    expect(japostei).toBeTruthy();
    await act(async () => {
      japostei?.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "PL123456789BR");
    expect(cartao()).not.toContain("depois da aprovação");
    expect(cartao()).toContain(JA_AVANCOU);
  });

  it("o status relido continua Aprovada: a recusa do servidor aparece como veio", async () => {
    await montarComRecusa("aprovada");
    await informarPeloCampo("AB123456789BR");
    expect(alerta()).toBe(RECUSA_DO_SERVIDOR);
    expect(cartao()).not.toContain(JA_AVANCOU);
  });
});

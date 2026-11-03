// @vitest-environment jsdom
//
// Caça 02/11, achado a3: o cliente cola o código dos Correios como vem
// impresso no comprovante ("AB 123 456 789 BR"). O cartão só aparava as pontas
// e mandava os espaços do meio; a RPC `informar_envio_devolucao` recusa tudo que
// não casa com ^[A-Z0-9-]{5,40}$ e o cliente via só "Código de rastreio
// inválido.". O cartão passa a limpar o código com a MESMA função do painel
// (`normalizarCodigoDeRastreio`) antes de conferir o tamanho e de enviar.
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
  prazo_ate: "2026-10-30",
  politica: null,
  created_at: "2026-10-20T12:00:00Z",
  aprovada_em: "2026-10-21T12:00:00Z",
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

async function digitarEEnviar(texto: string) {
  const onInformarEnvio = vi.fn().mockResolvedValue({ ok: true });
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
        onCancelar={vi.fn()}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
  const campo = document.querySelector<HTMLInputElement>(
    "#rastreio-devolucao-d-1",
  );
  expect(campo).toBeTruthy();
  await act(async () => {
    // Setter nativo: o React só vê a mudança de um input controlado assim.
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, texto);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const enviar = Array.from(document.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Enviar",
  );
  expect(enviar).toBeTruthy();
  await act(async () => {
    enviar?.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return onInformarEnvio;
}

describe("cartão da devolução — código de rastreio digitado", () => {
  it("'ab 123 456 789 br' vai sem espaços e em maiúsculas: 'AB123456789BR'", async () => {
    const onInformarEnvio = await digitarEEnviar("ab 123 456 789 br");
    expect(onInformarEnvio).toHaveBeenCalledWith("d-1", "AB123456789BR");
  });

  it("só espaços e letras que não somam 5 caracteres: não envia", async () => {
    const onInformarEnvio = await digitarEEnviar("A B C D");
    expect(onInformarEnvio).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Digite o código de rastreio",
    );
  });
});

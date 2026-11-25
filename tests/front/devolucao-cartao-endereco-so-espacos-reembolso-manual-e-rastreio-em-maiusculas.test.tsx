// @vitest-environment jsdom
//
// Cartão da devolução no pedido do cliente — três bordas sem guarda:
//  1. Endereço de devolução "vivo" que veio só com espaços não vale: o cartão
//     cai no endereço da política (nunca mostra "Envie para:" vazio).
//  2. Reembolso feito À MÃO pela loja (`reembolso_manual`) não consulta o
//     andamento do estorno automático; o reembolso automático consulta.
//  3. O código de rastreio digitado já aparece em MAIÚSCULAS no campo (o que a
//     pessoa vê é o que vai).
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

const { de, eq } = vi.hoisted(() => ({
  de: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      de(tabela);
      return {
        select: () => ({
          eq: (coluna: string, valor: string) => {
            eq(coluna, valor);
            return {
              maybeSingle: async () => ({
                data: { status: "em_processamento" },
                error: null,
              }),
            };
          },
        }),
      };
    },
    rpc: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalhe(extra: Record<string, unknown> = {}) {
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
    politica: { endereco_devolucao: "Rua da Política, 1" },
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
    ...extra,
  } as unknown as DevolucaoDetalhe;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  de.mockClear();
  eq.mockClear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
});

async function montar(
  atual: DevolucaoDetalhe,
  enderecoVivo?: string | null,
  onInformarEnvio = vi.fn(),
) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoVivo={enderecoVivo}
        enderecoDaLoja="Rua da Loja, 5"
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
  return hospedeiro.textContent ?? "";
}

describe("cartão da devolução — endereço vivo só com espaços", () => {
  it("cai no endereço da política, não mostra 'Envie para:' em branco", async () => {
    const texto = await montar(detalhe(), "   ");
    expect(texto).toContain("Envie para: Rua da Política, 1");
  });

  it("endereço vivo com texto vence o da política, mesmo com espaços nas pontas", async () => {
    const texto = await montar(detalhe(), "  Rua Nova, 99  ");
    expect(texto).toContain("Envie para: Rua Nova, 99");
    expect(texto).not.toContain("Rua da Política, 1");
  });
});

describe("cartão da devolução — andamento do reembolso", () => {
  const concluida = (manual: boolean) =>
    detalhe({
      status: "concluida",
      resolucao_final: "reembolso",
      valor_reembolso: 100,
      refund_id: "refund-9",
      reembolso_manual: manual,
      concluida_em: "2026-11-05T12:00:00Z",
    });

  it("reembolso automático consulta o estorno; o manual não consulta nada", async () => {
    await montar(concluida(false));
    expect(de).toHaveBeenCalledWith("order_refunds");
    expect(eq).toHaveBeenCalledWith("id", "refund-9");

    de.mockClear();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montar(concluida(true));
    expect(de).not.toHaveBeenCalled();
  });
});

describe("cartão da devolução — código de rastreio", () => {
  it("o que ela digita em minúsculas aparece em MAIÚSCULAS no campo", async () => {
    await montar(detalhe());
    const campo = document.getElementById(
      "rastreio-devolucao-d-1",
    ) as HTMLInputElement;
    expect(campo).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(campo, "ab123456789br");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(campo.value).toBe("AB123456789BR");
  });
});

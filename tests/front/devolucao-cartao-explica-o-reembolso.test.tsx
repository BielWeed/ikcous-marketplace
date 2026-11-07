// @vitest-environment jsdom
//
// O cartão exibe o valor decidido pela loja sem recalcular o reembolso.
// Uma diferença precisa de explicação; troca/vale concluídos não prometem frete.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DevolucaoDetalhe } from "@/types/devolucao";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function detalhe(extra: Partial<DevolucaoDetalhe> = {}): DevolucaoDetalhe {
  return {
    id: "d-1",
    protocolo: "DV1",
    order_id: "o-1",
    tipo: "arrependimento",
    motivo: "desisti",
    detalhe: null,
    resolucao_desejada: "reembolso",
    resolucao_final: "reembolso",
    modalidade: "nacional",
    metodo_retorno: "envio_proprio",
    status: "concluida",
    valor_itens: 100,
    valor_frete_ida: 20,
    valor_reembolso: 50,
    refund_id: null,
    reembolso_manual: true,
    fotos: [],
    codigo_rastreio: null,
    codigo_postagem: null,
    me_reverse_id: null,
    etiqueta_url: null,
    coleta_em: null,
    mensagem_loja: null,
    observacao_inspecao: "Só a camiseta voltou no pacote.",
    entregue_em: null,
    prazo_ate: "2026-11-10",
    politica: null,
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: "2026-11-03T12:00:00Z",
    encerrada_em: null,
    itens: [
      {
        id: "i-1",
        order_item_id: "oi-1",
        product_id: "p-1",
        variant_id: null,
        product_name: "Camiseta",
        image_url: null,
        quantidade: 2,
        valor_unitario: 50,
        condicao: "ausente",
        reestocar: false,
        reestocado_em: null,
      },
    ],
    eventos: [],
    pedido: null,
    ...extra,
  };
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
});

async function montar(extra: Partial<DevolucaoDetalhe> = {}) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={detalhe(extra)}
        anteriores={[]}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={vi.fn()}
        onInformarEnvio={vi.fn()}
      />,
    );
  });
}

function valorDaLinha(rotulo: string) {
  return Array.from(hospedeiro.querySelectorAll("dt")).find(
    (dt) => dt.textContent === rotulo,
  )?.nextElementSibling?.textContent;
}

describe("cartão da devolução: explicação do valor final", () => {
  it("reembolso menor mantém o valor decidido e explica sem culpar a conferência", async () => {
    await montar();
    expect(valorDaLinha("Reembolso")).toContain("50,00");
    expect(valorDaLinha("Frete de ida")).toContain("20,00");
    expect(hospedeiro.textContent).toContain(
      "O valor final do reembolso foi definido pela loja.",
    );
    expect(hospedeiro.textContent).toContain(
      "Em caso de dúvida, fale com a loja.",
    );
  });

  it("a anotação interna da inspeção nunca aparece para a cliente", async () => {
    await montar();
    expect(hospedeiro.textContent).not.toContain(
      "Só a camiseta voltou no pacote.",
    );
    expect(hospedeiro.textContent).not.toContain("Conferência da loja");
    await montar({ valor_reembolso: 120 });
    expect(hospedeiro.textContent).not.toContain(
      "Só a camiseta voltou no pacote.",
    );
    expect(hospedeiro.textContent).not.toContain("Conferência da loja");
  });

  it("reembolso integral não anuncia um ajuste", async () => {
    await montar({ valor_reembolso: 120 });
    expect(valorDaLinha("Reembolso")).toContain("120,00");
    expect(hospedeiro.textContent).not.toContain("O valor final do reembolso");
  });

  it.each(["troca", "vale"] as const)(
    "%s concluído não exibe frete nem um total que pareça dinheiro a receber",
    async (resolucao_final) => {
      await montar({ resolucao_final, valor_reembolso: null });
      expect(valorDaLinha("Frete de ida")).toBeUndefined();
      expect(valorDaLinha("Valor")).toBeUndefined();
      expect(valorDaLinha("Reembolso")).toBeUndefined();
      expect(valorDaLinha("Resolvido com")).toBe(
        resolucao_final === "troca" ? "Troca" : "Vale-troca",
      );
      expect(hospedeiro.textContent).not.toContain("A loja ajustou o valor");
    },
  );

  it("enquanto aguarda conclusão mantém os valores de referência, sem anunciar ajuste final", async () => {
    await montar({
      status: "recebida",
      resolucao_final: null,
      valor_reembolso: null,
      observacao_inspecao: null,
    });
    expect(valorDaLinha("Frete de ida")).toContain("20,00");
    expect(valorDaLinha("Valor")).toContain("120,00");
    expect(hospedeiro.textContent).not.toContain("A loja ajustou o valor");
  });
});

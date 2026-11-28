// @vitest-environment jsdom
//
// Cartão da devolução da cliente (DevolucaoDoPedidoCard) num pedido COM
// CUPOM: o preço de cada item vem arredondado por unidade, e o "Valor" vem
// do servidor, que fecha a conta numa vez só. A linha "30× Caneta R$ 90,00"
// com "Valor R$ 89,91" logo abaixo fazia a cliente achar que faltou dinheiro.
// Agora as linhas repartem o valor do servidor e somam exatamente o "Valor";
// sem cupom, a linha continua sendo quantidade x preço.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Desfecho } from "@/hooks/useDevolucaoCliente";
import type { DevolucaoDetalhe, ItemDevolvido } from "@/types/devolucao";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => {
      const b: Record<string, unknown> = {};
      b.select = vi.fn(() => b);
      b.eq = vi.fn(() => b);
      b.in = vi.fn(() => Promise.resolve({ data: [], error: null }));
      b.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      return b;
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function item(
  id: string,
  nome: string,
  quantidade: number,
  valor_unitario: number,
): ItemDevolvido {
  return {
    id,
    order_item_id: `oi-${id}`,
    product_id: `p-${id}`,
    variant_id: null,
    product_name: nome,
    image_url: null,
    quantidade,
    valor_unitario,
    condicao: null,
    reestocar: null,
    reestocado_em: null,
  };
}

function detalhe(
  itens: ItemDevolvido[],
  valor_itens: number,
  valor_frete_ida = 0,
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
    metodo_retorno: "envio_proprio",
    status: "solicitada",
    valor_itens,
    valor_frete_ida,
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
    politica: null,
    created_at: "2026-11-01T12:00:00Z",
    aprovada_em: null,
    postada_em: null,
    recebida_em: null,
    concluida_em: null,
    encerrada_em: null,
    itens,
    eventos: [],
    pedido: null,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
const onCancelar = vi.fn<(id: string) => Promise<Desfecho>>();
const onInformarEnvio =
  vi.fn<(id: string, codigo: string) => Promise<Desfecho>>();

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

async function desenhar(atual: DevolucaoDetalhe) {
  const { DevolucaoDoPedidoCard } = await import(
    "@/components/devolucao/DevolucaoDoPedidoCard"
  );
  await act(async () => {
    raiz.render(
      <DevolucaoDoPedidoCard
        atual={atual}
        anteriores={[]}
        enderecoDaLoja={null}
        horarioDaLoja={null}
        onCancelar={onCancelar}
        onInformarEnvio={onInformarEnvio}
      />,
    );
  });
}

const normal = (texto: string | null | undefined) =>
  (texto ?? "").replace(/\s/g, " ");

function valorDaLinha(comeco: string) {
  const dt = Array.from(hospedeiro.querySelectorAll("dt")).find((d) =>
    d.textContent?.startsWith(comeco),
  );
  return normal(dt?.nextElementSibling?.textContent);
}

const emCentavos = (texto: string) =>
  Number(texto.replace(/[^\d,]/g, "").replace(",", ".")) * 100;

describe("cartão da devolução com cupom: as linhas somam o Valor", () => {
  it("30 x R$ 3,33 com cupom de 10%: a linha mostra R$ 89,91, igual ao Valor", async () => {
    await desenhar(detalhe([item("i-1", "Caneta", 30, 3)], 89.91));
    expect(valorDaLinha("30× Caneta")).toBe("R$ 89,91");
    expect(valorDaLinha("Valor")).toBe("R$ 89,91");
    expect(normal(hospedeiro.textContent)).not.toContain("R$ 90,00");
  });

  it("duas linhas com cupom: o centavo do servidor vai para uma delas e a soma bate com o Valor", async () => {
    await desenhar(
      detalhe(
        [item("i-1", "Camiseta", 3, 49.33), item("i-2", "Meia", 1, 9.87)],
        157.87,
        12.5,
      ),
    );
    const camiseta = valorDaLinha("3× Camiseta");
    const meia = valorDaLinha("1× Meia");
    expect(camiseta).toBe("R$ 148,00");
    expect(meia).toBe("R$ 9,87");
    expect(
      Math.round(
        emCentavos(camiseta) +
          emCentavos(meia) +
          emCentavos(valorDaLinha("Frete de ida")),
      ),
    ).toBe(Math.round(emCentavos(valorDaLinha("Valor"))));
  });

  it("sem cupom a linha continua sendo quantidade x preço", async () => {
    await desenhar(
      detalhe(
        [item("i-1", "Camiseta", 2, 19.99), item("i-2", "Meia", 1, 0.1)],
        40.08,
      ),
    );
    expect(valorDaLinha("2× Camiseta")).toBe("R$ 39,98");
    expect(valorDaLinha("1× Meia")).toBe("R$ 0,10");
    expect(valorDaLinha("Valor")).toBe("R$ 40,08");
  });
});

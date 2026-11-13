// A leitura da ficha da devolução entende o campo `ja_pedido_e_nao_veio` que o
// banco manda em cada item (migration 20261399992000): só `true` vale como
// aviso. Ausente (loja sem a migration), nulo, texto ou número não avisam.
import { describe, expect, it } from "vitest";

import { lerDevolucaoDetalhe } from "@/lib/devolucao";

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  order_item_id: `oi-${id}`,
  product_id: null,
  variant_id: null,
  product_name: "Camiseta",
  image_url: null,
  quantidade: 1,
  valor_unitario: 100,
  condicao: null,
  reestocar: null,
  reestocado_em: null,
  ...extra,
});

const ficha = (itens: unknown[]) => ({
  id: "d-1",
  protocolo: "DV261113-AAAAA",
  order_id: "o-1",
  tipo: "arrependimento",
  motivo: "desisti",
  resolucao_desejada: "reembolso",
  modalidade: "nacional",
  metodo_retorno: "envio_proprio",
  status: "solicitada",
  itens,
  eventos: [],
});

describe("lerDevolucaoDetalhe: o item que já foi pedido e não veio", () => {
  it("só o booleano true vira aviso", () => {
    const lida = lerDevolucaoDetalhe(
      ficha([
        item("a", { ja_pedido_e_nao_veio: true }),
        item("b", { ja_pedido_e_nao_veio: false }),
        item("c"),
        item("d", { ja_pedido_e_nao_veio: null }),
        item("e", { ja_pedido_e_nao_veio: "true" }),
        item("f", { ja_pedido_e_nao_veio: 1 }),
      ]),
    );
    expect(lida?.itens.map((i) => i.ja_pedido_e_nao_veio)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("o resto do item continua sendo lido como antes", () => {
    const lida = lerDevolucaoDetalhe(
      ficha([item("a", { ja_pedido_e_nao_veio: true, condicao: "ausente" })]),
    );
    expect(lida?.itens[0]).toMatchObject({
      id: "a",
      order_item_id: "oi-a",
      quantidade: 1,
      valor_unitario: 100,
      condicao: "ausente",
    });
  });
});

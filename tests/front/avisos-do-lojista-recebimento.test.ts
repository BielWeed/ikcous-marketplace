// O lojista fica sabendo do pedido ENTREGUE, pago na entrega, em que ele ainda
// nao marcou o recebimento (14/10/2026) — a parte da TELA (montarAvisos).
// Enquanto o recebimento nao e marcado o servidor recusa a devolucao da
// cliente; marcar e o ato que destrava, por isso o aviso CONTA no sino.
import { describe, expect, it } from "vitest";

import {
  type EntradaDeAvisos,
  type RecebimentoPorMarcar,
  montarAvisos,
} from "@/utils/avisos-do-lojista";

const VAZIO: EntradaDeAvisos = {
  pedidos: [],
  perguntasPendentes: 0,
  avaliacoes: [],
  produtos: [],
};

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function recebimento(
  extra: Partial<RecebimentoPorMarcar> = {},
): RecebimentoPorMarcar {
  return {
    id: PEDIDO,
    customer_name: "Maria Silva",
    total: 149.9,
    updated_at: "2026-10-12T15:00:00.000Z",
    ...extra,
  };
}

describe("montarAvisos — recebimento por marcar", () => {
  it("vira um aviso curto e leigo, que abre AQUELE pedido em Pedidos e CONTA no cracha", () => {
    const [aviso] = montarAvisos({
      ...VAZIO,
      recebimentosPorMarcar: [recebimento()],
    });

    expect(aviso).toEqual({
      id: `recebimento:${PEDIDO}`,
      tipo: "recebimento",
      titulo:
        "Pedido #4F5A6B de Maria Silva entregue: você já recebeu o pagamento?",
      detalhe: expect.stringContaining(
        "marque para a cliente poder pedir devolução",
      ),
      quando: "2026-10-12T15:00:00.000Z",
      destino: { view: "admin-orders", id: PEDIDO },
      contaNoCracha: true,
    });
    expect(aviso.detalhe).toContain("R$");
    expect(aviso.detalhe).toContain("149,90");
  });

  it("um aviso por pedido, com id proprio", () => {
    const outro = "9a8b7c6d-1111-4222-8333-444455556666";
    const avisos = montarAvisos({
      ...VAZIO,
      recebimentosPorMarcar: [recebimento(), recebimento({ id: outro })],
    });

    expect(avisos.map((a) => a.id).sort()).toEqual(
      [`recebimento:${PEDIDO}`, `recebimento:${outro}`].sort(),
    );
  });

  it("fonte ausente ou vazia: nenhum aviso de recebimento", () => {
    expect(montarAvisos(VAZIO)).toEqual([]);
    expect(montarAvisos({ ...VAZIO, recebimentosPorMarcar: [] })).toEqual([]);
  });

  it("vem depois da devolucao e antes de pergunta, avaliacao e estoque", () => {
    const avisos = montarAvisos({
      ...VAZIO,
      pedidos: [
        {
          id: "p1",
          customer_name: "Joana",
          total: 10,
          created_at: "2026-10-14T10:00:00.000Z",
        },
      ],
      devolucoesSolicitadas: 1,
      perguntasPendentes: 1,
      avaliacoes: [
        {
          id: "a1",
          product_id: "x",
          nomeDoProduto: "Caneta",
          rating: 3,
          created_at: "2026-10-14T09:00:00.000Z",
        },
      ],
      produtos: [
        {
          id: "x",
          name: "Caneta",
          stock: 0,
          estoqueMinimo: null,
          created_at: "2026-10-01T09:00:00.000Z",
        },
      ],
      recebimentosPorMarcar: [recebimento()],
    });

    expect(avisos.map((a) => a.tipo)).toEqual([
      "pedido",
      "devolucao",
      "recebimento",
      "pergunta",
      "avaliacao",
      "estoque",
    ]);
  });

  it("nome da cliente ausente, nulo ou so espacos: titulo sem o 'de ...', sem 'de null' nem 'de  '", () => {
    for (const nome of [null, "", "   "]) {
      const [aviso] = montarAvisos({
        ...VAZIO,
        recebimentosPorMarcar: [recebimento({ customer_name: nome })],
      });

      expect(aviso.titulo).toBe(
        "Pedido #4F5A6B entregue: você já recebeu o pagamento?",
      );
    }
  });

  it("nome com espacos nas pontas e aparado", () => {
    const [aviso] = montarAvisos({
      ...VAZIO,
      recebimentosPorMarcar: [recebimento({ customer_name: "  Joana  " })],
    });

    expect(aviso.titulo).toBe(
      "Pedido #4F5A6B de Joana entregue: você já recebeu o pagamento?",
    );
  });

  it("total ausente nao quebra o titulo nem o detalhe", () => {
    const [aviso] = montarAvisos({
      ...VAZIO,
      recebimentosPorMarcar: [recebimento({ total: null })],
    });

    expect(aviso.titulo).toContain("#4F5A6B");
    expect(aviso.detalhe).toContain("R$");
  });
});

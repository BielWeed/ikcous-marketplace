import {
  avisarVagasDeVisitante,
  contarVagasDeVisitante,
  primeiraPaginaCobreVagasDeVisitante,
  tempoSegurandoEstoque,
} from "@/lib/vagas-de-visitante";
import { describe, expect, it } from "vitest";

const agora = Date.parse("2026-11-20T12:00:00Z");
const pendente = {
  status: "pending",
  paymentMethod: "cash",
  createdAt: "2026-11-17T12:01:00+00:00",
  items: [{ productId: "p1", name: "Item", quantity: 1, price: 10, image: "" }],
} satisfies Parameters<typeof tempoSegurandoEstoque>[0];

describe("vagas de compra sem conta", () => {
  it.each([0, 6, 7, 10])("conta %s vagas e avisa a partir de 7", (n) => {
    const pedidos = Array.from({ length: n }, () => pendente);
    const vagas = contarVagasDeVisitante(pedidos, agora);
    expect(vagas).toBe(n);
    expect(avisarVagasDeVisitante(vagas)).toBe(n >= 7);
  });

  it("respeita o corte estrito de 72 horas, sem depender do fuso", () => {
    expect(contarVagasDeVisitante([pendente], agora)).toBe(1);
    expect(
      contarVagasDeVisitante(
        [
          { ...pendente, createdAt: "2026-11-17T09:00:00-03:00" },
          { ...pendente, createdAt: "2026-11-17T08:59:00-03:00" },
        ],
        agora,
      ),
    ).toBe(0);
  });

  it("exclui cancelado, em preparação, entregue, online e pedido com conta", () => {
    expect(
      contarVagasDeVisitante(
        [
          { ...pendente, status: "cancelled" },
          { ...pendente, status: "processing" },
          { ...pendente, status: "delivered" },
          { ...pendente, paymentMethod: "online" },
          { ...pendente, userId: "cliente-com-conta" },
        ],
        agora,
      ),
    ).toBe(0);
  });

  it("recebimento registrado não libera vaga enquanto a etapa é pendente", () => {
    const recebido = {
      ...pendente,
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: "2026-11-20T11:00:00Z",
    };
    expect(contarVagasDeVisitante([recebido], agora)).toBe(1);
  });

  it("página incompleta só cobre a janela quando alcança o corte", () => {
    const parcial = { pedidos: [pendente], total: 20, agora };
    expect(primeiraPaginaCobreVagasDeVisitante(parcial)).toBe(false);
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        ...parcial,
        pedidos: [pendente, { createdAt: "2026-11-17T12:00:00Z" }],
      }),
    ).toBe(true);
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        ...parcial,
        total: 1,
        inicio: "2026-11-17T12:01:00Z",
      }),
    ).toBe(false);
  });

  it("sem item, não afirma que tem estoque comprometido", () => {
    expect(tempoSegurandoEstoque({ ...pendente, items: [] }, agora)).toBeNull();
  });

  it("o estoque continua comprometido depois de 72 horas", () => {
    expect(
      tempoSegurandoEstoque(
        { ...pendente, createdAt: "2026-11-17T11:59:00Z" },
        agora,
      ),
    ).toBe("3 dias");
  });

  it("expressa o tempo em horas inteiras antes de completar um dia", () => {
    expect(
      tempoSegurandoEstoque(
        { ...pendente, createdAt: "2026-11-20T11:00:00Z" },
        agora,
      ),
    ).toBe("1 hora");
  });
});

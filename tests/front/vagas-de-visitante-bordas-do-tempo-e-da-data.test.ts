// Bordas das vagas de compra sem conta (`src/lib/vagas-de-visitante.ts`) que
// `vagas-de-visitante.test.ts` não segurava: a virada de "horas" para "dias"
// no minuto exato, o pedido recém-criado, pedido sem peça de verdade, data sem
// fuso e o início de busca em cima do corte de 72 horas.
//
// Relógio fixo: todo instante daqui sai de `agora`, nunca de `Date.now()`.
import {
  contarVagasDeVisitante,
  primeiraPaginaCobreVagasDeVisitante,
  tempoSegurandoEstoque,
} from "@/lib/vagas-de-visitante";
import { describe, expect, it } from "vitest";

const HORA = 60 * 60 * 1000;
const agora = Date.parse("2026-11-20T12:00:00Z");

const haHoras = (horas: number): string =>
  new Date(agora - horas * HORA).toISOString();

const item = (quantity: number) => ({
  productId: "p1",
  name: "Item",
  quantity,
  price: 10,
  image: "",
});

const pedidoPendente = (createdAt: string, quantidades: number[] = [1]) =>
  ({
    status: "pending",
    paymentMethod: "cash",
    createdAt,
    items: quantidades.map(item),
  }) satisfies Parameters<typeof tempoSegurandoEstoque>[0];

describe("tempoSegurandoEstoque — a virada de horas para dias", () => {
  // O cartão monta "segurando estoque há {tempo}": "há 0 horas", ao lado de
  // "agora mesmo", parecia defeito. Antes da primeira hora: "menos de 1 hora".
  it("pedido criado agora já segura estoque: 'menos de 1 hora', não some", () => {
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(0)), agora)).toBe(
      "menos de 1 hora",
    );
  });

  it("antes de 1 hora é 'menos de 1 hora'; 1 hora exata é singular", () => {
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(0.99)), agora)).toBe(
      "menos de 1 hora",
    );
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(1)), agora)).toBe(
      "1 hora",
    );
  });

  it("23 horas e 59 minutos ainda são horas; 24 horas exatas já são '1 dia'", () => {
    expect(
      tempoSegurandoEstoque(
        pedidoPendente(new Date(agora - 24 * HORA + 60_000).toISOString()),
        agora,
      ),
    ).toBe("23 horas");
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(24)), agora)).toBe(
      "1 dia",
    );
  });

  it("47 horas são '1 dia' e 48 horas são '2 dias'", () => {
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(47)), agora)).toBe(
      "1 dia",
    );
    expect(tempoSegurandoEstoque(pedidoPendente(haHoras(48)), agora)).toBe(
      "2 dias",
    );
  });
});

describe("tempoSegurandoEstoque — pedido que não segura estoque", () => {
  it("itens todos com quantidade zero não seguram nada", () => {
    expect(
      tempoSegurandoEstoque(pedidoPendente(haHoras(5), [0, 0]), agora),
    ).toBeNull();
  });

  it("basta UM item com quantidade para segurar", () => {
    expect(
      tempoSegurandoEstoque(pedidoPendente(haHoras(5), [0, 2]), agora),
    ).toBe("5 horas");
  });

  it("data sem fuso não é lida como hora do aparelho: sem tempo calculado", () => {
    expect(
      tempoSegurandoEstoque(pedidoPendente("2026-11-20T10:00:00"), agora),
    ).toBeNull();
  });

  it("data ainda no futuro (relógio adiantado) não vira tempo negativo", () => {
    expect(
      tempoSegurandoEstoque(pedidoPendente(haHoras(-2)), agora),
    ).toBeNull();
  });
});

describe("contarVagasDeVisitante — data sem fuso", () => {
  it("pedido com data sem fuso não conta como vaga (o corte seria chute)", () => {
    expect(
      contarVagasDeVisitante(
        [pedidoPendente("2026-11-20T10:00:00"), pedidoPendente(haHoras(1))],
        agora,
      ),
    ).toBe(1);
  });
});

describe("primeiraPaginaCobreVagasDeVisitante — início de busca no corte", () => {
  const corte = agora - 72 * HORA;

  it("busca que começa EXATAMENTE no corte de 72 horas ainda é coberta", () => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [],
        total: 0,
        inicio: new Date(corte).toISOString(),
        agora,
      }),
    ).toBe(true);
  });

  it("busca que começa 1 ms depois do corte não é coberta pela primeira página", () => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [],
        total: 0,
        inicio: new Date(corte + 1).toISOString(),
        agora,
      }),
    ).toBe(false);
  });
});

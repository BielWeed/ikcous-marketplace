// Mais bordas das vagas de compra sem conta (`src/lib/vagas-de-visitante.ts`),
// as que sobraram da caça por mutação:
//   · o limite de vagas é 10 (o mesmo do banco); os outros testes o liam da
//     constante, então 9 ou 11 passariam;
//   · `userId` nulo (como veio do banco, sem passar pelo mapper) também é
//     visitante, e a data com "z" minúsculo tem fuso válido;
//   · início de busca ilegível (ou sem fuso) nunca é "coberto";
//   · total MENOR que a página (total velho) não prova que a página é tudo.
import {
  LIMITE_DE_VAGAS_DE_VISITANTE,
  contarVagasDeVisitante,
  primeiraPaginaCobreVagasDeVisitante,
} from "@/lib/vagas-de-visitante";
import { describe, expect, it } from "vitest";

const HORA = 60 * 60 * 1000;
const agora = Date.parse("2026-11-20T12:00:00Z");
const haHoras = (horas: number) => new Date(agora - horas * HORA).toISOString();

const pedido = (createdAt: string, extra: Record<string, unknown> = {}) =>
  ({
    status: "pending" as const,
    paymentMethod: "cash" as const,
    createdAt,
    ...extra,
  }) as Parameters<typeof contarVagasDeVisitante>[0][number];

describe("limite de vagas de visitante", () => {
  it("o limite é de 10 vagas", () => {
    expect(LIMITE_DE_VAGAS_DE_VISITANTE).toBe(10);
  });
});

describe("contarVagasDeVisitante — formas de dado que o banco entrega", () => {
  it("userId nulo (cru do banco) conta como visitante; userId preenchido não", () => {
    expect(
      contarVagasDeVisitante(
        [
          pedido(haHoras(1), { userId: null }),
          pedido(haHoras(1), { userId: undefined }),
          pedido(haHoras(1), {
            userId: "11111111-1111-4111-8111-111111111111",
          }),
        ],
        agora,
      ),
    ).toBe(2);
  });

  it("data com fuso 'z' minúsculo vale (o fuso é aceito em qualquer caixa)", () => {
    const minusculo = new Date(agora - HORA).toISOString().replace("Z", "z");
    expect(contarVagasDeVisitante([pedido(minusculo)], agora)).toBe(1);
  });

  it("data com fuso em deslocamento (+03:00) vale e é lida no instante certo", () => {
    // 10:00 em +03:00 = 07:00 UTC, 5 h antes de `agora` (12:00 UTC).
    expect(
      contarVagasDeVisitante([pedido("2026-11-20T10:00:00+03:00")], agora),
    ).toBe(1);
    // 6 dias antes: fora das 72 horas.
    expect(
      contarVagasDeVisitante([pedido("2026-11-14T10:00:00+03:00")], agora),
    ).toBe(0);
  });
});

describe("contarVagasDeVisitante — o corte de 72 horas é estrito", () => {
  const corte = agora - 72 * HORA;

  it("pedido criado EXATAMENTE no corte já não conta; 1 ms depois conta", () => {
    expect(
      contarVagasDeVisitante([pedido(new Date(corte).toISOString())], agora),
    ).toBe(0);
    expect(
      contarVagasDeVisitante(
        [pedido(new Date(corte + 1).toISOString())],
        agora,
      ),
    ).toBe(1);
  });
});

describe("primeiraPaginaCobreVagasDeVisitante — início ilegível e total velho", () => {
  it.each([
    ["texto sem sentido", "lixo"],
    ["data sem fuso", "2026-11-01T00:00:00"],
  ])("início %s nunca é coberto", (_nome, inicio) => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [],
        total: 0,
        inicio,
        agora,
      }),
    ).toBe(false);
  });

  it("início bem antes do corte, com a página inteira, é coberto (controle)", () => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [],
        total: 0,
        inicio: "2026-11-01T00:00:00Z",
        agora,
      }),
    ).toBe(true);
  });

  it("página com MAIS pedidos que o total (total velho) e nenhum no corte não é prova", () => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [
          { createdAt: haHoras(1) },
          { createdAt: haHoras(2) },
          { createdAt: haHoras(3) },
        ],
        total: 2,
        agora,
      }),
    ).toBe(false);
  });

  it("página com exatamente o total de pedidos é toda a lista (controle)", () => {
    expect(
      primeiraPaginaCobreVagasDeVisitante({
        pedidos: [{ createdAt: haHoras(1) }, { createdAt: haHoras(2) }],
        total: 2,
        agora,
      }),
    ).toBe(true);
  });
});

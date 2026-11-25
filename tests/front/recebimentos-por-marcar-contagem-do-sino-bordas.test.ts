// O sino de "recebimentos por marcar" (`src/lib/recebimentos-por-marcar.ts`):
// bordas da CONTAGEM e da data de corte que os testes de janela e de aviso não
// seguravam. O banco é falso (um construtor de consulta que só guarda o que
// foi pedido e devolve o que o teste manda).
//
//  - contagem que o banco não devolveu (nula) NÃO vira "0 avisos": a conferência
//    falha em voz alta (o sino mostra "não consegui conferir");
//  - a lista de brindes lida pode passar do total já contado (pedido mexido
//    entre as duas leituras): o crachá nunca fica negativo;
//  - a leitura dos brindes percorre TODAS as páginas (a página cheia de 100 não
//    é a última) e não faz leitura extra quando a contagem já foi toda lida;
//  - desconto e frete nulos valem zero na conta do brinde (a ficha lê assim);
//  - o corte da janela é o início do dia de São Paulo: 23:59:59.999 do dia
//    anterior ainda é o dia anterior.
import {
  TETO_DE_RECEBIMENTOS,
  contarRecebimentosPorMarcar,
  inicioDaJanelaDeRecebimento,
} from "@/lib/recebimentos-por-marcar";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Linha {
  total: number;
  subtotal: number;
  discount: number | null;
  shipping: number | null;
}

interface Resposta {
  data: Linha[] | null;
  count: number | null;
  error: Error | null;
}

interface Contexto {
  cabeca: boolean;
  totalZero: boolean;
  alcance: [number, number] | null;
}

interface Construtor {
  eq(coluna: string, valor: unknown): Construtor;
  or(): Construtor;
  is(): Construtor;
  gte(): Construtor;
  order(): Construtor;
  limit(): Construtor;
  range(de: number, ate: number): Construtor;
  then(
    ok: (resposta: Resposta) => unknown,
    falha?: (erro: unknown) => unknown,
  ): Promise<unknown>;
}

const mocks = vi.hoisted(() => {
  const estado: {
    responder: (contexto: Contexto) => Resposta;
    consultas: Contexto[];
  } = {
    responder: () => ({ data: null, count: null, error: null }),
    consultas: [],
  };

  function consulta(opcoes?: { head?: boolean }): Construtor {
    const contexto: Contexto = {
      cabeca: opcoes?.head === true,
      totalZero: false,
      alcance: null,
    };
    const construtor: Construtor = {
      eq(coluna, valor) {
        if (coluna === "total" && valor === 0) contexto.totalZero = true;
        return construtor;
      },
      or: () => construtor,
      is: () => construtor,
      gte: () => construtor,
      order: () => construtor,
      limit: () => construtor,
      range(de, ate) {
        contexto.alcance = [de, ate];
        return construtor;
      },
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      then(ok, falha) {
        estado.consultas.push({ ...contexto });
        return Promise.resolve(estado.responder(contexto)).then(ok, falha);
      },
    };
    return construtor;
  }

  const fromMock = vi.fn((tabela: string) => {
    if (tabela === "politica_devolucao") {
      const politica = {
        select: () => politica,
        eq: () => politica,
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return politica;
    }
    return {
      select: (_colunas: string, opcoes?: { head?: boolean }) =>
        consulta(opcoes),
    };
  });

  return { estado, fromMock };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.fromMock } }));

const brinde = (parcial: Partial<Linha> = {}): Linha => ({
  total: 0,
  subtotal: 0,
  discount: 0,
  shipping: 0,
  ...parcial,
});

const comBrindes = (quantos: number): Linha[] =>
  Array.from({ length: quantos }, () => brinde());

beforeEach(() => {
  mocks.estado.consultas = [];
  mocks.estado.responder = () => ({ data: null, count: null, error: null });
});

describe("contarRecebimentosPorMarcar — contagem que não chegou", () => {
  it("contagem nula falha em voz alta, nunca vira zero", async () => {
    mocks.estado.responder = () => ({ data: null, count: null, error: null });
    await expect(contarRecebimentosPorMarcar()).rejects.toThrow(
      "Contagem de recebimentos indisponível",
    );
  });

  it("sem pedido nenhum no prazo, o crachá é zero e nenhuma lista é lida", async () => {
    mocks.estado.responder = () => ({ data: null, count: 0, error: null });
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
    expect(mocks.estado.consultas).toHaveLength(1);
  });
});

describe("contarRecebimentosPorMarcar — brindes", () => {
  it("mais brindes lidos que a contagem (pedido mexido no meio): o crachá para em zero", async () => {
    mocks.estado.responder = (contexto) =>
      contexto.cabeca
        ? { data: null, count: 1, error: null }
        : { data: comBrindes(2), count: null, error: null };
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
  });

  it("desconto e frete nulos valem zero: o brinde sem desconto nem frete sai da conta", async () => {
    mocks.estado.responder = (contexto) =>
      contexto.cabeca
        ? { data: null, count: 1, error: null }
        : {
            data: [brinde({ discount: null, shipping: null })],
            count: null,
            error: null,
          };
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
  });

  it("total zero só é brinde quando a conta bate (subtotal - desconto + frete = 0)", async () => {
    mocks.estado.responder = (contexto) =>
      contexto.cabeca
        ? { data: null, count: 1, error: null }
        : {
            data: [brinde({ subtotal: 10, shipping: 5, discount: 15 })],
            count: null,
            error: null,
          };
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
    mocks.estado.responder = (contexto) =>
      contexto.cabeca
        ? { data: null, count: 1, error: null }
        : {
            data: [brinde({ subtotal: 10, shipping: 5, discount: 0 })],
            count: null,
            error: null,
          };
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(1);
  });

  it("percorre todas as páginas de brindes: a página cheia de 100 não é a última", async () => {
    mocks.estado.responder = (contexto) => {
      if (contexto.cabeca) return { data: null, count: 150, error: null };
      const inicio = contexto.alcance?.[0] ?? 0;
      return {
        data: comBrindes(inicio === 0 ? TETO_DE_RECEBIMENTOS : 20),
        count: null,
        error: null,
      };
    };
    // 150 candidatos, 120 brindes (100 + 20): sobram 30 no crachá.
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(30);
    expect(
      mocks.estado.consultas.filter((c) => c.alcance !== null),
    ).toHaveLength(2);
  });

  it("contagem já toda lida: não faz leitura extra de página vazia", async () => {
    mocks.estado.responder = (contexto) =>
      contexto.cabeca
        ? { data: null, count: TETO_DE_RECEBIMENTOS, error: null }
        : { data: comBrindes(TETO_DE_RECEBIMENTOS), count: null, error: null };
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
    expect(
      mocks.estado.consultas.filter((c) => c.alcance !== null),
    ).toHaveLength(1);
  });
});

describe("inicioDaJanelaDeRecebimento — virada do dia em São Paulo", () => {
  const TRINTA_DIAS = 30 * 86_400_000;

  it("23:59:59.999 do dia limite (em SP) ainda é o dia limite", () => {
    // 2026-09-16T02:59:59.999Z = 15/09 23:59:59.999 em São Paulo.
    const instante = Date.parse("2026-09-16T02:59:59.999Z");
    expect(inicioDaJanelaDeRecebimento(instante + TRINTA_DIAS, 30)).toBe(
      "2026-09-15T00:00:00-03:00",
    );
  });

  it("00:00:00.000 do dia seguinte (em SP) já é o dia seguinte", () => {
    const instante = Date.parse("2026-09-16T03:00:00.000Z");
    expect(inicioDaJanelaDeRecebimento(instante + TRINTA_DIAS, 30)).toBe(
      "2026-09-16T00:00:00-03:00",
    );
  });
});

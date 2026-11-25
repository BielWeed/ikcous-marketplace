// Caça por mutação no sino de "recebimentos por marcar" (25/11/2026).
// `src/lib/recebimentos-por-marcar.ts` tinha defeitos de uma linha que nenhum
// teste derrubava. O banco aqui é falso, mas se comporta como o de verdade nos
// pontos que importam: a política de devolução só responde quando a consulta
// pede a linha 1, e cada consulta guarda filtros, ordem, janela e alcance.
//
//   1. a política de devolução é lida da linha `id = 1` (a única que existe);
//   2. prazo de defeito de 1 dia é prazo (só zero cai no teto de 365 dias);
//   3. a lista vem do pedido mexido MAIS RECENTE para o mais antigo, e o
//      desempate é pelo id (quando passa de 100, quem sobra é o mais antigo);
//   4. a segunda página pede exatamente as linhas 100 a 199;
//   5. depois de ler todos os candidatos não há leitura extra no banco;
//   6. a contagem do sino só olha os pedidos de total ZERO para achar brinde,
//      em ordem de id, página a página (100 a 199 na segunda).
// Só fixtures inventadas.
import {
  TETO_DE_RECEBIMENTOS,
  buscarRecebimentosPorMarcar,
  contarRecebimentosPorMarcar,
  inicioDaJanelaDoSino,
} from "@/lib/recebimentos-por-marcar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Linha {
  id: string;
  customer_name: string;
  updated_at: string;
  total: number;
  subtotal: number;
  discount: number | null;
  shipping: number | null;
}

interface Consulta {
  eqs: [string, unknown][];
  ordens: [string, unknown][];
  limite: number | null;
  alcance: [number, number] | null;
  contou: boolean;
  cabeca: boolean;
}

interface Resposta {
  data: Linha[] | null;
  count: number | null;
}

const mocks = vi.hoisted(() => {
  const estado: {
    politica: Record<string, unknown> | null;
    consultas: Consulta[];
    responder: (consulta: Consulta) => Resposta;
  } = {
    politica: null,
    consultas: [],
    responder: () => ({ data: [], count: 0 }),
  };

  const fromMock = vi.fn((tabela: string) => {
    if (tabela === "politica_devolucao") {
      let linhaPedida: unknown = null;
      const politica = {
        select: () => politica,
        eq: (coluna: string, valor: unknown) => {
          if (coluna === "id") linhaPedida = valor;
          return politica;
        },
        // O banco de verdade só tem a linha 1: pedir outra devolve nada.
        maybeSingle: async () => ({
          data: linhaPedida === 1 ? estado.politica : null,
          error: null,
        }),
      };
      return politica;
    }
    return {
      select: (
        _colunas: string,
        opcoes?: { count?: string; head?: boolean },
      ) => {
        const consulta: Consulta = {
          eqs: [],
          ordens: [],
          limite: null,
          alcance: null,
          contou: opcoes?.count === "exact",
          cabeca: opcoes?.head === true,
        };
        const construtor = {
          eq: (coluna: string, valor: unknown) => {
            consulta.eqs.push([coluna, valor]);
            return construtor;
          },
          or: () => construtor,
          is: () => construtor,
          gte: () => construtor,
          order: (coluna: string, opcoesOrdem: unknown) => {
            consulta.ordens.push([coluna, opcoesOrdem]);
            return construtor;
          },
          limit: (n: number) => {
            consulta.limite = n;
            return construtor;
          },
          range: (de: number, ate: number) => {
            consulta.alcance = [de, ate];
            return construtor;
          },
          // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
          then(ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) {
            estado.consultas.push({ ...consulta });
            return Promise.resolve({
              ...estado.responder(consulta),
              error: null,
            }).then(ok, falha);
          },
        };
        return construtor;
      },
    };
  });

  return { estado, fromMock };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.fromMock } }));

const pedido = (n: number, parcial: Partial<Linha> = {}): Linha => ({
  id: `pedido-${n}`,
  customer_name: `Cliente ${n}`,
  updated_at: "2026-11-20T12:00:00Z",
  total: 50,
  subtotal: 50,
  discount: 0,
  shipping: 0,
  ...parcial,
});

const brinde = (n: number): Linha =>
  pedido(n, { total: 0, subtotal: 0, discount: 0, shipping: 0 });

const paginaDe = (
  de: number,
  quantos: number,
  fazer: (n: number) => Linha = pedido,
): Linha[] => Array.from({ length: quantos }, (_, i) => fazer(de + i));

beforeEach(() => {
  mocks.estado.politica = null;
  mocks.estado.consultas = [];
  mocks.estado.responder = () => ({ data: [], count: 0 });
  // 25/11/2026 12:00 em São Paulo (15:00 UTC).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T15:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("início da janela do sino — o prazo vem da linha 1 da política da loja", () => {
  it("política com defeito 30, troca 60 aceita e arrependimento 7: vale o maior (60 dias)", async () => {
    mocks.estado.politica = {
      prazo_vicio_dias: 30,
      prazo_troca_dias: 60,
      prazo_arrependimento_dias: 7,
      aceita_troca: true,
    };
    // 60 dias antes de 25/11/2026 é 26/09/2026.
    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2026-09-26T00:00:00-03:00",
    );
  });

  it("prazo de defeito de 1 dia é 1 dia: o aviso de ontem ainda vale, o de anteontem não", async () => {
    mocks.estado.politica = {
      prazo_vicio_dias: 1,
      prazo_troca_dias: 0,
      prazo_arrependimento_dias: 0,
      aceita_troca: false,
    };
    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2026-11-24T00:00:00-03:00",
    );
  });

  it("prazo de defeito zero não é prazo: cai no teto de 365 dias", async () => {
    mocks.estado.politica = {
      prazo_vicio_dias: 0,
      prazo_troca_dias: 90,
      prazo_arrependimento_dias: 7,
      aceita_troca: true,
    };
    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2025-11-25T00:00:00-03:00",
    );
  });

  it("loja sem política gravada: 365 dias, o lado seguro (o aviso sobra)", async () => {
    mocks.estado.politica = null;
    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2025-11-25T00:00:00-03:00",
    );
  });
});

describe("lista de recebimentos por marcar — ordem, páginas e leitura extra", () => {
  it("pede o pedido mexido mais recente primeiro e desempata pelo id", async () => {
    mocks.estado.responder = () => ({ data: [pedido(1)], count: 1 });
    await buscarRecebimentosPorMarcar();
    expect(mocks.estado.consultas[0]?.ordens).toEqual([
      ["updated_at", { ascending: false }],
      ["id", { ascending: true }],
    ]);
  });

  it("150 candidatos: a segunda página pede as linhas 100 a 199", async () => {
    mocks.estado.responder = (consulta) =>
      consulta.alcance === null
        ? { data: paginaDe(0, TETO_DE_RECEBIMENTOS), count: 150 }
        : { data: paginaDe(TETO_DE_RECEBIMENTOS, 50), count: null };
    const { recebimentos, truncou } = await buscarRecebimentosPorMarcar();

    expect(mocks.estado.consultas).toHaveLength(2);
    expect(mocks.estado.consultas[0]?.limite).toBe(TETO_DE_RECEBIMENTOS);
    expect(mocks.estado.consultas[0]?.alcance).toBeNull();
    expect(mocks.estado.consultas[1]?.alcance).toEqual([100, 199]);
    // 150 avisos reais, mas a tela guarda no máximo 100 e avisa que cortou.
    expect(recebimentos).toHaveLength(TETO_DE_RECEBIMENTOS);
    expect(truncou).toBe(true);
  });

  it("exatamente 100 candidatos: uma leitura só, sem leitura extra e sem corte", async () => {
    mocks.estado.responder = () => ({
      data: paginaDe(0, TETO_DE_RECEBIMENTOS),
      count: 100,
    });
    const { recebimentos, truncou } = await buscarRecebimentosPorMarcar();
    expect(mocks.estado.consultas).toHaveLength(1);
    expect(recebimentos).toHaveLength(100);
    expect(truncou).toBe(false);
  });

  it("60 candidatos: uma leitura só e os 60 avisos, na ordem em que o banco mandou", async () => {
    mocks.estado.responder = () => ({ data: paginaDe(0, 60), count: 60 });
    const { recebimentos, truncou } = await buscarRecebimentosPorMarcar();
    expect(mocks.estado.consultas).toHaveLength(1);
    expect(recebimentos.map((r) => r.id).slice(0, 2)).toEqual([
      "pedido-0",
      "pedido-1",
    ]);
    expect(recebimentos).toHaveLength(60);
    expect(truncou).toBe(false);
  });
});

describe("contagem do sino — só os pedidos de total zero são conferidos como brinde", () => {
  it("150 candidatos, 120 deles brinde: crachá 30; leitura de brindes por id, 0-99 e 100-199", async () => {
    mocks.estado.responder = (consulta) => {
      if (consulta.cabeca) return { data: null, count: 150 };
      return consulta.alcance?.[0] === 0
        ? { data: paginaDe(0, 100, brinde), count: null }
        : { data: paginaDe(100, 20, brinde), count: null };
    };

    await expect(contarRecebimentosPorMarcar()).resolves.toBe(30);

    const leituras = mocks.estado.consultas.filter((c) => !c.cabeca);
    expect(leituras).toHaveLength(2);
    expect(leituras.map((c) => c.alcance)).toEqual([
      [0, 99],
      [100, 199],
    ]);
    for (const leitura of leituras) {
      expect(leitura.eqs).toContainEqual(["total", 0]);
      expect(leitura.ordens).toEqual([["id", { ascending: true }]]);
    }
  });

  it("nenhum candidato: zero, sem sequer ler brindes", async () => {
    mocks.estado.responder = () => ({ data: null, count: 0 });
    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);
    expect(mocks.estado.consultas.filter((c) => !c.cabeca)).toHaveLength(0);
  });
});

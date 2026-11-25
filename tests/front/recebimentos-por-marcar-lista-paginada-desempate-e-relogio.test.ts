// A LISTA e a CONTAGEM do sino de "recebimentos por marcar"
// (`buscarRecebimentosPorMarcar`, `contarRecebimentosPorMarcar`) leem o banco em
// páginas de 100. Caça por mutação (25/11/2026): defeitos de uma linha que
// passavam sem nenhum teste reclamar.
//  - a paginação anda por `range`, então a ordem TEM de ser total: pedidos com o
//    mesmo `updated_at` (atualização em massa) só têm ordem estável se o
//    `id` desempatar, nas MESMAS condições em todas as páginas — senão um
//    pedido aparece duas vezes e outro some entre uma página e a seguinte;
//  - a contagem total vem só na PRIMEIRA consulta (nas seguintes o banco
//    devolve nula): guardar a nula de volta cortava a leitura na segunda
//    página, e um pedido real que só estava na terceira nunca chegava ao sino;
//  - o corte de janela sem argumento usa o relógio de AGORA (não um instante
//    fixo).
// O banco é falso: um construtor de consulta que anota o que foi pedido.
import {
  buscarRecebimentosPorMarcar,
  contarRecebimentosPorMarcar,
  inicioDaJanelaDeRecebimento,
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

interface Pedido {
  contar: boolean;
  ordens: Array<[string, { ascending: boolean }]>;
  de: number;
  ate: number;
}

const mocks = vi.hoisted(() => {
  const estado: {
    linhas: unknown[];
    semDadosNosBrindes: boolean;
    erroNosBrindes: Error | null;
    erroNaContagem: Error | null;
    politica: Record<string, unknown> | null;
    pedidos: Array<{
      contar: boolean;
      ordens: Array<[string, { ascending: boolean }]>;
      de: number;
      ate: number;
    }>;
  } = {
    linhas: [],
    semDadosNosBrindes: false,
    erroNosBrindes: null,
    erroNaContagem: null,
    politica: null,
    pedidos: [],
  };

  function consulta(contar: boolean) {
    const pedido = {
      contar,
      ordens: [] as Array<[string, { ascending: boolean }]>,
      de: 0,
      ate: 0,
    };
    let soTotalZero = false;
    const construtor = {
      eq(coluna: string, valor: unknown) {
        if (coluna === "total" && valor === 0) soTotalZero = true;
        return construtor;
      },
      or: () => construtor,
      is: () => construtor,
      gte: () => construtor,
      order(coluna: string, opcoes: { ascending: boolean }) {
        pedido.ordens.push([coluna, opcoes]);
        return construtor;
      },
      limit(quantos: number) {
        pedido.de = 0;
        pedido.ate = quantos - 1;
        return construtor;
      },
      range(de: number, ate: number) {
        pedido.de = de;
        pedido.ate = ate;
        return construtor;
      },
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      then(
        ok: (resposta: unknown) => unknown,
        falha?: (erro: unknown) => unknown,
      ) {
        estado.pedidos.push({ ...pedido, ordens: [...pedido.ordens] });
        const candidatos = soTotalZero
          ? estado.linhas.filter((l) => (l as { total: number }).total === 0)
          : estado.linhas;
        if (pedido.contar && estado.erroNaContagem) {
          return Promise.resolve({
            data: null,
            count: null,
            error: estado.erroNaContagem,
          }).then(ok, falha);
        }
        if (soTotalZero && estado.erroNosBrindes) {
          return Promise.resolve({
            data: null,
            count: null,
            error: estado.erroNosBrindes,
          }).then(ok, falha);
        }
        return Promise.resolve({
          data:
            soTotalZero && estado.semDadosNosBrindes
              ? null
              : candidatos.slice(pedido.de, pedido.ate + 1),
          count: pedido.contar ? estado.linhas.length : null,
          error: null,
        }).then(ok, falha);
      },
    };
    return construtor;
  }

  const fromMock = vi.fn((tabela: string) => {
    if (tabela === "politica_devolucao") {
      // A política é UMA linha só, a de id 1: a linha certa só responde a esse id.
      let achouALinha = false;
      const politica = {
        select: () => politica,
        eq(coluna: string, valor: unknown) {
          achouALinha = coluna === "id" && valor === 1;
          return politica;
        },
        maybeSingle: async () => ({
          data: achouALinha ? estado.politica : null,
          error: null,
        }),
      };
      return politica;
    }
    return {
      select: (_colunas: string, opcoes?: { count?: string }) =>
        consulta(opcoes?.count === "exact"),
    };
  });

  return { estado, fromMock };
});

vi.mock("@/lib/supabase", () => ({ supabase: { from: mocks.fromMock } }));

const real = (n: number): Linha => ({
  id: `pedido-${String(n).padStart(4, "0")}`,
  customer_name: "Cliente Exemplo",
  updated_at: "2026-11-20T12:00:00.000Z",
  total: 50,
  subtotal: 50,
  discount: 0,
  shipping: 0,
});

const brinde = (n: number): Linha => ({
  ...real(n),
  total: 0,
  subtotal: 0,
});

function ordensDeTodasAsPaginas(): Pedido["ordens"][] {
  return mocks.estado.pedidos.map((p) => p.ordens);
}

beforeEach(() => {
  mocks.estado.linhas = [];
  mocks.estado.semDadosNosBrindes = false;
  mocks.estado.erroNosBrindes = null;
  mocks.estado.erroNaContagem = null;
  mocks.estado.politica = null;
  mocks.estado.pedidos = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buscarRecebimentosPorMarcar: paginação estável", () => {
  it("em toda página a ordem é updated_at decrescente e depois id crescente", async () => {
    mocks.estado.linhas = [
      ...Array.from({ length: 100 }, (_, i) => real(i)),
      ...Array.from({ length: 30 }, (_, i) => real(100 + i)),
    ];

    await buscarRecebimentosPorMarcar();

    expect(mocks.estado.pedidos).toHaveLength(2);
    const esperado = [
      ["updated_at", { ascending: false }],
      ["id", { ascending: true }],
    ];
    for (const ordens of ordensDeTodasAsPaginas()) {
      expect(ordens).toEqual(esperado);
    }
  });

  it("pede a contagem só na primeira página e percorre o alcance sem furo nem repetição", async () => {
    mocks.estado.linhas = [
      ...Array.from({ length: 60 }, (_, i) => real(i)),
      ...Array.from({ length: 170 }, (_, i) => brinde(500 + i)),
    ];

    const r = await buscarRecebimentosPorMarcar();

    expect(mocks.estado.pedidos.map((p) => [p.contar, p.de, p.ate])).toEqual([
      [true, 0, 99],
      [false, 100, 199],
      [false, 200, 299],
    ]);
    expect(r.recebimentos).toHaveLength(60);
    expect(r.truncou).toBe(false);
  });

  it("um pedido real que só aparece na TERCEIRA página ainda chega ao sino", async () => {
    // 200 brindes (total zero, não contam) e, depois deles, 5 pedidos reais.
    mocks.estado.linhas = [
      ...Array.from({ length: 200 }, (_, i) => brinde(i)),
      ...Array.from({ length: 5 }, (_, i) => real(1000 + i)),
    ];

    const r = await buscarRecebimentosPorMarcar();

    expect(r.truncou).toBe(false);
    expect(r.recebimentos.map((p) => p.id)).toEqual([
      "pedido-1000",
      "pedido-1001",
      "pedido-1002",
      "pedido-1003",
      "pedido-1004",
    ]);
  });

  it("100 reais seguidos de brindes: lista cheia, mas sem sinal de corte", async () => {
    mocks.estado.linhas = [
      ...Array.from({ length: 100 }, (_, i) => real(i)),
      ...Array.from({ length: 50 }, (_, i) => brinde(500 + i)),
    ];

    const r = await buscarRecebimentosPorMarcar();

    expect(r.recebimentos).toHaveLength(100);
    expect(r.truncou).toBe(false);
  });

  it("o 101º pedido real marca o corte e a lista fica nos 100 primeiros", async () => {
    mocks.estado.linhas = Array.from({ length: 101 }, (_, i) => real(i));

    const r = await buscarRecebimentosPorMarcar();

    expect(r.truncou).toBe(true);
    expect(r.recebimentos).toHaveLength(100);
    expect(r.recebimentos[0]?.id).toBe("pedido-0000");
    expect(r.recebimentos[99]?.id).toBe("pedido-0099");
  });
});

describe("contarRecebimentosPorMarcar: leitura dos brindes em páginas estáveis", () => {
  it("lê os candidatos de total zero de 100 em 100, ordenados por id crescente", async () => {
    mocks.estado.linhas = Array.from({ length: 230 }, (_, i) => brinde(i));

    await expect(contarRecebimentosPorMarcar()).resolves.toBe(0);

    // a primeira consulta é a contagem (cabeça); as três seguintes, as páginas.
    const paginas = mocks.estado.pedidos.slice(1);
    expect(paginas.map((p) => [p.de, p.ate])).toEqual([
      [0, 99],
      [100, 199],
      [200, 299],
    ]);
    for (const pagina of paginas) {
      expect(pagina.ordens).toEqual([["id", { ascending: true }]]);
    }
  });

  it("erro do banco na contagem sobe com a mensagem DELE, não como 'contagem indisponível'", async () => {
    mocks.estado.erroNaContagem = new Error("banco fora do ar");

    await expect(contarRecebimentosPorMarcar()).rejects.toThrow(
      "banco fora do ar",
    );
  });

  it("erro do banco ao ler os brindes sobe com a mensagem DELE", async () => {
    mocks.estado.linhas = Array.from({ length: 3 }, (_, i) => brinde(i));
    mocks.estado.erroNosBrindes = new Error("leitura dos brindes caiu");

    await expect(contarRecebimentosPorMarcar()).rejects.toThrow(
      "leitura dos brindes caiu",
    );
  });

  it("leitura dos brindes sem dados falha em voz alta, nunca vira crachá errado", async () => {
    mocks.estado.linhas = Array.from({ length: 3 }, (_, i) => real(i));
    mocks.estado.semDadosNosBrindes = true;

    await expect(contarRecebimentosPorMarcar()).rejects.toThrow(
      "Leitura de recebimentos indisponível",
    );
  });

  it("desconta só os brindes: 120 candidatos com 20 de total zero dão 100 no crachá", async () => {
    mocks.estado.linhas = [
      ...Array.from({ length: 20 }, (_, i) => brinde(i)),
      ...Array.from({ length: 100 }, (_, i) => real(100 + i)),
    ];

    await expect(contarRecebimentosPorMarcar()).resolves.toBe(100);
    // 20 brindes cabem numa página só: não existe segunda leitura.
    expect(mocks.estado.pedidos).toHaveLength(2);
  });
});

describe("inicioDaJanelaDoSino: lê a linha ÚNICA da política (id 1)", () => {
  const politica = {
    prazo_vicio_dias: 30,
    prazo_troca_dias: 60,
    prazo_arrependimento_dias: 7,
    aceita_troca: false,
  };

  function hoje(): void {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T15:00:00.000Z"));
  }

  it("usa o prazo da política da loja: 30 dias", async () => {
    hoje();
    mocks.estado.politica = politica;

    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2026-10-26T00:00:00-03:00",
    );
  });

  it("loja que aceita troca usa o maior prazo (60)", async () => {
    hoje();
    mocks.estado.politica = { ...politica, aceita_troca: true };

    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2026-09-26T00:00:00-03:00",
    );
  });

  it("o prazo de arrependimento maior (120) também vale", async () => {
    hoje();
    mocks.estado.politica = { ...politica, prazo_arrependimento_dias: 120 };

    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2026-07-28T00:00:00-03:00",
    );
  });

  it("sem política legível cai nos 365 dias (o teto do banco), nunca em menos", async () => {
    hoje();
    mocks.estado.politica = null;

    await expect(inicioDaJanelaDoSino()).resolves.toBe(
      "2025-11-25T00:00:00-03:00",
    );
  });
});

describe("inicioDaJanelaDeRecebimento: relógio padrão", () => {
  it("sem argumentos usa o dia de hoje (São Paulo) menos 90 dias", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T15:00:00.000Z"));

    expect(inicioDaJanelaDeRecebimento()).toBe("2026-08-27T00:00:00-03:00");
  });

  it("um instante já passado do dia em UTC ainda é o dia anterior em São Paulo", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 01:30 UTC de 26/11 = 22:30 de 25/11 em São Paulo.
    vi.setSystemTime(new Date("2026-11-26T01:30:00.000Z"));

    expect(inicioDaJanelaDeRecebimento()).toBe("2026-08-27T00:00:00-03:00");
  });
});

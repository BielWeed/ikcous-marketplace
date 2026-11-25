// @vitest-environment jsdom
//
// Aba Impostos (Gestão Fiscal) — as LEITURAS: cadastro fiscal, últimas
// alterações, guias lançadas e a série mensal do Resultado. O que prova:
//   L1  loja SEM cadastro (linha ausente, linha ilegível, leitura que falhou, ainda
//       lendo, aba fechada) NÃO dispara nenhuma leitura de `fin_dre`
//   L2  regime sem conta (Simples com serviço, Presumido, Real, "não sei") lê só os
//       meses que a aba pedir (a linha de vendas do caderno, decisão do sócio de
//       25/11/2026); MEI e Simples de só comércio leem um `fin_dre` por mês, na ordem
//   L3  as guias vêm só da categoria de impostos, sem as canceladas, pela competência
//       do período (a guia do dia 1 de um mês que o período só atravessa entra) e
//       com `data_realizacao` (o CSV do contador precisa dela) e com `id`, `descricao`
//       e `conta_id` (a folha de baixa precisa deles para "Pagar" a guia)
//   L4  erro vira frase em português (nunca o texto cru do banco)
//   L5  rede que conecta e não responde estoura em 20 s, em TODAS as leituras
//   L6  "Tentar de novo" e a subida da `versao` leem de novo
//
// O Supabase falso APLICA os filtros (eq/neq/gte/lte), a ordem, o limite e a
// projeção de colunas sobre linhas de verdade: um filtro tirado da produção muda o
// que a tela recebe, não só a lista de chamadas.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, unknown>;

// Leitura de coluna por nome sem indexar com variável (regra de segurança do lint).
const valorDe = (linha: Linha, coluna: string): unknown =>
  Object.entries(linha).find(([nome]) => nome === coluna)?.[1];
interface TabelaFalsa {
  linhas: Linha[];
  erro?: unknown;
  /** A consulta nunca responde (rede pendurada). */
  pendurada?: boolean;
  /** A consulta só responde depois disto. */
  espera?: Promise<void>;
}

const { tabelas, chamadas, rpc } = vi.hoisted(() => ({
  tabelas: new Map<string, TabelaFalsa>(),
  chamadas: [] as Array<{ tabela: string; metodo: string; args: unknown[] }>,
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => {
  const from = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    const ordens: Array<{ coluna: string; cresc: boolean }> = [];
    let colunas: string[] | null = null;
    let limite: number | null = null;
    let uma = false;
    const registrar = (metodo: string, args: unknown[]) =>
      chamadas.push({ tabela, metodo, args });

    const executar = async () => {
      const t = tabelas.get(tabela) ?? { linhas: [] };
      if (t.pendurada) return new Promise<never>(() => {});
      if (t.espera) await t.espera;
      if (t.erro) return { data: null, error: t.erro };
      let linhas = t.linhas.filter((l) => filtros.every((f) => f(l)));
      for (const { coluna, cresc } of [...ordens].reverse()) {
        linhas = [...linhas].sort((a, b) => {
          const x = String(valorDe(a, coluna));
          const y = String(valorDe(b, coluna));
          return (x < y ? -1 : x > y ? 1 : 0) * (cresc ? 1 : -1);
        });
      }
      if (limite !== null) linhas = linhas.slice(0, limite);
      const projetadas = colunas
        ? linhas.map((l) =>
            Object.fromEntries(colunas?.map((c) => [c, valorDe(l, c)]) ?? []),
          )
        : linhas;
      return {
        data: uma ? (projetadas[0] ?? null) : projetadas,
        error: null,
      };
    };

    const construtor = {
      select(cols: string) {
        registrar("select", [cols]);
        colunas =
          cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim());
        return construtor;
      },
      eq(coluna: string, valor: unknown) {
        registrar("eq", [coluna, valor]);
        filtros.push((l) => valorDe(l, coluna) === valor);
        return construtor;
      },
      neq(coluna: string, valor: unknown) {
        registrar("neq", [coluna, valor]);
        filtros.push((l) => valorDe(l, coluna) !== valor);
        return construtor;
      },
      gte(coluna: string, valor: string) {
        registrar("gte", [coluna, valor]);
        filtros.push((l) => String(valorDe(l, coluna)) >= valor);
        return construtor;
      },
      lte(coluna: string, valor: string) {
        registrar("lte", [coluna, valor]);
        filtros.push((l) => String(valorDe(l, coluna)) <= valor);
        return construtor;
      },
      order(coluna: string, opcoes?: { ascending?: boolean }) {
        registrar("order", [coluna, opcoes]);
        ordens.push({ coluna, cresc: opcoes?.ascending !== false });
        return construtor;
      },
      limit(n: number) {
        registrar("limit", [n]);
        limite = n;
        return construtor;
      },
      maybeSingle() {
        registrar("maybeSingle", []);
        uma = true;
        return construtor;
      },
      // O supabase-js devolve um "thenable", não uma Promise.
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase
      then(
        resolver: (v: unknown) => unknown,
        rejeitar?: (e: unknown) => unknown,
      ) {
        return executar().then(resolver, rejeitar);
      },
    };
    return construtor;
  };
  return { supabase: { from: vi.fn(from), rpc } };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));

import {
  type ConsultaFinanceira,
  ContextoDoCacheFinanceiro,
} from "@/hooks/useFinanceiro";
import {
  useCadastroFiscal,
  useGuiasDeImpostos,
  useLogDoCadastroFiscal,
  useSerieDaReceita,
} from "@/hooks/useImpostos";
import {
  AVISO_DO_CADASTRO_ILEGIVEL,
  type LeituraDoCadastroFiscal,
} from "@/lib/fiscal/cadastro";
import { montarCaderno } from "@/lib/fiscal/caderno";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";
import { MENSAGEM_CONEXAO_LENTA } from "@/lib/prazo-da-requisicao";

const PRAZO = 20_000;
const OUTRA_CATEGORIA = "f2000000-0000-4000-8000-0000000000aa";
const MESES = [
  { inicio: "2026-01-01", fim: "2026-01-31" },
  { inicio: "2026-02-01", fim: "2026-02-28" },
  { inicio: "2026-03-01", fim: "2026-03-31" },
] as const;
// Começa no dia 15: a guia de março tem competência no dia 1 e TEM de entrar.
const PERIODO = { inicio: "2026-03-15", fim: "2026-05-31" } as const;

const linhaDoCadastro = (regime: string, atividade: string): Linha => ({
  id: true,
  regime,
  atividade,
  aberta_em: null,
  vende_no_app_desde: null,
  atualizado_em: "2026-11-01T12:00:00Z",
  atualizado_por: "uid-qualquer",
});

const dreDoMes = (inicio: string) => ({
  receita_bruta: 100,
  receita_online: 60,
  receita_balcao: 40,
  deducoes: 0,
  receita_liquida: 100,
  linhas: [],
  // o mês vai junto só para o teste conferir a ordem
  _mes: inicio.slice(0, 7),
});

const guia = (
  categoria: string,
  status: string,
  competencia: string,
  valor: number,
  extra: Linha = {},
): Linha => ({
  categoria_id: categoria,
  id: `guia-${competencia}-${status}-${valor}`,
  descricao: `DAS ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  conta_id: "conta-inventada",
  status,
  data_competencia: competencia,
  data_vencimento: "2026-12-20",
  data_realizacao: null,
  valor,
  // coluna que a consulta NÃO pede: a projeção do falso tem de cortá-la
  observacao: "texto que a aba não lê",
  ...extra,
});

function Sonda({
  usar,
  versao = 0,
}: {
  readonly usar: (versao: number) => ConsultaFinanceira<unknown>;
  readonly versao?: number;
}) {
  const c = usar(versao);
  return (
    <div
      data-sonda=""
      data-carregando={String(c.carregando)}
      data-erro={c.erro ?? ""}
      data-dados={c.dados === null ? "" : JSON.stringify(c.dados)}
    >
      <button type="button" onClick={c.recarregar}>
        Tentar de novo
      </button>
    </div>
  );
}

// A aba de verdade: o cadastro decide se a série do Resultado é lida.
function SondaDaAba({
  meses = MESES,
  ativo = true,
  versao = 0,
}: {
  readonly meses?: typeof MESES;
  readonly ativo?: boolean;
  readonly versao?: number;
}) {
  const cadastro = useCadastroFiscal(ativo, versao);
  const serie = useSerieDaReceita(meses, cadastro.dados, ativo, versao);
  return (
    <div
      data-aba=""
      data-cadastro={cadastro.dados ? cadastro.dados.estado : ""}
      data-serie={serie.dados === null ? "" : JSON.stringify(serie.dados)}
      data-serie-erro={serie.erro ?? ""}
    />
  );
}

const sonda = () =>
  document.querySelector<HTMLElement>("[data-sonda]") as HTMLElement;
const aba = () =>
  document.querySelector<HTMLElement>("[data-aba]") as HTMLElement;
const dadosDaSonda = () => JSON.parse(sonda().dataset.dados ?? "null");
const botao = (rotulo: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.textContent ?? "").replace(/\s+/g, " ").trim() === rotulo,
  );
const leiturasDoDre = () =>
  rpc.mock.calls.filter(([nome]) => nome === "fin_dre");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  tabelas.clear();
  chamadas.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string, args: { p_inicio: string }) => {
    if (nome === "fin_dre")
      return { data: dreDoMes(args.p_inicio), error: null };
    return { data: null, error: { code: "PGRST202", message: "sem função" } };
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const avancar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function montar(
  elemento: React.ReactElement,
  cache: Map<string, unknown> | null = null,
) {
  await act(async () =>
    root.render(
      <ContextoDoCacheFinanceiro.Provider value={cache}>
        {elemento}
      </ContextoDoCacheFinanceiro.Provider>,
    ),
  );
  await avancar(0);
}

// Nomes `useSonda…` para o lint de hooks: cada uma chama UM hook de leitura.
const useSondaCadastro = (v: number) => useCadastroFiscal(true, v);
const useSondaLog = (v: number) => useLogDoCadastroFiscal(true, v);
const useSondaGuias = (v: number) => useGuiasDeImpostos(PERIODO, true, v);
const useSondaSerie = (v: number) =>
  useSerieDaReceita(
    MESES,
    { estado: "com_cadastro", cadastro: cadastroMei },
    true,
    v,
  );
const cadastroMei = {
  regime: "mei",
  atividade: "comercio",
  abertaEm: null,
  vendeNoAppDesde: null,
  atualizadoEm: null,
  atualizadoPor: null,
} as const;

describe("cadastro fiscal — vazio é 'sem cadastro', nunca um regime padrão", () => {
  it("tabela vazia: sem cadastro e SEM aviso (é o estado normal de toda loja nova)", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar(<Sonda usar={useSondaCadastro} />);
    expect(dadosDaSonda()).toEqual({ estado: "sem_cadastro" });
    expect(sonda().dataset.erro).toBe("");
  });

  it("linha de regime que este app não conhece: sem cadastro COM aviso (não chuta regime)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("regime_de_2030", "comercio")],
    });
    await montar(<Sonda usar={useSondaCadastro} />);
    expect(dadosDaSonda()).toEqual({
      estado: "sem_cadastro",
      aviso: AVISO_DO_CADASTRO_ILEGIVEL,
    });
  });

  it("linha válida: devolve o cadastro com os nomes do app", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        {
          ...linhaDoCadastro("simples", "comercio"),
          aberta_em: "2024-05-10",
          vende_no_app_desde: "2025-01-01",
        },
      ],
    });
    await montar(<Sonda usar={useSondaCadastro} />);
    expect(dadosDaSonda()).toMatchObject({
      estado: "com_cadastro",
      cadastro: {
        regime: "simples",
        atividade: "comercio",
        abertaEm: "2024-05-10",
        vendeNoAppDesde: "2025-01-01",
      },
    });
    // lê só as colunas do cadastro, de UMA linha
    const lidas = chamadas.filter((c) => c.tabela === "fiscal_cadastro");
    expect(lidas.map((c) => c.metodo)).toEqual(["select", "maybeSingle"]);
  });
});

describe("últimas alterações do cadastro — as 5 mais recentes", () => {
  it("lê o log do mais novo para o mais antigo, no máximo 5, desempatando pelo id", async () => {
    tabelas.set("fiscal_cadastro_log", {
      linhas: Array.from({ length: 7 }, (_, i) => ({
        id: i + 1,
        quem: "uid-qualquer",
        // as duas últimas no MESMO instante: só o id desempata
        quando: i >= 5 ? "2026-11-07T10:00:00Z" : `2026-11-0${i + 1}T10:00:00Z`,
        antes: null,
        depois: { regime: "mei" },
        extra: "coluna que a aba não pede",
      })),
    });
    await montar(<Sonda usar={useSondaLog} />);
    const lidas = dadosDaSonda() as Array<{ id: number }>;
    expect(lidas.map((l) => l.id)).toEqual([7, 6, 5, 4, 3]);
    expect(Object.keys(lidas[0] ?? {}).sort()).toEqual([
      "antes",
      "depois",
      "id",
      "quando",
      "quem",
    ]);
  });

  it("log vazio: lista vazia", async () => {
    tabelas.set("fiscal_cadastro_log", { linhas: [] });
    await montar(<Sonda usar={useSondaLog} />);
    expect(dadosDaSonda()).toEqual([]);
  });
});

describe("guias — só a categoria de impostos, sem canceladas, pela competência", () => {
  const LINHAS = [
    // entra: competência no último dia do período. Vem PRIMEIRO no banco de propósito:
    // a consulta é que põe as guias em ordem de competência.
    guia(CATEGORIA_DE_IMPOSTOS_ID, "previsto", "2026-05-31", 50),
    // entra: março (o período começa no dia 15, a guia é do dia 1)
    guia(CATEGORIA_DE_IMPOSTOS_ID, "previsto", "2026-03-01", 100),
    // entra: paga em maio, competência abril
    guia(CATEGORIA_DE_IMPOSTOS_ID, "realizado", "2026-04-01", 250, {
      data_realizacao: "2026-05-20",
    }),
    // fora: outra categoria
    guia(OUTRA_CATEGORIA, "previsto", "2026-03-01", 999),
    // fora: cancelada
    guia(CATEGORIA_DE_IMPOSTOS_ID, "cancelado", "2026-04-01", 888),
    // fora: competência antes do mês em que o período começa
    guia(CATEGORIA_DE_IMPOSTOS_ID, "previsto", "2026-02-01", 777),
    // fora: competência depois do fim do período
    guia(CATEGORIA_DE_IMPOSTOS_ID, "previsto", "2026-06-01", 666),
  ];

  it("devolve só as guias vivas da categoria no período, com data_realizacao", async () => {
    tabelas.set("fin_lancamentos", { linhas: LINHAS });
    await montar(<Sonda usar={useSondaGuias} />);
    const lidas = dadosDaSonda() as Array<Record<string, unknown>>;
    expect(lidas.map((l) => l.valor)).toEqual([100, 250, 50]);
    // `data_realizacao` vem (é ela que dá a data do "pago" no arquivo do contador)
    expect(lidas[1]?.data_realizacao).toBe("2026-05-20");
    // e as colunas que a folha de baixa pede para "Pagar" a guia (id, descrição e
    // conta), nada além das pedidas
    expect(Object.keys(lidas[0] ?? {}).sort()).toEqual([
      "conta_id",
      "data_competencia",
      "data_realizacao",
      "data_vencimento",
      "descricao",
      "id",
      "status",
      "valor",
    ]);
  });

  it("o que volta alimenta o caderno: março tem guia mesmo com período começando no dia 15", async () => {
    tabelas.set("fin_lancamentos", { linhas: LINHAS });
    await montar(<Sonda usar={useSondaGuias} />);
    const caderno = montarCaderno(dadosDaSonda(), PERIODO, "2026-06-10");
    expect(caderno.map((m) => [m.mes, m.guia, m.pago])).toEqual([
      ["2026-03", 100, 0],
      ["2026-04", 250, 250],
      ["2026-05", 50, 0],
    ]);
  });

  it("sem período (a tela ainda não escolheu): não lê nada", async () => {
    tabelas.set("fin_lancamentos", { linhas: LINHAS });
    const useSemPeriodo = (v: number) => useGuiasDeImpostos(null, true, v);
    await montar(<Sonda usar={useSemPeriodo} />);
    expect(chamadas).toEqual([]);
    expect(sonda().dataset.carregando).toBe("false");
  });

  it("aba fechada (ativo = false): não lê nada, de nenhuma tabela", async () => {
    tabelas.set("fin_lancamentos", { linhas: LINHAS });
    tabelas.set("fiscal_cadastro", { linhas: [] });
    tabelas.set("fiscal_cadastro_log", { linhas: [] });
    const useFechadaGuias = (v: number) =>
      useGuiasDeImpostos(PERIODO, false, v);
    const useFechadaCadastro = (v: number) => useCadastroFiscal(false, v);
    const useFechadaLog = (v: number) => useLogDoCadastroFiscal(false, v);
    await montar(
      <>
        <Sonda usar={useFechadaGuias} />
        <Sonda usar={useFechadaCadastro} />
        <Sonda usar={useFechadaLog} />
      </>,
    );
    expect(chamadas).toEqual([]);
  });
});

describe("série do Resultado — só quem tem conta dispara a leitura do fin_dre", () => {
  it("loja SEM cadastro: nenhuma leitura do fin_dre (nem depois de muito tempo)", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar(<SondaDaAba />);
    await avancar(PRAZO * 3);
    expect(aba().dataset.cadastro).toBe("sem_cadastro");
    expect(aba().dataset.serie).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("linha ilegível: não lê o fin_dre", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("xyz", "comercio")],
    });
    await montar(<SondaDaAba />);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leitura do cadastro falhou: sem saber o regime, não lê o fin_dre", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [], erro: { code: "42501" } });
    await montar(<SondaDaAba />);
    expect(aba().dataset.cadastro).toBe("");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cadastro ainda sendo lido: espera; só lê o fin_dre depois, e só se o regime tem conta", async () => {
    let liberar: () => void = () => {};
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("mei", "comercio")],
      espera: new Promise<void>((resolver) => {
        liberar = resolver;
      }),
    });
    await montar(<SondaDaAba />);
    await avancar(1_000);
    expect(rpc).not.toHaveBeenCalled();

    await act(async () => liberar());
    await avancar(0);
    expect(leiturasDoDre()).toHaveLength(MESES.length);
  });

  it.each([
    ["mei", "comercio"],
    ["mei", "com_servico"],
    ["simples", "comercio"],
  ])(
    "%s / %s TEM conta: lê o fin_dre de cada mês, na ordem dos meses",
    async (regime, atividade) => {
      tabelas.set("fiscal_cadastro", {
        linhas: [linhaDoCadastro(regime, atividade)],
      });
      await montar(<SondaDaAba />);
      expect(leiturasDoDre().map(([, args]) => args)).toEqual(
        MESES.map((m) => ({ p_inicio: m.inicio, p_fim: m.fim })),
      );
      const serie = JSON.parse(aba().dataset.serie ?? "[]") as unknown[];
      expect(serie).toHaveLength(MESES.length);
      // ordem preservada: a resposta do mês i é a do mês i
      expect(
        serie.map((s) => (s as { receitaOnline: number }).receitaOnline),
      ).toEqual([60, 60, 60]);
      expect(aba().dataset.serieErro).toBe("");
    },
  );

  it.each([
    ["simples", "com_servico"],
    ["presumido", "comercio"],
    ["presumido", "com_servico"],
    ["real", "comercio"],
    ["nao_sei", "comercio"],
  ])(
    "%s / %s NÃO tem conta, mas tem cadastro: lê os meses pedidos (a linha de vendas do caderno), um fin_dre por mês",
    async (regime, atividade) => {
      tabelas.set("fiscal_cadastro", {
        linhas: [linhaDoCadastro(regime, atividade)],
      });
      await montar(<SondaDaAba />);
      await avancar(PRAZO * 2);
      expect(aba().dataset.cadastro).toBe("com_cadastro");
      expect(leiturasDoDre()).toHaveLength(MESES.length);
    },
  );

  it("aba fechada: nem o cadastro nem o fin_dre são lidos, mesmo para quem tem conta", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("mei", "comercio")],
    });
    await montar(<SondaDaAba ativo={false} />);
    expect(chamadas).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("série com a aba fechada (ativo = false) não lê o fin_dre, mesmo com cadastro que tem conta", async () => {
    const useFechada = (v: number) =>
      useSerieDaReceita(
        MESES,
        { estado: "com_cadastro", cadastro: cadastroMei },
        false,
        v,
      );
    await montar(<Sonda usar={useFechada} />);
    expect(rpc).not.toHaveBeenCalled();
    expect(sonda().dataset.carregando).toBe("false");
  });

  it("sem meses para ler: não lê o fin_dre", async () => {
    const SemMeses = () => {
      const s = useSerieDaReceita(
        [],
        { estado: "com_cadastro", cadastro: cadastroMei },
        true,
        0,
      );
      return <i data-aba="" data-serie={JSON.stringify(s.dados)} />;
    };
    await montar(<SemMeses />);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("UM mês só (janeiro) também é lido: o medidor do MEI começa em janeiro", async () => {
    await montar(<Sonda usar={useSondaUmMes} />);
    expect(leiturasDoDre()).toHaveLength(1);
    expect(dadosDaSonda()).toHaveLength(1);
  });

  it("um mês que falha derruba a série inteira com frase (nunca uma série furada)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("mei", "comercio")],
    });
    rpc.mockImplementation(async (_nome: string, args: { p_inicio: string }) =>
      args.p_inicio === "2026-02-01"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: dreDoMes(args.p_inicio), error: null },
    );
    await montar(<SondaDaAba />);
    expect(aba().dataset.serie).toBe("");
    expect(aba().dataset.serieErro).toMatch(/administrador/);
  });
});

const useSondaUmMes = (v: number) =>
  useSerieDaReceita(
    [{ inicio: "2026-01-01", fim: "2026-01-31" }],
    {
      estado: "com_cadastro",
      cadastro: cadastroMei,
    } satisfies LeituraDoCadastroFiscal,
    true,
    v,
  );

describe("erro de leitura vira frase em português", () => {
  // O que "tabela ausente" diz muda com a tabela: o cadastro fiscal é da migration
  // desta frente; as guias vivem em `fin_lancamentos`, que é do Financeiro.
  const LEITURAS: ReadonlyArray<
    readonly [string, (versao: number) => ConsultaFinanceira<unknown>, RegExp]
  > = [
    [
      "fiscal_cadastro",
      useSondaCadastro,
      /cadastro fiscal ainda não foi instalado/,
    ],
    [
      "fiscal_cadastro_log",
      useSondaLog,
      /cadastro fiscal ainda não foi instalado/,
    ],
    ["fin_lancamentos", useSondaGuias, /Financeiro ainda não foi instalado/],
  ];

  describe.each(LEITURAS)("%s", (tabela, usar, naoInstalado) => {
    it.each([
      [
        { code: "42501", message: "permission denied for table x" },
        /administrador/,
      ],
      [
        { code: "PGRST205", message: "Could not find the table 'public.x'" },
        naoInstalado,
      ],
      [{ code: "42P01", message: 'relation "x" does not exist' }, naoInstalado],
      [
        { message: "TypeError: Failed to fetch" },
        /Não consegui falar com o servidor/,
      ],
      [{ code: "XX000", message: "internal error" }, /Algo deu errado/],
    ])("%j", async (erro, esperado) => {
      tabelas.set(tabela, { linhas: [], erro });
      await montar(<Sonda usar={usar} />);
      expect(sonda().dataset.erro).toMatch(esperado);
      expect(sonda().dataset.erro).not.toContain("permission denied");
      expect(sonda().dataset.erro).not.toContain("Could not find");
      expect(sonda().dataset.erro).not.toContain("TypeError");
      expect(sonda().dataset.dados).toBe("");
      expect(sonda().dataset.carregando).toBe("false");
    });
  });

  it("série: o erro do fin_dre vira frase também", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42883", message: "function fin_dre does not exist" },
    });
    await montar(<Sonda usar={useSondaSerie} />);
    expect(sonda().dataset.erro).toMatch(/Financeiro ainda não foi instalado/);
    expect(sonda().dataset.erro).not.toContain("function fin_dre");
  });

  it("resposta fora do formato (fin_dre devolveu lixo): frase, não exceção solta", async () => {
    rpc.mockResolvedValue({ data: "lixo", error: null });
    await montar(<Sonda usar={useSondaSerie} />);
    expect(sonda().dataset.erro).toMatch(/Atualize o app/);
  });
});

describe("rede que conecta e não responde: 20 s e vira erro (todas as leituras)", () => {
  const PENDURADAS: ReadonlyArray<
    readonly [string, (versao: number) => ConsultaFinanceira<unknown>]
  > = [
    ["fiscal_cadastro", useSondaCadastro],
    ["fiscal_cadastro_log", useSondaLog],
    ["fin_lancamentos (guias)", useSondaGuias],
    ["fin_dre (série)", useSondaSerie],
  ];

  it.each(PENDURADAS)("%s", async (_nome, usar) => {
    for (const t of [
      "fiscal_cadastro",
      "fiscal_cadastro_log",
      "fin_lancamentos",
    ]) {
      tabelas.set(t, { linhas: [], pendurada: true });
    }
    rpc.mockImplementation(() => new Promise<never>(() => {}));
    await montar(<Sonda usar={usar} />);

    expect(sonda().dataset.carregando).toBe("true");
    await avancar(PRAZO - 1);
    expect(sonda().dataset.carregando).toBe("true");
    expect(sonda().dataset.erro).toBe("");

    await avancar(1);
    expect(sonda().dataset.carregando).toBe("false");
    expect(sonda().dataset.erro).toBe(MENSAGEM_CONEXAO_LENTA);
    expect(sonda().dataset.dados).toBe("");
  });
});

describe("ler de novo", () => {
  it("'Tentar de novo' depois do erro lê outra vez e limpa o aviso", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [],
      erro: { message: "Failed to fetch" },
    });
    await montar(<Sonda usar={useSondaCadastro} />);
    expect(sonda().dataset.erro).not.toBe("");

    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("mei", "comercio")],
    });
    await act(async () => botao("Tentar de novo")?.click());
    await avancar(0);

    expect(sonda().dataset.erro).toBe("");
    expect(dadosDaSonda()).toMatchObject({ estado: "com_cadastro" });
  });

  it("depois de uma gravação a view sobe a versão: cadastro e série são lidos de novo", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("mei", "comercio")],
    });
    await montar(<SondaDaAba versao={0} />);
    expect(leiturasDoDre()).toHaveLength(MESES.length);

    // o dono trocou para um regime sem conta e a view subiu a versão
    tabelas.set("fiscal_cadastro", {
      linhas: [linhaDoCadastro("presumido", "comercio")],
    });
    await montar(<SondaDaAba versao={1} />);
    expect(aba().dataset.cadastro).toBe("com_cadastro");
    expect(
      chamadas.filter(
        (c) => c.tabela === "fiscal_cadastro" && c.metodo === "select",
      ),
    ).toHaveLength(2);
  });
});

// @vitest-environment jsdom
//
// Aba Impostos MONTADA (Gestão Fiscal, Tarefa 22): o cadastro, o que cada regime tem de
// conta, o caderno das guias e o arquivo para o contador, ligados ao banco falso.
// O que prova:
//   A  loja SEM cadastro: estado vazio, nenhuma estimativa, NENHUMA leitura de `fin_dre`;
//      caderno e arquivo do contador funcionam do mesmo jeito (também com a leitura do
//      cadastro falha)
//   B  MEI: o medidor do limite, com a receita do ano líquida de devoluções, lida mês a
//      mês (de janeiro ao mês atual) do MESMO `fin_dre` do Resultado
//   B2 MEI: o `fin_dre` só enxerga as vendas feitas pelo app, então o medidor só conclui
//      enquadramento ("dentro do limite") quando o app já vendia desde o começo do
//      período medido (1º de janeiro, ou o mês da abertura); senão mostra "vendas pelo
//      IKCOUS no ano" sem veredito (e o alerta de acima do limite, se o número já passou
//      do teto). O aviso fixo "só conta as vendas pelo IKCOUS" vem em todos os casos
//   C  Simples de só comércio: a estimativa do ÚLTIMO MÊS FECHADO (14 meses lidos, o
//      atual fora), com o aviso fixo
//   D  Simples com serviço, Presumido, Real e "Não sei": a frase honesta, sem número,
//      sem ler o `fin_dre`; caderno e arquivo continuam
//   E  ano sem valores conferidos (2027): o núcleo recusa e a tela mostra o aviso
//   F  esqueleto enquanto lê; erro com "Tentar de novo" (guias e receita)
//   G  as guias a pagar chegam ao caderno com id, descrição e conta, SÓ as `previstas` e
//      SÓ no mês da competência; "Pagar" abre a folha de baixa com o objeto certo
//   H  "Lançar a guia deste mês" abre o "Novo lançamento" com o rascunho de `guiaDoMes`
//      (o ano é o da competência; o valor NUNCA é a estimativa)
//   I  a estimativa fica fora do caderno e nunca vira lançamento: só se lê, e a única
//      comparação com a guia usa meses fechados
//   J  o arquivo do contador lê o extrato e as guias do período e CONFERE A SESSÃO antes
//      e depois; falha ou conta diferente = nenhum arquivo
//   K  aba fechada não lê nada; a `versao` relê tudo e muda o que a tela mostra
//
// Fixtures inventadas (nenhum dado de loja). O Supabase falso APLICA filtros, ordem e
// projeção de colunas sobre linhas de verdade.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, unknown>;

const valorDe = (linha: Linha, coluna: string): unknown =>
  Object.entries(linha).find(([nome]) => nome === coluna)?.[1];

interface TabelaFalsa {
  linhas: Linha[];
  erro?: unknown;
  /** A consulta só responde depois disto. */
  espera?: Promise<void>;
}

const { tabelas, chamadas, rpc, getSession, usuario, donoFalso } = vi.hoisted(
  () => ({
    tabelas: new Map<string, TabelaFalsa>(),
    chamadas: [] as Array<{ tabela: string; metodo: string; args: unknown[] }>,
    rpc: vi.fn(),
    getSession: vi.fn(),
    usuario: { atual: null as { id: string } | null },
    donoFalso: {
      souODono: false,
      carregando: false,
      donoId: null,
      leituraFalhou: false,
    },
  }),
);

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
  return {
    supabase: { from: vi.fn(from), rpc, auth: { getSession } },
  };
});
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario.atual }),
}));
vi.mock("@/hooks/useDonoDaLoja", () => ({
  useDonoDaLoja: () => donoFalso,
  limparDonoDaLoja: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { storeLegalDocument: null } }),
}));

import { AbaImpostos } from "@/components/admin/financeiro/impostos/AbaImpostos";
import { AVISO_DA_ESTIMATIVA } from "@/components/admin/financeiro/impostos/AvisoDaEstimativa";
import type { AbrirFolha } from "@/components/admin/financeiro/navegacao";
import { ContextoDoCacheFinanceiro } from "@/hooks/useFinanceiro";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";
import { TEXTOS_DO_MEDIDOR_DO_MEI } from "@/lib/fiscal/textos";

// O aviso fixo do medidor do MEI, palavra por palavra (o pedido do achado de 24/11).
const AVISO_DO_MEDIDOR =
  "Conta só as vendas feitas pelo IKCOUS; vendas por fora do app não entram. Confira o total do ano no seu controle.";

const OUTRA_CATEGORIA = "f2000000-0000-4000-8000-0000000000aa";
const CONTA = "conta-inventada-1";
const HOJE = "2026-11-24";

const cadastroDoBanco = (
  regime: string,
  atividade: string,
  extra: Linha = {},
): Linha => ({
  id: true,
  regime,
  atividade,
  aberta_em: null,
  vende_no_app_desde: "2025-01-01",
  atualizado_em: "2026-11-01T12:00:00Z",
  atualizado_por: "uid-qualquer",
  ...extra,
});

// A receita online de cada mês do `fin_dre` falso; o que não está aqui vale 1000.
const receitaDoMes = new Map<string, number>();
// Devolução (linha derivada "Estornos e devoluções") de cada mês; o resto vale zero.
const devolucaoDoMes = new Map<string, number>();

function dreFalso(inicio: string) {
  const mes = inicio.slice(0, 7);
  const receita = receitaDoMes.get(mes) ?? 1000;
  const devolucao = devolucaoDoMes.get(mes) ?? 0;
  return {
    receita_bruta: receita,
    receita_online: receita,
    receita_balcao: 0,
    deducoes: devolucao,
    receita_liquida: receita - devolucao,
    linhas:
      devolucao > 0
        ? [
            { grupo: "receita", categoria: "Vendas pelo app", valor: receita },
            {
              grupo: "deducao",
              categoria: "Estornos e devoluções",
              valor: devolucao,
            },
          ]
        : [{ grupo: "receita", categoria: "Vendas pelo app", valor: receita }],
  };
}

const guia = (
  id: string,
  status: string,
  competencia: string,
  valor: number,
  extra: Linha = {},
): Linha => ({
  id,
  categoria_id: CATEGORIA_DE_IMPOSTOS_ID,
  descricao: `DAS ${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`,
  conta_id: "conta-do-banco-1",
  status,
  data_competencia: competencia,
  data_vencimento: null,
  data_realizacao: null,
  valor,
  ...extra,
});

const rpcsChamadas = () => rpc.mock.calls.map(([nome]) => String(nome));
const mesesDoDre = () =>
  rpc.mock.calls
    .filter(([nome]) => nome === "fin_dre")
    .map(([, args]) => (args as { p_inicio: string }).p_inicio.slice(0, 7));
const lidasDe = (tabela: string) =>
  chamadas.filter((c) => c.tabela === tabela && c.metodo === "select");

let host: HTMLDivElement;
let root: Root;
const abrirFolha = vi.fn<AbrirFolha>();

const normal = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();
const texto = () => normal(host.textContent);
const botao = (rotulo: string | RegExp) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof rotulo === "string"
      ? normal(b.textContent) === rotulo
      : rotulo.test(normal(b.textContent)),
  );
const porAria = (rotulo: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`);
const secao = (rotulo: string) =>
  host.querySelector<HTMLElement>(`section[aria-label="${rotulo}"]`);

async function esperar() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface OpcoesDeMontagem {
  readonly ativo?: boolean;
  readonly versao?: number;
  readonly hoje?: string;
}

function Aba({ ativo = true, versao = 0, hoje = HOJE }: OpcoesDeMontagem) {
  return (
    <AbaImpostos
      ativo={ativo}
      versao={versao}
      hoje={hoje}
      abrirFolha={abrirFolha}
      aoIrParaMinhaLoja={vi.fn()}
    />
  );
}

async function montar(opcoes: OpcoesDeMontagem = {}) {
  await act(async () =>
    root.render(
      <ContextoDoCacheFinanceiro.Provider value={null}>
        <Aba {...opcoes} />
      </ContextoDoCacheFinanceiro.Provider>,
    ),
  );
  await esperar();
}

beforeEach(() => {
  tabelas.clear();
  chamadas.length = 0;
  receitaDoMes.clear();
  devolucaoDoMes.clear();
  abrirFolha.mockReset();
  usuario.atual = { id: CONTA };
  getSession.mockReset();
  getSession.mockResolvedValue({
    data: { session: { user: { id: CONTA } } },
    error: null,
  });
  rpc.mockReset();
  rpc.mockImplementation(
    async (nome: string, args: { p_inicio: string; p_fim: string }) => {
      if (nome === "fin_dre")
        return { data: dreFalso(args.p_inicio), error: null };
      if (nome === "fin_extrato") return { data: [], error: null };
      return { data: null, error: { code: "PGRST202", message: "sem função" } };
    },
  );
  tabelas.set("fiscal_cadastro_log", { linhas: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe("A — loja sem cadastro fiscal", () => {
  it("mostra 'Configure o regime da sua empresa', nenhuma estimativa e NENHUMA leitura do fin_dre", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar();
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(texto()).not.toContain("Estimativa do app");
    expect(texto()).not.toContain("cerca de");
    expect(texto()).not.toContain("Limite do MEI");
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
    expect(rpcsChamadas()).not.toContain("fin_dre");
  });

  it("o caderno e o arquivo do contador aparecem do mesmo jeito", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar();
    expect(secao("Caderno das guias")).not.toBeNull();
    expect(secao("Arquivo para o contador")).not.toBeNull();
    // um cartão por mês, do mais novo para o mais antigo
    const meses = [...host.querySelectorAll<HTMLElement>("li[data-mes]")].map(
      (li) => li.dataset.mes,
    );
    expect(meses).toEqual(["2026-11", "2026-10", "2026-09"]);
  });

  it("cadastro que o app não entende conta como 'sem cadastro': nada de conta, nada de fin_dre", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("regime_de_2030", "comercio")],
    });
    await montar();
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(rpcsChamadas()).not.toContain("fin_dre");
  });

  it("leitura do cadastro falhou: sem regime não há conta, mas caderno e arquivo seguem", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [],
      erro: { message: "Failed to fetch" },
    });
    await montar();
    expect(texto()).toContain("Não consegui falar com o servidor");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(texto()).not.toContain("Configure o regime da sua empresa");
    expect(rpcsChamadas()).not.toContain("fin_dre");
    expect(secao("Caderno das guias")).not.toBeNull();
    expect(secao("Arquivo para o contador")).not.toBeNull();
  });
});

describe("B — MEI: o medidor do limite", () => {
  beforeEach(() => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
  });

  it("lê um fin_dre por mês de janeiro ao mês atual, na ordem, e mostra o medidor", async () => {
    await montar();
    expect(mesesDoDre()).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(secao("Limite do MEI em 2026")).not.toBeNull();
    // 11 meses x R$ 1.000 = R$ 11.000 de R$ 81.000 = 13,58%: dentro do limite, "13%"
    expect(texto()).toContain("13%");
    expect(texto()).toContain("Dentro do limite");
    expect(texto()).toContain("Limite: R$ 81.000,00");
  });

  it("MEI nunca mostra estimativa do DAS nem o aviso da estimativa", async () => {
    await montar();
    expect(texto()).not.toContain("Estimativa do app");
    expect(texto()).not.toContain("cerca de");
    expect(texto()).not.toContain(AVISO_DA_ESTIMATIVA);
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
  });

  it("a receita do ano é líquida de devoluções (a mesma conta do Resultado)", async () => {
    // R$ 500 devolvidos em novembro: 11.000 - 500 = 10.500 = 12,96% ("12%", e não "13%")
    devolucaoDoMes.set("2026-11", 500);
    await montar();
    expect(texto()).toContain("12%");
    expect(texto()).not.toContain("13%");
    expect(texto()).toContain("Vendas do ano: R$ 10.500,00");
  });

  it("passou do limite: a faixa de excesso aparece (faixa e texto vêm do núcleo)", async () => {
    for (let m = 1; m <= 11; m += 1) {
      receitaDoMes.set(`2026-${String(m).padStart(2, "0")}`, 9000); // 99.000 de 81.000
    }
    await montar();
    expect(texto()).toContain("Passou do limite em mais de 20%");
    expect(texto()).toContain("Fale com o seu contador hoje.");
  });

  it("o aviso fixo do medidor ('só conta as vendas pelo IKCOUS') aparece, e é outro aviso que o da estimativa", async () => {
    await montar();
    expect(texto()).toContain(AVISO_DO_MEDIDOR);
    expect(
      host.querySelector('[role="note"][aria-label="Aviso sobre o medidor"]'),
    ).not.toBeNull();
    expect(texto()).not.toContain(AVISO_DA_ESTIMATIVA);
  });
});

// O `fin_dre` só enxerga as vendas feitas pelo app e devolve ZERO para o que veio antes
// dele. O medidor só conclui enquadramento quando o app já vendia desde o começo do
// período medido (1º de janeiro, ou o mês da abertura); senão mostra o número rotulado,
// sem veredito. A data vem do cadastro fiscal (`vende_no_app_desde`).
describe("B2 — MEI: o número do app só vira veredito se cobre o ano", () => {
  /** Zera o que o `fin_dre` devolve antes do app (jan a mai) e vende `valor` por mês depois. */
  function vendasSoDepoisDe(primeiroMes: number, valor: number) {
    for (let m = 1; m <= 11; m += 1) {
      receitaDoMes.set(
        `2026-${String(m).padStart(2, "0")}`,
        m < primeiroMes ? 0 : valor,
      );
    }
  }
  const mei = (extra: Linha) =>
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio", extra)],
    });
  const semVeredito = () => {
    const t = texto().toLowerCase();
    expect(t).not.toContain("dentro do limite");
    expect(t).not.toContain("nada muda");
    expect(host.querySelector("[data-faixa-titulo]")).toBeNull();
  };
  const avisoFixoPresente = () => expect(texto()).toContain(AVISO_DO_MEDIDOR);

  it("o caso do defeito: R$ 15 mil pelo app, vendas antes dele fora: NÃO diz 'dentro do limite'", async () => {
    // O app vende desde junho (6 meses x R$ 2.500 = R$ 15.000); antes disso o
    // `fin_dre` devolve zero. O real do ano pode ser bem maior (R$ 70 mil por fora).
    vendasSoDepoisDe(6, 2500);
    mei({ vende_no_app_desde: "2026-06-01" });
    await montar();
    expect(texto()).toContain("Vendas pelo IKCOUS no ano");
    expect(texto()).toContain("R$ 15.000,00");
    expect(texto()).not.toMatch(/\d+%/);
    expect(texto()).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio,
    );
    semVeredito();
    avisoFixoPresente();
  });

  it("sem a data de início das vendas pelo app: sem veredito, pede a data e traz o aviso", async () => {
    mei({ vende_no_app_desde: null });
    await montar();
    expect(texto()).toContain("Vendas pelo IKCOUS no ano");
    expect(texto()).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.sem_data_de_inicio,
    );
    semVeredito();
    avisoFixoPresente();
  });

  it("a borda: começou em 1º de janeiro = cobertura completa (veredito); em fevereiro = parcial (sem veredito)", async () => {
    mei({ vende_no_app_desde: "2026-01-01" });
    await montar();
    expect(texto()).toContain("Dentro do limite");
    expect(texto()).not.toContain("Vendas pelo IKCOUS no ano");
    avisoFixoPresente();
    await act(async () => root.unmount());
    root = createRoot(host);

    mei({ vende_no_app_desde: "2026-02-01" });
    await montar();
    expect(texto()).toContain("Vendas pelo IKCOUS no ano");
    semVeredito();
    avisoFixoPresente();
  });

  it("o ano medido é o de hoje: vendia desde 2025 em 2026 = completa; mas virando 2027 o ano é outro (sem conta, com aviso)", async () => {
    mei({ vende_no_app_desde: "2025-06-01" });
    await montar();
    expect(texto()).toContain("Dentro do limite");
    await act(async () => root.unmount());
    root = createRoot(host);

    await montar({ hoje: "2027-03-10" });
    expect(texto()).toContain("ainda não foram conferidos");
    expect(texto()).not.toContain("Dentro do limite");
    avisoFixoPresente();
  });

  it("passou do teto só com as vendas do app e cobertura parcial: alerta de acima do limite, sem a faixa nem o efeito", async () => {
    vendasSoDepoisDe(3, 11_000); // 9 meses x R$ 11.000 = R$ 99.000
    mei({ vende_no_app_desde: "2026-03-01" });
    await montar();
    const alerta = host.querySelector('[role="alert"]');
    expect(alerta?.textContent).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.acimaDoLimiteComCoberturaParcial.titulo,
    );
    expect(texto()).toContain("R$ 99.000,00");
    expect(texto()).not.toContain("Passou do limite em");
    semVeredito();
    avisoFixoPresente();
  });

  it("ano de abertura: abriu em outubro e vende pelo app desde outubro = completa (limite proporcional); desde novembro = parcial", async () => {
    mei({ aberta_em: "2026-10-15", vende_no_app_desde: "2026-10-01" });
    await montar();
    expect(texto()).toContain("Dentro do limite");
    expect(texto()).toContain("Limite: R$ 20.250,00");
    await act(async () => root.unmount());
    root = createRoot(host);

    mei({ aberta_em: "2026-10-15", vende_no_app_desde: "2026-11-01" });
    await montar();
    expect(texto()).toContain("Vendas pelo IKCOUS no ano");
    expect(texto()).toContain("Limite: R$ 20.250,00");
    semVeredito();
    avisoFixoPresente();
  });

  it("empresa aberta em ano anterior: não adianta o início, continua valendo 1º de janeiro", async () => {
    mei({ aberta_em: "2025-03-10", vende_no_app_desde: "2026-03-01" });
    await montar();
    expect(texto()).toContain("Vendas pelo IKCOUS no ano");
    semVeredito();
  });

  it("virou o mês e a série foi relida (versão nova): a cobertura acompanha o cadastro lido", async () => {
    mei({ vende_no_app_desde: "2026-06-01" });
    await montar();
    semVeredito();
    // a lojista informou que vende desde 2025 (cadastro mudou, aba relê)
    mei({ vende_no_app_desde: "2025-01-01" });
    await montar({ versao: 1 });
    expect(texto()).toContain("Dentro do limite");
  });
});

describe("C — Simples de só comércio: a estimativa do último mês fechado", () => {
  beforeEach(() => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
  });

  it("lê 14 meses (set/2025 a out/2026), SEM o mês atual, e mostra 'cerca de R$ 40' com o aviso fixo", async () => {
    await montar();
    const lidos = mesesDoDre();
    expect(lidos).toHaveLength(14);
    expect(lidos[0]).toBe("2025-09");
    expect(lidos.at(-1)).toBe("2026-10");
    expect(lidos).not.toContain("2026-11");

    // R$ 1.000 no mês, RBT12 de R$ 12.000 (1ª faixa, 4%): cerca de R$ 40
    const valor = host.querySelector("[data-estimativa-valor]");
    expect(normal(valor?.textContent)).toBe("cerca de R$ 40");
    expect(texto()).toContain("Estimativa do app");
    expect(texto()).toContain("vendas de outubro de 2026");
    // o aviso fixo vem embaixo de TODA estimativa, palavra por palavra
    expect(texto()).toContain(AVISO_DA_ESTIMATIVA);
    expect(texto()).not.toContain("Limite do MEI");
  });

  it("série curta demais (empresa que começou a vender há pouco): diz quantos meses faltam, sem número", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-06-01",
        }),
      ],
    });
    await montar();
    expect(texto()).toMatch(/Faltam \d+ meses de vendas medidas/);
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
    expect(texto()).not.toContain("cerca de");
    expect(texto()).not.toContain(AVISO_DA_ESTIMATIVA);
  });

  it("sem a data de início das vendas pelo app: pede o dado, não inventa série", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", { vende_no_app_desde: null }),
      ],
    });
    await montar();
    expect(texto()).toContain("em que mês você começou a vender pelo IKCOUS");
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
  });
});

describe("D — regimes sem conta: frase honesta, caderno e arquivo", () => {
  it.each([
    ["simples", "com_servico", "Simples com serviço"],
    ["presumido", "comercio", "Lucro Presumido"],
    ["real", "comercio", "Lucro Real"],
    ["nao_sei", "comercio", "Não sei"],
  ])(
    "%s / %s: 'Ainda não fazemos estimativa', nenhum número, nenhuma leitura de receita",
    async (regime, atividade) => {
      tabelas.set("fiscal_cadastro", {
        linhas: [cadastroDoBanco(regime, atividade)],
      });
      await montar();
      expect(texto()).toContain("Ainda não fazemos estimativa");
      expect(texto()).toContain(
        "Seu caderno de guias e o arquivo para o contador funcionam normalmente.",
      );
      expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
      expect(texto()).not.toContain("cerca de");
      expect(texto()).not.toContain("Limite do MEI");
      expect(texto()).not.toContain(AVISO_DA_ESTIMATIVA);
      expect(rpcsChamadas()).not.toContain("fin_dre");
      expect(secao("Caderno das guias")).not.toBeNull();
      expect(secao("Arquivo para o contador")).not.toBeNull();
    },
  );
});

describe("E — ano sem valores conferidos (2027)", () => {
  it("MEI: o núcleo recusa e a tela mostra o aviso no lugar do número", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    await montar({ hoje: "2027-03-10" });
    expect(texto()).toContain(
      "Temos os valores da lei de 2026; os de 2027 ainda não foram conferidos.",
    );
    expect(texto()).not.toMatch(/\d+% /);
    expect(texto()).not.toContain("Parte do limite que você já usou");
  });

  it("Simples comércio: sem estimativa, com o aviso de que o ano não foi conferido", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
    await montar({ hoje: "2027-03-10" });
    expect(texto()).toContain(
      "Os valores da lei deste ano ainda não foram conferidos",
    );
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
    expect(texto()).not.toContain("cerca de");
  });

  it("virada de ano: em janeiro a estimativa do dezembro FECHADO usa a lei de 2026", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
    await montar({ hoje: "2027-01-12" });
    expect(
      normal(host.querySelector("[data-estimativa-valor]")?.textContent),
    ).toBe("cerca de R$ 40");
    expect(texto()).toContain("vendas de dezembro de 2026");
  });
});

describe("F — esqueleto e erro com 'Tentar de novo'", () => {
  it("enquanto o cadastro e as guias não chegam: esqueleto (nada de estado vazio nem de caderno)", async () => {
    let liberar: () => void = () => {};
    const espera = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    tabelas.set("fiscal_cadastro", { linhas: [], espera });
    tabelas.set("fin_lancamentos", { linhas: [], espera });
    await montar();
    expect(host.querySelectorAll('[aria-busy="true"]').length).toBeGreaterThan(
      0,
    );
    expect(texto()).toContain("Carregando…");
    expect(texto()).not.toContain("Configure o regime da sua empresa");
    expect(host.querySelector("li[data-mes]")).toBeNull();

    await act(async () => liberar());
    await esperar();
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(host.querySelector("li[data-mes]")).not.toBeNull();
  });

  it("guias que não chegam: frase leiga e 'Tentar de novo' que lê outra vez", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    tabelas.set("fin_lancamentos", {
      linhas: [],
      erro: { message: "TypeError: Failed to fetch" },
    });
    await montar();
    expect(texto()).toContain("Não consegui falar com o servidor");
    expect(texto()).not.toContain("TypeError");
    expect(host.querySelector("li[data-mes]")).toBeNull();
    // a aba continua de pé: cadastro e arquivo do contador
    expect(texto()).toContain("Configure o regime da sua empresa");
    expect(secao("Arquivo para o contador")).not.toBeNull();

    tabelas.set("fin_lancamentos", { linhas: [] });
    const antes = lidasDe("fin_lancamentos").length;
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esperar();
    expect(lidasDe("fin_lancamentos").length).toBeGreaterThan(antes);
    expect(host.querySelector("li[data-mes]")).not.toBeNull();
  });

  it("receita que não chega (MEI): frase leiga e 'Tentar de novo' relê o fin_dre", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    rpc.mockImplementation(async (nome: string) =>
      nome === "fin_dre"
        ? { data: null, error: { message: "Failed to fetch" } }
        : { data: [], error: null },
    );
    await montar();
    expect(texto()).toContain("Não consegui falar com o servidor");
    expect(secao("Limite do MEI em 2026")).toBeNull();
    // sem resposta, nada de percentual
    expect(texto()).not.toContain("Parte do limite que você já usou");

    rpc.mockImplementation(async (nome: string, args: { p_inicio: string }) =>
      nome === "fin_dre"
        ? { data: dreFalso(args.p_inicio), error: null }
        : { data: [], error: null },
    );
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esperar();
    expect(texto()).toContain("Parte do limite que você já usou");
  });
});

describe("G — as guias a pagar chegam ao caderno", () => {
  const LINHAS = [
    // a pagar, outubro: entra em "Pagar", com id, descrição e conta do banco
    guia("g-out-a", "previsto", "2026-10-01", 123.45, {
      data_vencimento: "2026-11-20",
      conta_id: "conta-a",
    }),
    guia("g-out-b", "previsto", "2026-10-01", 50, {
      descricao: "DAS 10/2026 (complemento)",
      data_vencimento: "2026-11-25",
      conta_id: "conta-b",
    }),
    // já paga, MESMO mês das duas a pagar: entra no "Pago" e NUNCA vira botão "Pagar"
    guia("g-out-paga", "realizado", "2026-10-01", 20, {
      descricao: "DAS 10/2026 (já paga)",
      data_vencimento: "2026-11-10",
      data_realizacao: "2026-11-09",
    }),
    // já paga, setembro: o caderno mostra "Paga" e NÃO oferece "Pagar"
    guia("g-set", "realizado", "2026-09-01", 80, {
      data_vencimento: "2026-10-20",
      data_realizacao: "2026-10-18",
    }),
    // cancelada: fora
    guia("g-cancelada", "cancelado", "2026-10-01", 999),
    // outra categoria: fora
    guia("g-outra", "previsto", "2026-10-01", 777, {
      categoria_id: OUTRA_CATEGORIA,
    }),
    // competência antes da janela do caderno: fora
    guia("g-velha", "previsto", "2026-07-01", 666),
  ];

  beforeEach(() => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    tabelas.set("fin_lancamentos", { linhas: LINHAS });
  });

  it("'Pagar' só nas guias previstas do mês da competência, com o objeto da folha de baixa", async () => {
    await montar();
    const outubro = host.querySelector<HTMLElement>('li[data-mes="2026-10"]');
    const botoesDePagar = [...(outubro?.querySelectorAll("button") ?? [])]
      .filter((b) => b.textContent === "Pagar")
      .map((b) => b.getAttribute("aria-label"));
    expect(botoesDePagar).toEqual([
      "Pagar DAS 10/2026",
      "Pagar DAS 10/2026 (complemento)",
    ]);
    // setembro (paga) e novembro (sem guia) não oferecem "Pagar"
    for (const mes of ["2026-09", "2026-11"]) {
      const cartao = host.querySelector<HTMLElement>(`li[data-mes="${mes}"]`);
      expect(
        [...(cartao?.querySelectorAll("button") ?? [])].some(
          (b) => b.textContent === "Pagar",
        ),
        mes,
      ).toBe(false);
    }
    // vencimento em 20/11 e hoje é 24/11: vencida
    expect(normal(outubro?.textContent)).toContain("Vencida");
    expect(
      normal(host.querySelector('li[data-mes="2026-09"]')?.textContent),
    ).toContain("Paga");

    await act(async () => {
      porAria("Pagar DAS 10/2026")?.click();
    });
    expect(abrirFolha).toHaveBeenCalledTimes(1);
    expect(abrirFolha).toHaveBeenCalledWith({
      tipo: "baixar",
      alvo: {
        id: "g-out-a",
        descricao: "DAS 10/2026",
        valor: 123.45,
        contaId: "conta-a",
        lado: "saida",
        vencimento: "2026-11-20",
      },
    });

    await act(async () => {
      porAria("Pagar DAS 10/2026 (complemento)")?.click();
    });
    expect(abrirFolha).toHaveBeenLastCalledWith({
      tipo: "baixar",
      alvo: {
        id: "g-out-b",
        descricao: "DAS 10/2026 (complemento)",
        valor: 50,
        contaId: "conta-b",
        lado: "saida",
        vencimento: "2026-11-25",
      },
    });
  });

  it("a soma do mês bate com as guias vivas (123,45 + 50 a pagar e 20 pagos; a cancelada e a de outra categoria não entram)", async () => {
    await montar();
    const outubro = normal(
      host.querySelector('li[data-mes="2026-10"]')?.textContent,
    );
    expect(outubro).toContain("Valor da guiaR$ 193,45");
    expect(outubro).toContain("A pagarR$ 173,45");
    expect(outubro).toContain("PagoR$ 20,00");
    expect(outubro).not.toContain("999");
    expect(outubro).not.toContain("777");
  });

  it("a leitura pede só a categoria de impostos, sem canceladas, de 1º de setembro a 30 de novembro", async () => {
    await montar();
    const filtros = chamadas
      .filter((c) => c.tabela === "fin_lancamentos")
      .map((c) => [c.metodo, ...c.args]);
    expect(filtros).toContainEqual([
      "eq",
      "categoria_id",
      CATEGORIA_DE_IMPOSTOS_ID,
    ]);
    expect(filtros).toContainEqual(["neq", "status", "cancelado"]);
    expect(filtros).toContainEqual(["gte", "data_competencia", "2026-09-01"]);
    expect(filtros).toContainEqual(["lte", "data_competencia", "2026-11-30"]);
  });

  it("guia a pagar de outro mês fica no cartão do SEU mês (competência), não no do vencimento", async () => {
    tabelas.set("fin_lancamentos", {
      linhas: [
        guia("g-nov", "previsto", "2026-11-01", 30, {
          descricao: "DAS 11/2026",
          data_vencimento: "2026-12-21",
        }),
      ],
    });
    await montar();
    const novembro = host.querySelector<HTMLElement>('li[data-mes="2026-11"]');
    expect(porAria("Pagar DAS 11/2026")).not.toBeNull();
    expect(novembro?.contains(porAria("Pagar DAS 11/2026"))).toBe(true);
  });
});

describe("H — 'Lançar a guia deste mês'", () => {
  const MEI = [cadastroDoBanco("mei", "comercio")];

  it("MEI em janeiro de 2027: dezembro de 2026 sai com o DAS fixo (lei de 2026) e janeiro de 2027 sem valor (ano não conferido)", async () => {
    tabelas.set("fiscal_cadastro", { linhas: MEI });
    await montar({ hoje: "2027-01-12" });

    await act(async () => {
      porAria("Lançar a guia deste mês (dezembro de 2026)")?.click();
    });
    expect(abrirFolha).toHaveBeenLastCalledWith({
      tipo: "novo-lancamento",
      inicial: {
        tipo: "saida",
        situacao: "previsto",
        categoriaId: CATEGORIA_DE_IMPOSTOS_ID,
        dataCompetencia: "2026-12-01",
        dataVencimento: "2027-01-20",
        descricao: "DAS 12/2026",
        valor: "82.05",
      },
    });

    await act(async () => {
      porAria("Lançar a guia deste mês (janeiro de 2027)")?.click();
    });
    expect(abrirFolha).toHaveBeenLastCalledWith({
      tipo: "novo-lancamento",
      inicial: {
        tipo: "saida",
        situacao: "previsto",
        categoriaId: CATEGORIA_DE_IMPOSTOS_ID,
        dataCompetencia: "2027-01-01",
        dataVencimento: "2027-02-22",
        descricao: "DAS 01/2027",
        valor: "",
      },
    });
  });

  it("loja sem cadastro: a guia sai pré-preenchida SEM valor", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar();
    await act(async () => {
      porAria("Lançar a guia deste mês (novembro de 2026)")?.click();
    });
    expect(abrirFolha).toHaveBeenCalledTimes(1);
    const chamada = abrirFolha.mock.calls[0]?.[0];
    expect(chamada).toMatchObject({
      tipo: "novo-lancamento",
      inicial: { descricao: "DAS 11/2026", valor: "" },
    });
  });

  it("Simples comércio COM estimativa na tela: o valor da guia continua vazio (a estimativa nunca preenche)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
    await montar();
    expect(
      normal(host.querySelector("[data-estimativa-valor]")?.textContent),
    ).toBe("cerca de R$ 40");
    await act(async () => {
      porAria("Lançar a guia deste mês (outubro de 2026)")?.click();
    });
    const chamada = abrirFolha.mock.calls[0]?.[0];
    expect(chamada).toMatchObject({
      tipo: "novo-lancamento",
      inicial: { descricao: "DAS 10/2026", valor: "" },
    });
  });
});

describe("I — a estimativa fica fora do caderno e nunca vira lançamento", () => {
  beforeEach(() => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
  });

  it("o caderno não mostra a estimativa em valor; só a frase de comparação, com guia lançada", async () => {
    tabelas.set("fin_lancamentos", {
      // guia de outubro de R$ 50 contra estimativa de R$ 40: 20% abaixo
      linhas: [guia("g-out", "previsto", "2026-10-01", 50)],
    });
    await montar();
    const caderno = normal(secao("Caderno das guias")?.textContent);
    expect(caderno).toContain("a estimativa do app ficou 20% abaixo da guia");
    expect(caderno).not.toContain("cerca de");
    expect(caderno).not.toContain("R$ 40");
    expect(abrirFolha).not.toHaveBeenCalled();
  });

  it("sem guia lançada não há comparação", async () => {
    await montar();
    expect(host.querySelector("[data-comparacao-da-estimativa]")).toBeNull();
  });

  it("a aba só LÊ: a única RPC chamada é de leitura e o banco falso nem tem como gravar", async () => {
    tabelas.set("fin_lancamentos", {
      linhas: [guia("g-out", "previsto", "2026-10-01", 50)],
    });
    await montar();
    const permitidas = new Set(["fin_dre", "fin_extrato"]);
    for (const nome of rpcsChamadas()) {
      expect(permitidas.has(nome), nome).toBe(true);
    }
    const metodos = new Set(chamadas.map((c) => c.metodo));
    for (const proibido of ["insert", "update", "upsert", "delete"]) {
      expect(metodos.has(proibido), proibido).toBe(false);
    }
    expect(abrirFolha).not.toHaveBeenCalled();
  });
});

describe("J — arquivo para o contador: lê o período e confere a sessão", () => {
  let arquivos: Blob[];

  beforeEach(() => {
    arquivos = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      arquivos.push(blob);
      return "blob:fake";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    tabelas.set("fiscal_cadastro", { linhas: [] });
    tabelas.set("fin_lancamentos", {
      linhas: [
        guia("g-out", "previsto", "2026-10-01", 50, {
          data_vencimento: "2026-11-20",
        }),
      ],
    });
    rpc.mockImplementation(async (nome: string, args: { p_inicio: string }) => {
      if (nome === "fin_dre")
        return { data: dreFalso(args.p_inicio), error: null };
      if (nome === "fin_extrato") {
        return {
          data: [
            {
              id: "e1",
              origem: "venda_online",
              tipo: "entrada",
              status: "realizado",
              valor: 150,
              data: "2026-10-05",
              descricao: "Pedido de teste",
            },
          ],
          error: null,
        };
      }
      return { data: null, error: { code: "PGRST202" } };
    });
  });

  async function escolher(rotulo: string, valor: string) {
    const label = [...host.querySelectorAll("label")].find(
      (l) => l.textContent === rotulo,
    );
    const select = document.getElementById(
      label?.htmlFor ?? "",
    ) as HTMLSelectElement | null;
    if (!select) throw new Error(`campo não achado: ${rotulo}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )?.set?.call(select, valor);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function lerBlob(blob: Blob): Promise<string> {
    return new Promise((resolver, rejeitar) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result));
      leitor.onerror = () => rejeitar(leitor.error);
      leitor.readAsText(blob);
    });
  }

  const aviso = () =>
    host.querySelector<HTMLElement>("[aria-live]")?.textContent ?? "";
  const chamadasDoExtrato = () =>
    rpc.mock.calls.filter(([nome]) => nome === "fin_extrato");

  async function exportarOMesDeOutubro() {
    await escolher("Mês", "10");
    await escolher("Ano", "2026");
    await act(async () => {
      botao(/Exportar mês/)?.click();
    });
    await esperar();
  }

  it("mês: lê o extrato e as guias do período e baixa o arquivo, depois de conferir a sessão duas vezes", async () => {
    await montar();
    await exportarOMesDeOutubro();
    expect(chamadasDoExtrato()).toEqual([
      ["fin_extrato", { p_inicio: "2026-10-01", p_fim: "2026-10-31" }],
    ]);
    expect(arquivos).toHaveLength(1);
    expect(aviso()).toContain("baixado");
    // antes e depois das leituras
    expect(getSession).toHaveBeenCalledTimes(2);
    const csv = await lerBlob(arquivos[0] as Blob);
    expect(csv).toContain("Receita do dia;05/10/2026");
    expect(csv).toContain("Guia;;10/2026;20/11/2026;50,00");
  });

  it("ano: o período vai de 1º de janeiro a 31 de dezembro", async () => {
    await montar();
    await escolher("Ano", "2026");
    await act(async () => {
      botao(/Exportar ano/)?.click();
    });
    await esperar();
    expect(chamadasDoExtrato()).toEqual([
      ["fin_extrato", { p_inicio: "2026-01-01", p_fim: "2026-12-31" }],
    ]);
    expect(arquivos).toHaveLength(1);
  });

  it("a guia lida para o arquivo é a mesma lei do caderno: categoria de impostos, sem canceladas, pela competência do período", async () => {
    await montar();
    const antes = chamadas.length;
    await exportarOMesDeOutubro();
    const doArquivo = chamadas
      .slice(antes)
      .filter((c) => c.tabela === "fin_lancamentos")
      .map((c) => [c.metodo, ...c.args]);
    expect(doArquivo).toContainEqual([
      "eq",
      "categoria_id",
      CATEGORIA_DE_IMPOSTOS_ID,
    ]);
    expect(doArquivo).toContainEqual(["neq", "status", "cancelado"]);
    expect(doArquivo).toContainEqual(["gte", "data_competencia", "2026-10-01"]);
    expect(doArquivo).toContainEqual(["lte", "data_competencia", "2026-10-31"]);
  });

  it("sessão de OUTRA conta no começo: nada é lido e nenhum arquivo é baixado", async () => {
    await montar();
    getSession.mockResolvedValue({
      data: { session: { user: { id: "outra-conta" } } },
      error: null,
    });
    await exportarOMesDeOutubro();
    expect(arquivos).toHaveLength(0);
    expect(chamadasDoExtrato()).toHaveLength(0);
    expect(aviso()).toContain("nenhum arquivo foi baixado");
  });

  it("a conta troca DURANTE a leitura: o arquivo não sai (a sessão é conferida também depois)", async () => {
    await montar();
    getSession
      .mockResolvedValueOnce({
        data: { session: { user: { id: CONTA } } },
        error: null,
      })
      .mockResolvedValue({
        data: { session: { user: { id: "outra-conta" } } },
        error: null,
      });
    await exportarOMesDeOutubro();
    expect(chamadasDoExtrato()).toHaveLength(1);
    expect(arquivos).toHaveLength(0);
    expect(aviso()).toContain("nenhum arquivo foi baixado");
  });

  it("sessão ausente (acabou) ou que não dá para ler: nenhum arquivo", async () => {
    await montar();
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await exportarOMesDeOutubro();
    expect(arquivos).toHaveLength(0);

    getSession.mockRejectedValue(new Error("falhou"));
    await act(async () => {
      botao(/Tentar de novo/)?.click();
    });
    await esperar();
    expect(arquivos).toHaveLength(0);
  });

  it("sem conta logada no aparelho: nenhum arquivo e nenhuma leitura", async () => {
    usuario.atual = null;
    await montar();
    await exportarOMesDeOutubro();
    expect(arquivos).toHaveLength(0);
    expect(chamadasDoExtrato()).toHaveLength(0);
    expect(aviso()).toContain("nenhum arquivo foi baixado");
  });

  it("o extrato falha: nenhum arquivo parcial (mesmo com as guias lidas)", async () => {
    await montar();
    rpc.mockImplementation(async (nome: string, args: { p_inicio: string }) =>
      nome === "fin_extrato"
        ? { data: null, error: { code: "XX000", message: "interno" } }
        : { data: dreFalso(args.p_inicio), error: null },
    );
    await exportarOMesDeOutubro();
    expect(arquivos).toHaveLength(0);
    expect(aviso()).toContain("nenhum arquivo foi baixado");
  });

  it("as guias falham: nenhum arquivo parcial (mesmo com o extrato lido)", async () => {
    await montar();
    tabelas.set("fin_lancamentos", {
      linhas: [],
      erro: { code: "XX000", message: "interno" },
    });
    await exportarOMesDeOutubro();
    expect(chamadasDoExtrato()).toHaveLength(1);
    expect(arquivos).toHaveLength(0);
    expect(aviso()).toContain("nenhum arquivo foi baixado");
  });
});

describe("K — aba fechada e versão", () => {
  it("aba fechada (ativo = false): nenhuma leitura, de nenhuma tabela nem RPC", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    tabelas.set("fin_lancamentos", { linhas: [] });
    await montar({ ativo: false });
    expect(chamadas).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("a `versao` relê tudo: o regime muda e o que a tela mostra muda junto", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    await montar();
    expect(secao("Limite do MEI em 2026")).not.toBeNull();
    const leiturasDoDre = mesesDoDre().length;

    // o dono trocou para um regime sem conta e a view subiu a versão
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("presumido", "comercio")],
    });
    await montar({ versao: 1 });
    expect(secao("Limite do MEI em 2026")).toBeNull();
    expect(texto()).toContain("Ainda não fazemos estimativa");

    // Quem deixou de ter conta não paga leitura da receita nas releituras seguintes
    // (na do próprio aviso de mudança a série ainda via o cadastro antigo, uma vez).
    const depoisDaMudanca = mesesDoDre().length;
    expect(depoisDaMudanca).toBeLessThanOrEqual(leiturasDoDre * 2);
    await montar({ versao: 2 });
    await montar({ versao: 3 });
    expect(mesesDoDre()).toHaveLength(depoisDaMudanca);
  });

  it("de sem cadastro para MEI: o medidor aparece e a receita passa a ser lida", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar();
    expect(rpcsChamadas()).not.toContain("fin_dre");

    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    await montar({ versao: 1 });
    expect(secao("Limite do MEI em 2026")).not.toBeNull();
    expect(mesesDoDre()).toHaveLength(11);
    expect(texto()).not.toContain("Configure o regime da sua empresa");
  });
});

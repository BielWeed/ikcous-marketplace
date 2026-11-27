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
//   B2 MEI: o `fin_dre` só enxerga as vendas registradas no app, então o número é sempre
//      um mínimo. O medidor só mostra as faixas ("Pelo que o app registrou, ...")
//      quando o app já registrava desde o começo do período medido (1º de janeiro, ou o
//      mês da abertura); senão mostra "vendas registradas no app neste ano" sem
//      veredito (e o alerta de acima do limite, se o número já passou do teto). O aviso
//      fixo ("lançamento à mão e venda fora do app também contam") vem em toda tela COM
//      número e não vem nas telas sem número (ano não conferido)
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
//   L  cada mês do caderno mostra "Vendas registradas no app (menos devoluções): R$ X", o
//      MESMO número do Resultado, para TODOS os regimes com cadastro (decisão do sócio,
//      25/11/2026); sem cadastro nada é lido; leitura que falha não vira "R$ 0,00"
//   M  janeiro de 2027: o medidor do MEI mostra "2026 fechado" com o limite de 2026 (31/12 é
//      o medidor normal, 01/02 volta ao aviso de ano não conferido)
//   N  Simples com poucos meses de vendas no app: a estimativa sai a partir de 2 meses, com
//      a frase dos meses; a comparação com a guia avisa o lado do erro (abaixo)
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

import { escolherNaLista } from "./helpers/lista-de-escolha";

// O aviso fixo do medidor do MEI (só nas telas COM número), palavra por palavra.
const AVISO_DO_MEDIDOR =
  "Este número só tem as vendas feitas pelo app (pedidos e balcão). Os lançamentos feitos à mão no Financeiro (mesmo na categoria Vendas) não entram, nem o que você vendeu sem registrar aqui (Instagram, WhatsApp, feira). Tudo isso também conta para o limite do MEI: some por sua conta.";
// Os títulos do ano COMPLETO: o número é um mínimo, então tudo começa com o prefixo.
const DENTRO = "Pelo que o app registrou, você está dentro do limite";
const ACIMA_20 =
  "Pelo que o app registrou, você passou do limite em mais de 20%";

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
    expect(texto()).toContain(DENTRO);
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
    expect(texto()).toContain("Vendas registradas no app: R$ 10.500,00");
  });

  it("passou do limite: a faixa de excesso aparece (faixa e texto vêm do núcleo)", async () => {
    for (let m = 1; m <= 11; m += 1) {
      receitaDoMes.set(`2026-${String(m).padStart(2, "0")}`, 9000); // 99.000 de 81.000
    }
    await montar();
    expect(texto()).toContain(ACIMA_20);
    expect(texto()).toContain("Fale com o seu contador hoje.");
  });

  it("o aviso fixo do medidor ('só conta as vendas pelo app') aparece, e é outro aviso que o da estimativa", async () => {
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
    expect(texto()).toContain("Vendas registradas no app neste ano");
    expect(texto()).toContain("R$ 15.000,00");
    expect(texto()).not.toMatch(/\d+%/);
    expect(texto()).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.comecou_depois_do_inicio(
        "2026-06-01",
      ),
    );
    expect(texto()).toContain("a partir de junho");
    semVeredito();
    avisoFixoPresente();
  });

  it("sem a data de início das vendas pelo app: sem veredito, pede a data e traz o aviso", async () => {
    mei({ vende_no_app_desde: null });
    await montar();
    expect(texto()).toContain("Vendas registradas no app neste ano");
    expect(texto()).toContain(
      TEXTOS_DO_MEDIDOR_DO_MEI.semVeredito.sem_data_de_inicio,
    );
    semVeredito();
    avisoFixoPresente();
  });

  it("a borda: começou em 1º de janeiro = cobertura completa (veredito); em fevereiro = parcial (sem veredito)", async () => {
    mei({ vende_no_app_desde: "2026-01-01" });
    await montar();
    expect(texto()).toContain(DENTRO);
    expect(texto()).not.toContain("Vendas registradas no app neste ano");
    avisoFixoPresente();
    await act(async () => root.unmount());
    root = createRoot(host);

    mei({ vende_no_app_desde: "2026-02-01" });
    await montar();
    expect(texto()).toContain("Vendas registradas no app neste ano");
    semVeredito();
    avisoFixoPresente();
  });

  it("o ano medido é o de hoje: vendia desde 2025 em 2026 = completa; mas virando 2027 o ano é outro (sem conta, sem o aviso fixo)", async () => {
    mei({ vende_no_app_desde: "2025-06-01" });
    await montar();
    expect(texto()).toContain(DENTRO);
    await act(async () => root.unmount());
    root = createRoot(host);

    await montar({ hoje: "2027-03-10" });
    expect(texto()).toContain("ainda não foram conferidos");
    expect(texto()).not.toContain(DENTRO);
    // tela SEM número: vale só a instrução dela, sem o aviso fixo
    expect(texto()).not.toContain(AVISO_DO_MEDIDOR);
    expect(
      host.querySelector('[role="note"][aria-label="Aviso sobre o medidor"]'),
    ).toBeNull();
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
    expect(texto()).not.toContain("passou do limite em");
    semVeredito();
    avisoFixoPresente();
  });

  it("ano de abertura: abriu em outubro e vende pelo app desde outubro = completa (limite proporcional); desde novembro = parcial", async () => {
    mei({ aberta_em: "2026-10-15", vende_no_app_desde: "2026-10-01" });
    await montar();
    expect(texto()).toContain(DENTRO);
    expect(texto()).toContain("Limite: R$ 20.250,00");
    await act(async () => root.unmount());
    root = createRoot(host);

    mei({ aberta_em: "2026-10-15", vende_no_app_desde: "2026-11-01" });
    await montar();
    expect(texto()).toContain("Vendas registradas no app neste ano");
    expect(texto()).toContain("Limite: R$ 20.250,00");
    semVeredito();
    avisoFixoPresente();
  });

  it("empresa aberta em ano anterior: não adianta o início, continua valendo 1º de janeiro", async () => {
    mei({ aberta_em: "2025-03-10", vende_no_app_desde: "2026-03-01" });
    await montar();
    expect(texto()).toContain("Vendas registradas no app neste ano");
    semVeredito();
  });

  it("virou o mês e a série foi relida (versão nova): a cobertura acompanha o cadastro lido", async () => {
    mei({ vende_no_app_desde: "2026-06-01" });
    await montar();
    semVeredito();
    // a lojista informou que vende desde 2025 (cadastro mudou, aba relê)
    mei({ vende_no_app_desde: "2025-01-01" });
    await montar({ versao: 1 });
    expect(texto()).toContain(DENTRO);
  });
});

describe("C — Simples de só comércio: a estimativa do último mês fechado", () => {
  beforeEach(() => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
  });

  it("lê 15 meses (set/2025 a nov/2026): o mês atual entra SÓ para a linha de vendas do caderno, e a estimativa é a de outubro, o último mês fechado", async () => {
    await montar();
    const lidos = mesesDoDre();
    expect(lidos).toHaveLength(15);
    expect(lidos[0]).toBe("2025-09");
    expect(lidos.at(-1)).toBe("2026-11");

    // R$ 1.000 no mês, RBT12 de R$ 12.000 (1ª faixa, 4%): cerca de R$ 40
    const valor = host.querySelector("[data-estimativa-valor]");
    expect(normal(valor?.textContent)).toBe("cerca de R$ 40");
    expect(texto()).toContain("Estimativa do app");
    expect(texto()).toContain("vendas de outubro de 2026");
    // 12 meses completos: sem o rótulo nem a frase de "poucos meses"
    expect(texto()).not.toContain("deduzida pela média");
    // o aviso fixo vem embaixo de TODA estimativa, palavra por palavra
    expect(texto()).toContain(AVISO_DA_ESTIMATIVA);
    expect(texto()).not.toContain("Limite do MEI");
  });

  it("o mês atual (pela metade) NUNCA ganha estimativa para comparar com a guia, mesmo agora que a receita dele é lida", async () => {
    tabelas.set("fin_lancamentos", {
      linhas: [
        guia("g-out", "previsto", "2026-10-01", 50),
        // guia do mês atual: se o mês atual tivesse estimativa, entraria na média
        guia("g-nov", "previsto", "2026-11-01", 400),
      ],
    });
    await montar();
    const frase = normal(
      host.querySelector("[data-comparacao-da-estimativa]")?.textContent,
    );
    // só outubro (R$ 40 contra R$ 50 = 20% abaixo): "a última guia", e não "as 2 últimas"
    expect(frase).toContain(
      "Na última guia lançada, a estimativa do app ficou 20% abaixo da guia.",
    );
  });

  it("empresa que começou a vender há 4 meses: estima pela média dos 4 meses, com o rótulo e a frase dos meses (decisão do sócio, 25/11/2026)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-06-01",
        }),
      ],
    });
    await montar();
    // Outubro: o app mediu jun, jul, ago e set (4 x R$ 1.000): média 1.000 x 12 = 12.000 (4%)
    expect(
      normal(host.querySelector("[data-estimativa-valor]")?.textContent),
    ).toBe("cerca de R$ 40");
    expect(texto()).toContain("Estimativa do app (de 4 meses de vendas)");
    expect(texto()).toContain(
      "Com 4 meses de vendas no app, a faixa foi deduzida pela média. Se a empresa vendia antes por fora, a guia pode vir maior.",
    );
    // o aviso fixo continua embaixo
    expect(texto()).toContain(AVISO_DA_ESTIMATIVA);
  });

  it("com 1 mês medido (começou a vender em setembro): estima com o rótulo e a frase no singular (decisão do sócio, 25/11/2026)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-09-01",
        }),
      ],
    });
    await montar();
    // Outubro: o app mediu só setembro (R$ 1.000): x 12 = 12.000 (4%): 4% de 1.000 = 40.
    expect(
      normal(host.querySelector("[data-estimativa-valor]")?.textContent),
    ).toBe("cerca de R$ 40");
    expect(texto()).toContain("Estimativa do app (de 1 mês de vendas)");
    expect(texto()).toContain(
      "Com 1 mês de vendas no app, a faixa foi deduzida pela média. Se a empresa vendia antes por fora, a guia pode vir maior.",
    );
    expect(texto()).not.toContain("1 meses");
    expect(texto()).not.toContain("Falta 1 mês");
    expect(texto()).toContain(AVISO_DA_ESTIMATIVA);
  });

  it("com 0 meses medidos (começou a vender em outubro): falta 1 mês, sem número", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-10-01",
        }),
      ],
    });
    await montar();
    expect(texto()).toContain(
      "Falta 1 mês de vendas registradas no app para estimar o DAS.",
    );
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
    expect(texto()).not.toContain("cerca de");
  });

  it("sem a data de início das vendas pelo app: pede o dado, não inventa série", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", { vende_no_app_desde: null }),
      ],
    });
    await montar();
    expect(texto()).toContain("em que mês você começou a vender pelo app");
    expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
  });

  it("outubro com venda e devolução do mesmo tamanho: diz que as devoluções igualaram as vendas, nunca 'Sem vendas neste mês'", async () => {
    devolucaoDoMes.set("2026-10", 1000);
    await montar();
    const valor = normal(
      host.querySelector("[data-estimativa-valor]")?.textContent,
    );
    expect(valor).toBe(
      "As devoluções deste mês igualaram ou passaram as vendas, então não há imposto estimado.",
    );
    expect(texto()).not.toContain("Sem vendas neste mês");
  });

  it("outubro sem venda nenhuma: 'Sem vendas neste mês'", async () => {
    receitaDoMes.set("2026-10", 0);
    await montar();
    expect(
      normal(host.querySelector("[data-estimativa-valor]")?.textContent),
    ).toBe("Sem vendas neste mês");
  });

  it("1 mês medido acima do teto: a frase fala da projeção pela média, não dos últimos 12 meses", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-09-01",
        }),
      ],
    });
    receitaDoMes.set("2026-09", 500_000);
    await montar();
    expect(texto()).toContain(
      "Pela média dos meses registrados no app, a projeção de 12 meses passa do teto do Simples Nacional.",
    );
    expect(texto()).not.toContain("últimos 12 meses");
  });
});

describe("D — regimes sem conta: frase honesta, caderno e arquivo", () => {
  it.each([
    ["simples", "com_servico", "Simples com serviço"],
    ["presumido", "comercio", "Lucro Presumido"],
    ["real", "comercio", "Lucro Real"],
    ["nao_sei", "comercio", "Não sei"],
  ])(
    "%s / %s: 'Ainda não fazemos estimativa', nenhum número de imposto, e só os 3 meses do caderno lidos (a linha de vendas)",
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
      expect(mesesDoDre()).toEqual(["2026-09", "2026-10", "2026-11"]);
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
    expect(texto()).not.toContain(
      "Parte do limite usada pelas vendas registradas no app",
    );
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
    expect(texto()).not.toContain(
      "Parte do limite usada pelas vendas registradas no app",
    );

    rpc.mockImplementation(async (nome: string, args: { p_inicio: string }) =>
      nome === "fin_dre"
        ? { data: dreFalso(args.p_inicio), error: null }
        : { data: [], error: null },
    );
    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esperar();
    expect(texto()).toContain(
      "Parte do limite usada pelas vendas registradas no app",
    );
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

  // O seletor de ano lista o ano atual e os 5 anteriores pelo relógio de verdade
  // (a aba monta o arquivo sem `agora`); estes testes escolhem 2026. Só o Date
  // fica falso, no mesmo dia de HOJE: temporizadores e o waitFor seguem reais.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${HOJE}T12:00:00-03:00`));
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

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Escolhe na lista como a lojista e espera a lista fechar (o foco volta depois). */
  async function escolher(rotulo: string, valor: string) {
    const label = [...host.querySelectorAll("label")].find(
      (l) => l.textContent === rotulo,
    );
    if (!label?.htmlFor) throw new Error(`campo não achado: ${rotulo}`);
    const id = label.htmlFor;
    await act(async () => {
      escolherNaLista(id, valor);
    });
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
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

    // Quem deixou de ter conta lê só os 3 meses do caderno (a linha de vendas de cada mês),
    // e cada versão nova relê exatamente esses 3: nunca a série longa do MEI.
    const antes = mesesDoDre().length;
    await montar({ versao: 2 });
    expect(mesesDoDre().slice(antes)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    const depoisDaVersao2 = mesesDoDre().length;
    await montar({ versao: 3 });
    expect(mesesDoDre().slice(depoisDaVersao2)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(leiturasDoDre).toBeGreaterThan(0);
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

describe("L — vendas registradas no app, em cada mês do caderno", () => {
  const ROTULO = "Vendas registradas no app (menos devoluções):";
  const linhaDe = (mes: string) =>
    normal(
      host.querySelector(`li[data-mes="${mes}"] [data-vendas-do-mes]`)
        ?.textContent,
    );

  beforeEach(() => {
    receitaDoMes.set("2026-09", 1111);
    receitaDoMes.set("2026-10", 2222);
    receitaDoMes.set("2026-11", 3333);
    // outubro devolveu R$ 222: o número do mês é líquido (o mesmo do Resultado)
    devolucaoDoMes.set("2026-10", 222);
  });

  it.each([
    ["mei", "comercio"],
    ["simples", "comercio"],
    ["simples", "com_servico"],
    ["presumido", "comercio"],
    ["real", "comercio"],
    ["nao_sei", "comercio"],
  ])(
    "%s / %s: os 3 meses do caderno mostram as vendas líquidas de devoluções",
    async (regime, atividade) => {
      tabelas.set("fiscal_cadastro", {
        linhas: [cadastroDoBanco(regime, atividade)],
      });
      await montar();
      expect(linhaDe("2026-11")).toBe(`${ROTULO} R$ 3.333,00`);
      expect(linhaDe("2026-10")).toBe(`${ROTULO} R$ 2.000,00`);
      expect(linhaDe("2026-09")).toBe(`${ROTULO} R$ 1.111,00`);
    },
  );

  it("a linha mora fora do quadro de valores da guia: Valor da guia, A pagar e Pago continuam sendo só os três", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("presumido", "comercio")],
    });
    tabelas.set("fin_lancamentos", {
      linhas: [guia("g-out", "previsto", "2026-10-01", 50)],
    });
    await montar();
    const cartao = host.querySelector<HTMLElement>('li[data-mes="2026-10"]');
    const rotulos = [...(cartao?.querySelectorAll("dt") ?? [])].map((dt) =>
      normal(dt.textContent),
    );
    expect(rotulos).toEqual(["Valor da guia", "A pagar", "Pago"]);
    expect(cartao?.querySelector("dl")?.textContent).not.toContain("Vendas");
  });

  it.each([
    ["presumido", "comercio"],
    ["real", "comercio"],
    ["nao_sei", "comercio"],
    ["simples", "com_servico"],
  ])(
    "%s / %s (sem estimativa): lê SÓ os 3 meses do caderno, na ordem, e a frase honesta continua",
    async (regime, atividade) => {
      tabelas.set("fiscal_cadastro", {
        linhas: [cadastroDoBanco(regime, atividade)],
      });
      await montar();
      expect(mesesDoDre()).toEqual(["2026-09", "2026-10", "2026-11"]);
      expect(texto()).toContain("Ainda não fazemos estimativa");
      expect(host.querySelector("[data-estimativa-valor]")).toBeNull();
      expect(texto()).not.toContain("cerca de");
    },
  );

  it("MEI em novembro: as mesmas 11 leituras de antes (janeiro a novembro), nenhuma a mais", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
    await montar();
    expect(mesesDoDre()).toHaveLength(11);
  });

  it("loja SEM cadastro: nenhuma linha de vendas e nenhuma leitura de fin_dre", async () => {
    tabelas.set("fiscal_cadastro", { linhas: [] });
    await montar();
    expect(host.querySelector("[data-vendas-do-mes]")).toBeNull();
    expect(rpcsChamadas()).not.toContain("fin_dre");
  });

  it("a leitura da receita falha: o caderno segue, sem linha de vendas e sem 'R$ 0,00' no lugar", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("presumido", "comercio")],
    });
    rpc.mockImplementation(async (nome: string) =>
      nome === "fin_dre"
        ? { data: null, error: { code: "42501", message: "permission denied" } }
        : { data: [], error: null },
    );
    await montar();
    expect(secao("Caderno das guias")).not.toBeNull();
    expect(host.querySelectorAll("li[data-mes]").length).toBe(3);
    expect(host.querySelector("[data-vendas-do-mes]")).toBeNull();
    expect(texto()).not.toContain(ROTULO);
  });

  it("enquanto a receita não chegou, o caderno aparece sem a linha e a linha entra quando chega", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("presumido", "comercio")],
    });
    let liberar: () => void = () => undefined;
    const segura = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    rpc.mockImplementation(
      async (nome: string, args: { p_inicio: string; p_fim: string }) => {
        if (nome === "fin_dre") {
          await segura;
          return { data: dreFalso(args.p_inicio), error: null };
        }
        return { data: [], error: null };
      },
    );
    await montar();
    expect(secao("Caderno das guias")).not.toBeNull();
    expect(host.querySelector("[data-vendas-do-mes]")).toBeNull();
    await act(async () => {
      liberar();
    });
    await esperar();
    expect(linhaDe("2026-11")).toBe(`${ROTULO} R$ 3.333,00`);
  });
});

describe("M — janeiro: o medidor do MEI mostra '2026 fechado'", () => {
  beforeEach(() => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio")],
    });
  });

  it("31/12/2026: o medidor NORMAL de 2026 (sem 'fechado' e sem aviso em dezembro)", async () => {
    await montar({ hoje: "2026-12-31" });
    expect(secao("Limite do MEI em 2026")).not.toBeNull();
    expect(host.querySelector("[data-ano-fechado]")).toBeNull();
    expect(texto()).not.toContain("fechado");
    expect(texto()).toContain(DENTRO);
    // 12 meses x R$ 1.000 = R$ 12.000 de R$ 81.000 = 14,81%: "14%"
    expect(texto()).toContain("14%");
    expect(mesesDoDre()).toHaveLength(12);
  });

  it.each(["2027-01-01", "2027-01-12", "2027-01-31"])(
    "%s: '2026 fechado', com o ano de 2026 inteiro e o limite de 2026",
    async (hoje) => {
      await montar({ hoje });
      expect(secao("Limite do MEI em 2026")).not.toBeNull();
      // 12 meses de 2026 x R$ 1.000: o janeiro de 2027 NÃO entra na soma de 2026
      expect(
        normal(host.querySelector("[data-ano-fechado]")?.textContent),
      ).toBe(
        "2026 fechado: pelo que o app registrou, você vendeu R$ 12.000,00 de R$ 81.000,00 (limite de 2026).",
      );
      expect(texto()).not.toContain("ainda não foram conferidos");
      expect(texto()).not.toMatch(/110\.000/);
      // o aviso fixo (só as vendas do app contam) continua embaixo
      expect(texto()).toContain(AVISO_DO_MEDIDOR);
    },
  );

  it("em janeiro de 2027 lê janeiro a dezembro de 2026 e os meses do caderno (nov/2026 a jan/2027): 13 leituras, na ordem", async () => {
    await montar({ hoje: "2027-01-12" });
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
      "2026-12",
      "2027-01",
    ]);
  });

  it("em janeiro de 2027 o caderno mostra as vendas de nov/2026, dez/2026 e jan/2027", async () => {
    receitaDoMes.set("2026-11", 300);
    receitaDoMes.set("2026-12", 400);
    receitaDoMes.set("2027-01", 500);
    await montar({ hoje: "2027-01-12" });
    const linha = (mes: string) =>
      normal(
        host.querySelector(`li[data-mes="${mes}"] [data-vendas-do-mes]`)
          ?.textContent,
      );
    expect(linha("2026-11")).toContain("R$ 300,00");
    expect(linha("2026-12")).toContain("R$ 400,00");
    expect(linha("2027-01")).toContain("R$ 500,00");
  });

  it("MEI aberto em janeiro de 2027 (10/01), hoje 15/01/2027: NÃO diz '2026 fechado' nem 'depois de 2026'; mostra o aviso de ano não conferido, o mesmo de fevereiro", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("mei", "comercio", {
          aberta_em: "2027-01-10",
          vende_no_app_desde: "2027-01-10",
        }),
      ],
    });
    await montar({ hoje: "2027-01-15" });
    expect(host.querySelector("[data-ano-fechado]")).toBeNull();
    expect(secao("Limite do MEI em 2027")).not.toBeNull();
    expect(texto()).toContain(
      "Temos os valores da lei de 2026; os de 2027 ainda não foram conferidos.",
    );
    expect(texto()).not.toContain("depois de 2026");
    expect(texto()).not.toContain("2026 fechado");
    expect(texto()).not.toContain("Confira a data no cadastro fiscal");
  });

  it("MEI aberto em 31/12/2026, hoje 15/01/2027: a empresa existia em 2026, continua '2026 fechado' (limite proporcional de 1 mês)", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("mei", "comercio", { aberta_em: "2026-12-31" })],
    });
    await montar({ hoje: "2027-01-15" });
    expect(
      normal(host.querySelector("[data-ano-fechado]")?.textContent),
    ).toContain("(limite de 2026)");
    expect(texto()).not.toContain("depois de 2026");
  });

  it("01/02/2027 (2027 ainda sem conferência): acabou o 'fechado', volta o aviso de ano não conferido", async () => {
    await montar({ hoje: "2027-02-01" });
    expect(host.querySelector("[data-ano-fechado]")).toBeNull();
    expect(texto()).toContain(
      "Temos os valores da lei de 2026; os de 2027 ainda não foram conferidos.",
    );
  });

  it("'2026 fechado' com cobertura parcial (o app começou em março) não diz 'você vendeu'", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("mei", "comercio", {
          vende_no_app_desde: "2026-03-01",
        }),
      ],
    });
    await montar({ hoje: "2027-01-12" });
    const frase = normal(host.querySelector("[data-ano-fechado]")?.textContent);
    expect(frase).toContain("2026 fechado: o app registrou R$");
    expect(frase).toContain("O limite de 2026 era R$ 81.000,00.");
    expect(frase).not.toContain("você vendeu");
  });

  it("Simples comércio em janeiro: nada de 'fechado' (isso é só do MEI) e a estimativa de dezembro segue", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [cadastroDoBanco("simples", "comercio")],
    });
    await montar({ hoje: "2027-01-12" });
    expect(host.querySelector("[data-ano-fechado]")).toBeNull();
    expect(texto()).toContain("vendas de dezembro de 2026");
  });
});

describe("N — a comparação com a guia avisa o lado do erro quando a estimativa sai de poucos meses", () => {
  it("a loja vendia por fora antes do app: a estimativa (R$ 40, de 4 meses) fica ABAIXO da guia de R$ 100, e a frase diz 60% abaixo", async () => {
    tabelas.set("fiscal_cadastro", {
      linhas: [
        cadastroDoBanco("simples", "comercio", {
          vende_no_app_desde: "2026-06-01",
        }),
      ],
    });
    tabelas.set("fin_lancamentos", {
      linhas: [guia("g-out", "previsto", "2026-10-01", 100)],
    });
    await montar();
    const caderno = normal(secao("Caderno das guias")?.textContent);
    expect(caderno).toContain(
      "Na última guia lançada, a estimativa do app ficou 60% abaixo da guia.",
    );
    // a estimativa em si nunca aparece no caderno
    expect(caderno).not.toContain("cerca de");
    // e a frase de base parcial está na estimativa, com o aviso do lado do erro
    expect(texto()).toContain("a guia pode vir maior");
  });
});

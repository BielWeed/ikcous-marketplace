// Gestão Fiscal, tarefa 9: a receita, as devoluções e o imposto de UM mês, lidos da
// MESMA DRE que a lojista vê na aba Resultado (o número da aba Impostos nunca diverge
// do Resultado). Função pura: recebe a `DreFinanceira` já lida e devolve três números.
//
// O contrato é com `fin_dre` (corpo vigente na 20261405900000): a linha derivada
// "Estornos e devoluções" só existe quando há estorno no mês, vem ANTES das linhas
// manuais, e a DRE não manda o id da categoria, só o nome. Por isso os casos de borda
// abaixo são sobre nome repetido e linha ausente, não sobre conta de somar.
//
// Fixtures INVENTADAS: o repositório é público, nada de loja real.
import {
  CATEGORIA_DE_IMPOSTOS_ID,
  NOME_DA_LINHA_DE_DEVOLUCOES,
  nomeDaCategoriaDeImpostos,
  receitaDoMes,
} from "@/lib/fiscal/receita-do-mes";
import type {
  CategoriaFinanceira,
  DreFinanceira,
  GrupoDaDre,
  LinhaDaDre,
} from "@/types/financeiro";
import { describe, expect, it } from "vitest";

const NOME_DOS_IMPOSTOS = "Impostos sobre vendas (DAS/Simples)";

/** A categoria de impostos como a lista de categorias a entrega: nome atual + grupo atual. */
const deImpostos = (nome: string, grupoDre: GrupoDaDre = "deducao") => ({
  nome,
  grupoDre,
});
const IMPOSTOS = deImpostos(NOME_DOS_IMPOSTOS);

function dre(trocas: Partial<DreFinanceira> = {}): DreFinanceira {
  return {
    receitaBruta: 0,
    receitaOnline: 0,
    receitaBalcao: 0,
    deducoes: 0,
    receitaLiquida: 0,
    cmv: 0,
    cmvEstimado: false,
    lucroBruto: 0,
    custosVariaveis: 0,
    margemContribuicao: 0,
    despesasFixas: 0,
    resultadoOperacional: 0,
    resultadoFinanceiro: 0,
    lucroLiquido: 0,
    linhas: [],
    ...trocas,
  };
}

const linha = (
  grupo: LinhaDaDre["grupo"],
  categoria: string,
  valor: number,
): LinhaDaDre => ({ grupo, categoria, valor });

const devolucoesDoBanco = (valor: number) =>
  linha("deducao", NOME_DA_LINHA_DE_DEVOLUCOES, valor);

describe("receitaDoMes: a receita", () => {
  it("é vendas pelo app mais vendas na loja física", () => {
    const r = receitaDoMes(
      dre({ receitaOnline: 1500, receitaBalcao: 320.5 }),
      IMPOSTOS,
    );
    expect(r.receita).toBe(1820.5);
  });

  it("não soma 'outras receitas' lançadas à mão, que estão na receita bruta mas não são venda", () => {
    const r = receitaDoMes(
      dre({ receitaBruta: 1010, receitaOnline: 600, receitaBalcao: 400 }),
      IMPOSTOS,
    );
    expect(r.receita).toBe(1000);
  });

  it("soma em centavos: 0,10 + 0,20 é exatamente 0,30, sem sobra de ponto flutuante", () => {
    const r = receitaDoMes(
      dre({ receitaOnline: 0.1, receitaBalcao: 0.2 }),
      IMPOSTOS,
    );
    expect(r.receita).toBe(0.3);
  });

  it("mês sem venda é zero, não NaN nem negativo", () => {
    const r = receitaDoMes(dre(), IMPOSTOS);
    expect(r).toEqual({ receita: 0, devolucoes: 0, imposto: 0 });
  });
});

describe("receitaDoMes: as devoluções", () => {
  it("é a linha derivada 'Estornos e devoluções' que o banco manda", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        receitaBalcao: 100,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          linha("receita", "Vendas na loja física", 100),
          devolucoesDoBanco(75.9),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(75.9);
  });

  it("categoria MANUAL com o mesmo nome vem depois da derivada e não é somada", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          devolucoesDoBanco(50),
          // a lojista criou uma categoria igual e lançou 30 nela
          linha("deducao", NOME_DA_LINHA_DE_DEVOLUCOES, 30),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(50);
  });

  it("sem estorno no mês o banco NÃO emite a linha derivada: a manual homônima não vira devolução", () => {
    // O banco só emite a derivada quando v_ded_derivadas > 0. Aqui há venda e custo
    // (linha 'cmv' antes das manuais), mas nenhum estorno; sobra só a manual.
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        cmv: 400,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          linha("cmv", "Custo das mercadorias vendidas", 400),
          linha("deducao", NOME_DA_LINHA_DE_DEVOLUCOES, 30),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(0);
  });

  it("sem venda e sem estorno, uma manual homônima também não vira devolução", () => {
    // Nenhuma linha derivada existe: a primeira linha do array já é manual.
    // Aqui o índice da derivada (0) tem uma linha de OUTRO grupo na frente da manual.
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("receita", "Alguma receita lançada à mão", 10),
          linha("deducao", NOME_DA_LINHA_DE_DEVOLUCOES, 30),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(0);
  });

  it("só vale se for do grupo dedução: mesmo nome em outro grupo não é devolução", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          linha("despesa_fixa", NOME_DA_LINHA_DE_DEVOLUCOES, 40),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(0);
  });

  it("acha a derivada também quando só há venda de balcão (a linha do app não existe)", () => {
    const r = receitaDoMes(
      dre({
        receitaBalcao: 200,
        linhas: [
          linha("receita", "Vendas na loja física", 200),
          devolucoesDoBanco(20),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.devolucoes).toBe(20);
  });

  it("mês só de devolução (a venda foi em outro mês) devolve o valor, sem esconder nem zerar", () => {
    const r = receitaDoMes(dre({ linhas: [devolucoesDoBanco(120)] }), IMPOSTOS);
    expect(r.receita).toBe(0);
    expect(r.devolucoes).toBe(120);
  });
});

describe("receitaDoMes: o imposto do mês", () => {
  it("soma a linha da dedução que tem o nome ATUAL da categoria de impostos", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", NOME_DOS_IMPOSTOS, 310.4),
          linha("despesa_fixa", "Aluguel e condomínio", 800),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(310.4);
  });

  it("a lojista renomeou a categoria: quem manda é o nome que vem de fora, não um texto fixo", () => {
    const linhas = [
      linha("deducao", "Tributos da loja", 200),
      // categoria nova que ficou com o nome ANTIGO da de impostos: não é a de impostos
      linha("deducao", NOME_DOS_IMPOSTOS, 55),
    ];
    expect(
      receitaDoMes(dre({ linhas }), deImpostos("Tributos da loja")).imposto,
    ).toBe(200);
    expect(receitaDoMes(dre({ linhas }), IMPOSTOS).imposto).toBe(55);
  });

  it("só conta linha do grupo dedução: mesmo nome em outro grupo fica de fora", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", NOME_DOS_IMPOSTOS, 100),
          linha("despesa_fixa", NOME_DOS_IMPOSTOS, 999),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(100);
  });

  it("ignora espaço sobrando nas pontas do nome (o banco e o parser já aparam)", () => {
    const r = receitaDoMes(
      dre({ linhas: [linha("deducao", "Tributos", 70)] }),
      deImpostos("  Tributos "),
    );
    expect(r.imposto).toBe(70);
  });

  it("mês sem lançamento de imposto é 0 (nome conhecido), não 'desconhecido'", () => {
    const r = receitaDoMes(
      dre({ linhas: [linha("despesa_fixa", "Aluguel e condomínio", 800)] }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(0);
  });

  it("sem o nome da categoria (lista não carregou, categoria sumiu) o imposto é null, nunca 0", () => {
    const linhas = [linha("deducao", NOME_DOS_IMPOSTOS, 310.4)];
    expect(receitaDoMes(dre({ linhas }), null).imposto).toBeNull();
    expect(receitaDoMes(dre({ linhas }), deImpostos("")).imposto).toBeNull();
    expect(receitaDoMes(dre({ linhas }), deImpostos("   ")).imposto).toBeNull();
  });

  it("soma em centavos quando mais de uma linha casa", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", NOME_DOS_IMPOSTOS, 0.1),
          linha("deducao", NOME_DOS_IMPOSTOS, 0.2),
        ],
      }),
      IMPOSTOS,
    );
    expect(r.imposto).toBe(0.3);
  });

  it("a lojista deu à categoria de impostos o nome da linha de devoluções: a derivada não entra no imposto", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          devolucoesDoBanco(50),
          linha("deducao", NOME_DA_LINHA_DE_DEVOLUCOES, 310),
        ],
      }),
      deImpostos(NOME_DA_LINHA_DE_DEVOLUCOES),
    );
    expect(r.devolucoes).toBe(50);
    expect(r.imposto).toBe(310);
  });

  // A lojista pode mover a categoria de impostos de grupo na tela "Linha do resultado".
  // O banco então devolve a linha no grupo NOVO: somar só "deducao" mostraria 0 de
  // imposto enquanto o caderno mostra a guia.
  it("a lojista moveu a categoria de impostos para despesa fixa: a linha nesse grupo é somada", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("despesa_fixa", NOME_DOS_IMPOSTOS, 310.4),
          linha("despesa_fixa", "Aluguel e condomínio", 800),
        ],
      }),
      deImpostos(NOME_DOS_IMPOSTOS, "despesa_fixa"),
    );
    expect(r.imposto).toBe(310.4);
  });

  it("no grupo novo, o mesmo nome no grupo ANTIGO (dedução) não é somado", () => {
    const r = receitaDoMes(
      dre({
        linhas: [
          linha("deducao", NOME_DOS_IMPOSTOS, 999),
          linha("despesa_fixa", NOME_DOS_IMPOSTOS, 120),
        ],
      }),
      deImpostos(NOME_DOS_IMPOSTOS, "despesa_fixa"),
    );
    expect(r.imposto).toBe(120);
  });

  it("categoria de impostos em fora_dre: o fin_dre nem emite a linha, então é null (não sei), nunca 0", () => {
    const r = receitaDoMes(
      dre({ linhas: [linha("deducao", NOME_DOS_IMPOSTOS, 50)] }),
      deImpostos(NOME_DOS_IMPOSTOS, "fora_dre"),
    );
    expect(r.imposto).toBeNull();
  });

  it("categoria em outro grupo sem lançamento no mês é 0 (o grupo é conhecido), não null", () => {
    const r = receitaDoMes(
      dre({ linhas: [linha("despesa_fixa", "Aluguel e condomínio", 800)] }),
      deImpostos(NOME_DOS_IMPOSTOS, "custo_variavel"),
    );
    expect(r.imposto).toBe(0);
  });

  it("categoria de impostos em outro grupo com o nome da linha de devoluções: devolução e imposto não se misturam", () => {
    const r = receitaDoMes(
      dre({
        receitaOnline: 900,
        linhas: [
          linha("receita", "Vendas pelo app", 900),
          devolucoesDoBanco(50),
          linha("despesa_fixa", NOME_DA_LINHA_DE_DEVOLUCOES, 310),
        ],
      }),
      deImpostos(NOME_DA_LINHA_DE_DEVOLUCOES, "despesa_fixa"),
    );
    expect(r.devolucoes).toBe(50);
    expect(r.imposto).toBe(310);
  });
});

describe("nomeDaCategoriaDeImpostos: nome e grupo saem da lista pelo ID fixo", () => {
  const cat = (
    id: string,
    nome: string,
    grupoDre: GrupoDaDre = "deducao",
  ): Pick<CategoriaFinanceira, "id" | "nome" | "grupoDre"> => ({
    id,
    nome,
    grupoDre,
  });

  it("acha pelo id, mesmo renomeada", () => {
    const achada = nomeDaCategoriaDeImpostos([
      cat("11111111-1111-4111-8111-111111111111", "Aluguel", "despesa_fixa"),
      cat(CATEGORIA_DE_IMPOSTOS_ID, "Tributos da loja"),
    ]);
    expect(achada).toStrictEqual({
      nome: "Tributos da loja",
      grupoDre: "deducao",
    });
  });

  it("devolve o grupo ATUAL, mesmo que a lojista o tenha mudado", () => {
    const achada = nomeDaCategoriaDeImpostos([
      cat(CATEGORIA_DE_IMPOSTOS_ID, NOME_DOS_IMPOSTOS, "despesa_fixa"),
    ]);
    expect(achada?.grupoDre).toBe("despesa_fixa");
  });

  it("não confunde com outra categoria que tem o nome antigo", () => {
    const achada = nomeDaCategoriaDeImpostos([
      cat("11111111-1111-4111-8111-111111111111", NOME_DOS_IMPOSTOS),
      cat(CATEGORIA_DE_IMPOSTOS_ID, "Tributos da loja", "custo_variavel"),
    ]);
    expect(achada).toStrictEqual({
      nome: "Tributos da loja",
      grupoDre: "custo_variavel",
    });
  });

  it("lista vazia, categoria ausente ou nome em branco = null", () => {
    expect(nomeDaCategoriaDeImpostos([])).toBeNull();
    expect(
      nomeDaCategoriaDeImpostos([
        cat("11111111-1111-4111-8111-111111111111", NOME_DOS_IMPOSTOS),
      ]),
    ).toBeNull();
    expect(
      nomeDaCategoriaDeImpostos([cat(CATEGORIA_DE_IMPOSTOS_ID, "  ")]),
    ).toBeNull();
  });

  it("a saída de nomeDaCategoriaDeImpostos entra direto em receitaDoMes", () => {
    const categorias = [
      cat(CATEGORIA_DE_IMPOSTOS_ID, "Tributos da loja", "despesa_fixa"),
    ];
    const r = receitaDoMes(
      dre({ linhas: [linha("despesa_fixa", "Tributos da loja", 88)] }),
      nomeDaCategoriaDeImpostos(categorias),
    );
    expect(r.imposto).toBe(88);
  });
});

// A âncora do contrato: se uma migration futura redefinir `fin_dre` e mudar o nome ou
// o grupo da linha derivada, este teste cai ANTES de a aba somar a linha errada.
// Roda no CI sem banco: lê o arquivo da migration (padrão `import.meta.glob ?raw`).
describe("contrato com o fin_dre vigente", () => {
  const MIGRATIONS = import.meta.glob<string>("/supabase/migrations/*.sql", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  const vigente = Object.entries(MIGRATIONS)
    .filter(([caminho]) => !caminho.includes("/rollback-manual"))
    .filter(([, sql]) =>
      sql.includes("CREATE OR REPLACE FUNCTION public.fin_dre("),
    )
    .map(([caminho, sql]) => ({ caminho, sql }))
    .sort((a, b) => (a.caminho < b.caminho ? -1 : 1))
    .at(-1);

  /** O trecho do corpo vigente que monta o bloco DERIVADO de `linhas` (antes das manuais). */
  const blocoDerivado = (): string => {
    const sql = vigente?.sql ?? "";
    const fim = sql.lastIndexOf("|| v_linhas_manuais");
    expect(
      fim,
      "as linhas manuais não vêm mais DEPOIS das derivadas",
    ).toBeGreaterThan(-1);
    const inicio = sql.lastIndexOf("'linhas',", fim);
    expect(inicio, "a DRE vigente não monta mais 'linhas'").toBeGreaterThan(-1);
    return sql.slice(inicio, fim);
  };

  it("a última migration que redefine fin_dre ainda emite a linha derivada com este nome e grupo", () => {
    expect(vigente).toBeDefined();
    expect(vigente?.sql).toContain(
      `jsonb_build_object('grupo', 'deducao', 'categoria', '${NOME_DA_LINHA_DE_DEVOLUCOES}'`,
    );
  });

  // As premissas de POSIÇÃO de `linhaDerivadaDeDevolucoes`: a derivada fica logo depois
  // das linhas de venda, e as linhas de venda existem só quando a venda é > 0.
  it("as linhas de venda (app e balcão) têm ordem 1 e só existem com venda > 0", () => {
    const bloco = blocoDerivado();
    expect(bloco).toMatch(
      /'categoria', 'Vendas pelo app', 'valor', v_online, 'ordem', 1\)\s+AS l\s+WHERE v_online > 0\b/,
    );
    expect(bloco).toMatch(
      /'categoria', 'Vendas na loja física', 'valor', v_balcao, 'ordem', 1\)\s+WHERE v_balcao > 0\b/,
    );
  });

  it("a linha derivada de devoluções tem ordem 2 e só existe com estorno > 0", () => {
    // A regex é literal (o lint recusa RegExp dinâmico); o nome é conferido à parte.
    expect(NOME_DA_LINHA_DE_DEVOLUCOES).toBe("Estornos e devoluções");
    expect(blocoDerivado()).toMatch(
      /'categoria', 'Estornos e devoluções', 'valor', v_ded_derivadas, 'ordem', 2\)\s+WHERE v_ded_derivadas > 0\b/,
    );
  });

  it("nenhuma outra linha derivada vem antes da de devoluções, e o bloco é ordenado por 'ordem' antes das manuais", () => {
    const bloco = blocoDerivado();
    const linhas = [
      ...bloco.matchAll(/'categoria', '([^']+)'[^)]*?'ordem', (\d+)\)/g),
    ].map(([, categoria, ordem]) => ({ categoria, ordem: Number(ordem) }));
    const antes = linhas
      .filter((l) => l.ordem < 2)
      .map((l) => l.categoria)
      .sort();
    expect(antes).toStrictEqual(["Vendas na loja física", "Vendas pelo app"]);
    // E nenhuma outra linha derivada divide a ordem 2 com a de devoluções.
    expect(
      linhas.filter((l) => l.ordem === 2).map((l) => l.categoria),
    ).toStrictEqual([NOME_DA_LINHA_DE_DEVOLUCOES]);
    expect(bloco).toContain("ORDER BY (l ->> 'ordem')::int");
  });
});

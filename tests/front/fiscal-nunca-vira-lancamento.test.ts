//
// TRAVA ESTATICA: o modulo fiscal NUNCA grava lancamento financeiro.
//
// Por que existe (plano da Fase 1, secao "O que NAO muda"): a aba Impostos mostra
// uma ESTIMATIVA do Simples. Se qualquer pedaco do modulo gravasse um lancamento,
// a estimativa poderia virar despesa "realizada" e inflar o Resultado, o Pagar e
// receber e o Inicio - dinheiro de verdade errado, sem ninguem ter digitado nada.
// A unica forma de "lancar a guia" e o modulo ENTREGAR um rascunho
// (`guiaDoMes`) e a `abrirFolha` que o Financeiro ja tem abrir o "Novo
// lancamento" - quem grava e a lojista, depois de conferir e confirmar. A unica
// escrita do modulo e o cadastro fiscal (`fiscal_cadastro_salvar`).
//
// Este arquivo le o TEXTO dos fontes (`import.meta.glob` com `?raw`, sem API de
// Node) e falha se o modulo:
//   1. importar o que grava no Financeiro (`salvarLancamento`, `baixarLancamento`,
//      ... de `@/hooks/useFinanceiro`; as folhas que os chamam);
//   2. citar uma RPC `fin_*` de ESCRITA, ou chamar `.rpc(...)` com nome fora da
//      lista (nome dinamico tambem reprova: nao da para auditar);
//   3. gravar numa tabela (`.from(...).insert/update/upsert/delete`);
//   4. escrever situacao/status "realizado" (lancamento ja pago) em objeto;
//   5. (so `guia-do-mes.ts`) citar a estimativa ou importar o calculo dela.
//
// Fail-closed de proposito: RPC `fin_*` desconhecida e export novo do
// `useFinanceiro.ts` fora das listas abaixo reprovam, em vez de passarem em
// silencio. O teste "classificacao completa" obriga quem criar uma funcao nova
// no Financeiro a decidir se ela le ou escreve.
//
// Os controles positivos (strings ruins que a MESMA funcao `violacoes` TEM de
// reprovar) provam que a trava nao e um teste que sempre passa.
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Corpus: o que a trava vigia
// ---------------------------------------------------------------------------

// O glob do Vite exige literais (nao aceita constante): por isso a lista fica aqui.
const FONTES_DO_MODULO = import.meta.glob<string>(
  [
    "/src/lib/fiscal/**/*.{ts,tsx}",
    "/src/components/admin/financeiro/impostos/**/*.{ts,tsx}",
    // Chega depois (Tarefa 22): se ainda nao existe, o glob simplesmente nao casa.
    "/src/hooks/useImpostos*.{ts,tsx}",
  ],
  { query: "?raw", import: "default", eager: true },
);

// Para a classificacao completa: o hook do Financeiro e os tipos do banco.
const FONTE_DO_HOOK = import.meta.glob<string>("/src/hooks/useFinanceiro.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const TIPOS_DO_BANCO = import.meta.glob<string>(
  "/src/types/database.types.ts",
  {
    query: "?raw",
    import: "default",
    eager: true,
  },
);

const aoNormal = (texto: string): string => texto.replace(/\r\n/g, "\n");

const ARQUIVOS: Array<[string, string]> = Object.entries(FONTES_DO_MODULO).map(
  ([caminho, texto]): [string, string] => [caminho, aoNormal(texto)],
);

const primeiroTexto = (mapa: Record<string, string>): string =>
  aoNormal(Object.values(mapa)[0] ?? "");

// ---------------------------------------------------------------------------
// Listas explicitas (cada uma com o porque)
// ---------------------------------------------------------------------------

/**
 * RPCs do Financeiro que GRAVAM (lancamento, caixa, conta, categoria). O modulo
 * fiscal nao pode nem cita-las, nem em comentario: citar e o primeiro passo de
 * copiar a chamada.
 */
const RPC_DE_ESCRITA = [
  "fin_lancamento_salvar",
  "fin_lancamento_baixar",
  "fin_lancamento_cancelar",
  "fin_caixa_abrir",
  "fin_caixa_fechar",
  "fin_caixa_fechar_sessao",
  "fin_caixa_movimentar",
  "fin_caixa_movimentar_com_chave",
  "fin_conta_salvar",
  "fin_categoria_salvar",
] as const;

/** RPCs do Financeiro que so LEEM: o modulo pode chamar (a receita vem do `fin_dre`). */
const RPC_DE_LEITURA = [
  "fin_resumo",
  "fin_extrato",
  "fin_previstos",
  "fin_dre",
  "fin_contas_listar",
  "fin_categorias_listar",
  "fin_caixa_atual",
  "fin_caixa_historico",
] as const;

/** Tabelas `fin_*` do banco (leitura por tipo; escrita so seria por `.from`, barrada abaixo). */
const TABELAS_FIN = [
  "fin_caixa_sessoes",
  "fin_categorias",
  "fin_contas",
  "fin_lancamento_tentativas",
  "fin_lancamentos",
] as const;

/** A UNICA RPC de escrita que o modulo fiscal pode chamar: o cadastro (regime, atividade). */
const RPC_PERMITIDA_DO_FISCAL = ["fiscal_cadastro_salvar"] as const;

/**
 * Funcoes do `src/hooks/useFinanceiro.ts` que gravam. Importar qualquer uma, em
 * qualquer arquivo do modulo, reprova: elas sao o caminho para fabricar
 * lancamento sem a lojista confirmar.
 */
const SIMBOLOS_DE_ESCRITA = [
  "salvarLancamento",
  "baixarLancamento",
  "cancelarLancamento",
  "abrirCaixa",
  "movimentarCaixa",
  "fecharCaixa",
  "salvarConta",
  "salvarCategoria",
] as const;

/**
 * O que o modulo PODE importar de `useFinanceiro`: leituras e preferencias de
 * tela. Qualquer nome fora desta lista (inclusive `*` e default) reprova.
 */
const SIMBOLOS_DE_LEITURA = [
  "ContextoDoCacheFinanceiro",
  "ConsultaFinanceira",
  "useResumoFinanceiro",
  "useExtratoFinanceiro",
  "usePrevistosFinanceiros",
  "useDreFinanceira",
  "useDreMensal",
  // Exportados para a aba Impostos: a consulta com prazo de 20 s e a leitura
  // do fin_dre (so leem; a prova disto e nao haver .rpc de escrita neles).
  "useConsultaFinanceira",
  "lerDre",
  "useContasFinanceiras",
  "useCategoriasFinanceiras",
  "useCaixaAtual",
  "useHistoricoDoCaixa",
  "conferirCaixaParaReconciliar",
  // So le fin_caixa_atual e fin_caixa_historico, depois de um fechamento repetido.
  "conferirCaixaDepoisDoReplay",
  "CHAVE_VALORES_OCULTOS",
  "useValoresOcultos",
  "useTelaLarga",
] as const;

/**
 * Componentes do Financeiro que embrulham as escritas acima (cada um chama
 * `salvarLancamento`, `baixarLancamento`, ... por dentro). O modulo fiscal nao
 * os importa: ele recebe `abrirFolha` por prop e deixa o Financeiro abri-la.
 */
const MODULOS_QUE_GRAVAM = [
  "NovoLancamentoFolha",
  "FolhasDeLancamento",
  "FolhasDoCaixa",
  "FolhasDeCadastro",
] as const;

const HOOK_DO_FINANCEIRO = "useFinanceiro";
const GUIA_DO_MES = "/src/lib/fiscal/guia-do-mes.ts";

// ---------------------------------------------------------------------------
// A checagem (funcao pura: o mesmo codigo julga o corpus real e as strings-controle)
// ---------------------------------------------------------------------------

/**
 * Tira comentarios e preserva strings (uma `//` dentro de "https://..." nao e
 * comentario). Strings de aspas simples/duplas nao atravessam linha: um apostrofo
 * solto em texto de JSX nao pode engolir o codigo ate o proximo apostrofo.
 */
function semComentarios(texto: string): string {
  return texto.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_inteiro, texto_literal: string | undefined) => texto_literal ?? " ",
  );
}

const nomeDoModulo = (especificador: string): string =>
  (especificador.split("/").pop() ?? "").replace(/\.(?:tsx?|jsx?)$/, "");

function nomesDaClausula(bruta: string): string[] {
  // `import type { A }` / `export type { A }`: o `type` solto na frente nao e nome.
  const clausula = bruta.trim().replace(/^type\b/, "");
  if (clausula.includes("*")) return ["*"];
  const chaves = /\{([\s\S]*)\}/.exec(clausula);
  const resto = (chaves ? clausula.replace(chaves[0], "") : clausula)
    .replace(/,/g, " ")
    .trim();
  const nomes: string[] = resto ? ["default"] : [];
  for (const bruto of (chaves?.[1] ?? "").split(",")) {
    const nome =
      bruto
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim() ?? "";
    if (nome) nomes.push(nome);
  }
  return nomes;
}

interface Importacao {
  especificador: string;
  /** `null` = import dinamico / `require` / efeito colateral: nenhum nome auditavel. */
  nomes: string[] | null;
}

function importacoesDe(codigo: string): Importacao[] {
  const achadas: Importacao[] = [];
  for (const m of codigo.matchAll(
    /\b(?:import|export)\b([^;'"]*?)\s*from\s*["']([^"']+)["']/g,
  )) {
    achadas.push({
      especificador: m[2] ?? "",
      nomes: nomesDaClausula(m[1] ?? ""),
    });
  }
  for (const m of codigo.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
    achadas.push({ especificador: m[1] ?? "", nomes: null });
  }
  for (const m of codigo.matchAll(
    /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  )) {
    achadas.push({ especificador: m[1] ?? "", nomes: null });
  }
  return achadas;
}

/** As "palavras" do texto (letras, digitos e `_`): `fin_caixa_fechar` nao casa com `fin_caixa_fechar_sessao`. */
const palavrasDe = (texto: string): Set<string> => new Set(texto.split(/\W+/));

const inclui = (lista: readonly string[], valor: string): boolean =>
  lista.includes(valor);

/**
 * Tudo que `texto` (o fonte de `caminho`) faz de proibido, em frases curtas.
 * Lista vazia = limpo.
 */
function violacoes(caminho: string, texto: string): string[] {
  const achados: string[] = [];
  const codigo = semComentarios(texto);

  // 1) Imports
  for (const { especificador, nomes } of importacoesDe(codigo)) {
    const modulo = nomeDoModulo(especificador);
    if (inclui(MODULOS_QUE_GRAVAM, modulo)) {
      achados.push(
        `importa ${modulo}, que grava no Financeiro (receba a abrirFolha por prop)`,
      );
    }
    if (modulo === HOOK_DO_FINANCEIRO) {
      if (nomes === null) {
        achados.push(
          `import dinamico/efeito colateral de ${especificador}: nao da para auditar os nomes`,
        );
        continue;
      }
      for (const nome of nomes) {
        if (inclui(SIMBOLOS_DE_ESCRITA, nome)) {
          achados.push(`importa a escrita ${nome} de ${especificador}`);
        } else if (!inclui(SIMBOLOS_DE_LEITURA, nome)) {
          achados.push(
            `importa ${nome} de ${especificador}, que nao esta na lista de leitura do teste`,
          );
        }
      }
    }
  }

  // 2) O simbolo de escrita usado no codigo, mesmo sem import visivel (copia, alias)
  const palavrasDoCodigo = palavrasDe(codigo);
  for (const simbolo of SIMBOLOS_DE_ESCRITA) {
    if (palavrasDoCodigo.has(simbolo)) {
      achados.push(`usa o simbolo de escrita ${simbolo}`);
    }
  }

  // 3) RPC de escrita citada em qualquer lugar (comentario inclusive)
  const palavrasDoTexto = palavrasDe(texto);
  for (const rpc of RPC_DE_ESCRITA) {
    if (palavrasDoTexto.has(rpc)) {
      achados.push(`cita a RPC de escrita ${rpc}`);
    }
  }

  // 4) `.rpc(...)`: so nome literal, e so os da lista
  // Tipo generico simples (`.rpc<Json>(`) sai antes; generico aninhado nao casa e cai
  // em "nome nao literal" (fail-closed).
  const semGenericos = codigo.replace(/\.rpc\s*<[^<>]*>/g, ".rpc");
  const chamadas = [...semGenericos.matchAll(/\.rpc\b/g)].length;
  const literais = [
    ...semGenericos.matchAll(/\.rpc\s*\(\s*(["'`])([^"'`]+)\1/g),
  ];
  if (chamadas > literais.length) {
    achados.push(".rpc(...) com nome nao literal: nao da para auditar");
  }
  for (const m of literais) {
    const nome = m[2] ?? "";
    const permitida =
      inclui(RPC_DE_LEITURA, nome) || inclui(RPC_PERMITIDA_DO_FISCAL, nome);
    if (!permitida)
      achados.push(`chama a RPC "${nome}", fora da lista do modulo`);
  }

  // 5) Gravar em tabela
  const gravaEmTabela =
    /\.from\s*\(\s*(["'`])([^"'`]+)\1\s*\)\s*\.(?:insert|update|upsert|delete)\b/g;
  for (const m of codigo.matchAll(gravaEmTabela)) {
    achados.push(`grava na tabela "${m[2] ?? ""}" por .from(...)`);
  }
  // Construtor guardado em variavel (`const t = supabase.from("fin_x"); t.insert(...)`)
  if (
    /\.from\s*\(\s*["'`]fin_/.test(codigo) &&
    /\.(?:insert|update|upsert|delete)\s*\(/.test(codigo)
  ) {
    achados.push(
      "le `fin_*` por .from(...) e tem insert/update/upsert/delete no mesmo arquivo",
    );
  }

  // 6) Lancamento "realizado" montado pelo modulo (comparar `=== "realizado"` pode)
  if (
    /\b(?:status|situacao)\s*(?::|(?<![=!<>])=(?![=>]))\s*["'`]realizado["'`]/.test(
      codigo,
    )
  ) {
    achados.push('monta status/situacao "realizado" em objeto');
  }

  // 7) A guia: nem cita a estimativa, nem importa o calculo dela
  if (caminho === GUIA_DO_MES) {
    if (/estimativ|estimar|estimad/i.test(texto)) {
      achados.push("guia-do-mes.ts cita a estimativa");
    }
    if (
      importacoesDe(codigo).some(
        (i) => nomeDoModulo(i.especificador) === "estimativa-simples",
      )
    ) {
      achados.push("guia-do-mes.ts importa o calculo da estimativa");
    }
  }

  return achados;
}

// ---------------------------------------------------------------------------
// O corpus real
// ---------------------------------------------------------------------------

describe("o módulo fiscal nunca grava lançamento (trava estática)", () => {
  it("o glob achou o módulo inteiro (a trava não passa por estar cega)", () => {
    const noLib = ARQUIVOS.filter(([c]) => c.startsWith("/src/lib/fiscal/"));
    const nosComponentes = ARQUIVOS.filter(([c]) =>
      c.startsWith("/src/components/admin/financeiro/impostos/"),
    );
    expect(noLib.length, "src/lib/fiscal/**").toBeGreaterThanOrEqual(8);
    expect(
      nosComponentes.length,
      "src/components/admin/financeiro/impostos/**",
    ).toBeGreaterThanOrEqual(4);
    expect(
      ARQUIVOS.some(([c]) => c === GUIA_DO_MES),
      "guia-do-mes.ts sumiu ou mudou de lugar: a trava da guia ficaria cega",
    ).toBe(true);
    const texto = ARQUIVOS.map(([, t]) => t).join("\n");
    expect(texto.length).toBeGreaterThan(50_000);
  });

  it.each(ARQUIVOS)(
    "%s não importa, cita nem chama escrita",
    (caminho, texto) => {
      expect(violacoes(caminho, texto)).toEqual([]);
    },
  );

  it("a escrita de lançamento e a de caixa/conta/categoria são de listas disjuntas da leitura", () => {
    const juntas = [
      ...RPC_DE_ESCRITA,
      ...RPC_DE_LEITURA,
      ...TABELAS_FIN,
      ...RPC_PERMITIDA_DO_FISCAL,
    ];
    expect(new Set(juntas).size).toBe(juntas.length);
    const simbolos = [...SIMBOLOS_DE_ESCRITA, ...SIMBOLOS_DE_LEITURA];
    expect(new Set(simbolos).size).toBe(simbolos.length);
  });

  it("classificação completa: toda `fin_*` do banco e todo export do useFinanceiro está numa lista", () => {
    const tipos = primeiroTexto(TIPOS_DO_BANCO);
    expect(tipos.length, "database.types.ts nao foi lido").toBeGreaterThan(
      100_000,
    );
    const noBanco = [
      ...new Set(
        [...tipos.matchAll(/^ {6}(fin_[a-z0-9_]+): \{/gm)].map(
          (m) => m[1] ?? "",
        ),
      ),
    ];
    expect(noBanco.length).toBeGreaterThan(15);
    const conhecidas: readonly string[] = [
      ...RPC_DE_ESCRITA,
      ...RPC_DE_LEITURA,
      ...TABELAS_FIN,
    ];
    expect(
      noBanco.filter((nome) => !conhecidas.includes(nome)),
      "nova tabela/funcao fin_* no banco: classifique como leitura ou escrita neste teste",
    ).toEqual([]);

    const hook = primeiroTexto(FONTE_DO_HOOK);
    expect(hook.length, "useFinanceiro.ts nao foi lido").toBeGreaterThan(5_000);
    const exportados = [
      ...hook.matchAll(
        /^export (?:async )?(?:function|const|interface|type|class) (\w+)/gm,
      ),
    ].map((m) => m[1] ?? "");
    expect(exportados.length).toBeGreaterThan(20);
    const simbolosConhecidos: readonly string[] = [
      ...SIMBOLOS_DE_ESCRITA,
      ...SIMBOLOS_DE_LEITURA,
    ];
    expect(
      exportados.filter((nome) => !simbolosConhecidos.includes(nome)),
      "export novo em useFinanceiro.ts: classifique como leitura ou escrita neste teste",
    ).toEqual([]);
    // As escritas listadas existem de fato (renomeou -> a lista ficou velha).
    expect(
      SIMBOLOS_DE_ESCRITA.filter((nome) => !exportados.includes(nome)),
      "escrita listada que nao existe mais no hook",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Controles: a MESMA `violacoes` tem de reprovar o ruim e aceitar o bom
// ---------------------------------------------------------------------------

const ARQ = "/src/lib/fiscal/arquivo-ficticio.ts";

describe("controles positivos: o que a trava TEM de reprovar", () => {
  const RUINS: Array<[string, string, string]> = [
    [
      "import nomeado de escrita do hook (o controle pedido)",
      'import { salvarLancamento } from "@/hooks/useFinanceiro";',
      "importa a escrita salvarLancamento",
    ],
    [
      "import de leitura misturado com escrita",
      'import { useDreMensal, baixarLancamento } from "@/hooks/useFinanceiro";',
      "importa a escrita baixarLancamento",
    ],
    [
      "import em varias linhas",
      'import {\n  useDreMensal,\n  cancelarLancamento,\n} from "@/hooks/useFinanceiro";',
      "importa a escrita cancelarLancamento",
    ],
    [
      "import com alias esconde o nome",
      'import { salvarLancamento as gravar } from "../../../hooks/useFinanceiro";',
      "importa a escrita salvarLancamento",
    ],
    [
      "import de tipo tambem conta (escrita de caixa)",
      'import type { abrirCaixa } from "@/hooks/useFinanceiro";',
      "importa a escrita abrirCaixa",
    ],
    [
      "import de tudo (*)",
      'import * as fin from "@/hooks/useFinanceiro";',
      "nao esta na lista de leitura",
    ],
    [
      "re-export de tudo",
      'export * from "@/hooks/useFinanceiro";',
      "nao esta na lista de leitura",
    ],
    [
      "nome novo no hook, nao classificado",
      'import { gravarAlgumaCoisaNova } from "@/hooks/useFinanceiro";',
      "nao esta na lista de leitura",
    ],
    [
      "import dinamico do hook",
      'const m = await import("@/hooks/useFinanceiro");',
      "import dinamico",
    ],
    [
      "importa a folha que grava",
      'import { NovoLancamentoFolha } from "../NovoLancamentoFolha";',
      "importa NovoLancamentoFolha",
    ],
    [
      "importa a folha de baixa/cancelamento",
      'import { BaixarLancamentoFolha } from "@/components/admin/financeiro/FolhasDeLancamento";',
      "importa FolhasDeLancamento",
    ],
    [
      "chama a RPC de lancamento",
      'await supabase.rpc("fin_lancamento_salvar", { p });',
      'chama a RPC "fin_lancamento_salvar"',
    ],
    [
      "RPC de escrita so citada em comentario",
      "// depois chamamos fin_lancamento_baixar para pagar",
      "cita a RPC de escrita fin_lancamento_baixar",
    ],
    [
      "RPC fin_ desconhecida (fail-closed)",
      'await supabase.rpc("fin_algo_novo");',
      'chama a RPC "fin_algo_novo"',
    ],
    [
      "RPC de outro dominio",
      'await supabase.rpc("pedido_cancelar");',
      "fora da lista do modulo",
    ],
    [
      "RPC com nome em variavel",
      "await supabase.rpc(nomeDaRpc, { p });",
      "nome nao literal",
    ],
    [
      "insert direto em fin_lancamentos",
      'await supabase.from("fin_lancamentos").insert({ valor: 10 });',
      'grava na tabela "fin_lancamentos"',
    ],
    [
      "update/upsert/delete em fin_lancamentos, quebrado em linhas",
      'await supabase\n  .from("fin_lancamentos")\n  .upsert(linha);',
      'grava na tabela "fin_lancamentos"',
    ],
    [
      "gravar em tabela de outro dominio tambem reprova",
      'await supabase.from("pedidos").delete().eq("id", 1);',
      'grava na tabela "pedidos"',
    ],
    [
      "construtor guardado em variavel",
      'const t = supabase.from("fin_lancamentos");\nawait t.insert(linha);',
      "insert/update/upsert/delete no mesmo arquivo",
    ],
    [
      "lancamento ja pago montado pelo modulo (status)",
      'const l = { tipo: "saida", status: "realizado", valor: "10.00" };',
      'status/situacao "realizado"',
    ],
    [
      "lancamento ja pago montado pelo modulo (situacao)",
      'return { situacao: "realizado" };',
      'status/situacao "realizado"',
    ],
    [
      "simbolo de escrita usado sem import visivel",
      "const gravar = salvarLancamento;",
      "usa o simbolo de escrita salvarLancamento",
    ],
  ];

  it.each(RUINS)("reprova: %s", (_nome, fonte, trecho) => {
    const achados = violacoes(ARQ, fonte);
    expect(achados.length).toBeGreaterThan(0);
    expect(achados.join(" | ")).toContain(trecho);
  });

  it("a guia que cita a estimativa reprova (palavra perto do valor)", () => {
    const fonte =
      "const estimativa = 410;\nreturn { valor: String(estimativa) };";
    const achados = violacoes(GUIA_DO_MES, fonte);
    expect(achados).toContain("guia-do-mes.ts cita a estimativa");
  });

  it("a guia que importa o cálculo da estimativa reprova", () => {
    const fonte =
      'import { estimarSimples } from "@/lib/fiscal/estimativa-simples";';
    const achados = violacoes(GUIA_DO_MES, fonte);
    expect(achados).toContain("guia-do-mes.ts importa o calculo da estimativa");
  });

  it("a regra da guia vale SO para a guia (outro arquivo pode falar de estimativa)", () => {
    const fonte = "// a estimativa e so uma ideia\nexport const A = 1;";
    expect(violacoes("/src/lib/fiscal/textos.ts", fonte)).toEqual([]);
    expect(violacoes(GUIA_DO_MES, fonte)).not.toEqual([]);
  });
});

describe("controles negativos: o que a trava TEM de deixar passar", () => {
  const BONS: Array<[string, string]> = [
    [
      "leitura do Financeiro",
      'import { useDreMensal, type ConsultaFinanceira } from "@/hooks/useFinanceiro";',
    ],
    [
      "tipo do formulario (so tipo)",
      'import type { FormularioDoLancamento } from "@/lib/financeiro";',
    ],
    [
      "funcao pura do lib financeiro",
      'import { paraCentavos, ehDataIso } from "@/lib/financeiro";',
    ],
    [
      "o cadastro fiscal e a unica escrita",
      'await supabase.rpc("fiscal_cadastro_salvar", { p });',
    ],
    [
      "leitura da receita pelo fin_dre",
      'await supabase.rpc("fin_dre", { p_inicio, p_fim });',
    ],
    [
      "RPC com tipo generico e quebra de linha",
      'await supabase.rpc<Json>(\n  "fin_dre",\n  { p_inicio },\n);',
    ],
    [
      "ler o cadastro por tabela",
      'await supabase.from("fiscal_cadastro").select("*");',
    ],
    [
      "ler fin_lancamentos sem gravar",
      'await supabase.from("fin_lancamentos").select("id");',
    ],
    [
      "comparar (ler) o status realizado",
      'if (l.status === "realizado") continue;\nif (linha.status !== "realizado") return;',
    ],
    ["situacao previsto", 'return { tipo: "saida", situacao: "previsto" };'],
    [
      "simbolo de escrita citado so em comentario",
      "// nunca chamar salvarLancamento daqui\nexport const A = 1;",
    ],
    [
      "abrirFolha por prop (a forma certa)",
      "export function Botao({ abrirFolha }: { abrirFolha: (a: unknown) => void }) {\n  return abrirFolha;\n}",
    ],
    [
      "importa o hook de OUTRA coisa (basename diferente)",
      'import { x } from "@/hooks/useFinanceiroDoCliente";',
    ],
    [
      "uma barra dupla dentro de string nao e comentario",
      'const u = "https://exemplo.test"; const ok = 1;',
    ],
    [
      "Map.delete nao e gravar em tabela",
      "const m = new Map<string, number>();\nm.delete(chave);",
    ],
  ];

  it.each(BONS)("aceita: %s", (_nome, fonte) => {
    expect(violacoes(ARQ, fonte)).toEqual([]);
  });

  it("um apóstrofo solto em texto não engole o código seguinte (a trava segue enxergando)", () => {
    const fonte = [
      "export const Texto = () => <p>d'agua</p>;",
      'await supabase.rpc("fin_lancamento_salvar", { p });',
    ].join("\n");
    expect(violacoes(ARQ, fonte).join(" | ")).toContain(
      'chama a RPC "fin_lancamento_salvar"',
    );
  });

  it("código que vem depois de uma URL na mesma linha ainda é lido", () => {
    const fonte =
      'const u = "https://exemplo.test"; await salvarLancamento(p);';
    expect(violacoes(ARQ, fonte)).toContain(
      "usa o simbolo de escrita salvarLancamento",
    );
  });
});

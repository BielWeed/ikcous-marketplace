// @ts-nocheck
/**
 * scripts/db-prove-rollback.cjs prova o par (migration, rollback-manual)
 * antes de qualquer aplicação — ver o cabeçalho do próprio script para o
 * porquê. Este arquivo cobre as partes PURAS (Fase 0, comparação de fotos,
 * classificação) e a ORQUESTRAÇÃO (`provarPar`) com um client FALSO: nada
 * aqui abre conexão com banco de verdade, porque a suíte `test:unit` roda em
 * Deno, sem `pg` disponível — mesmo motivo por trás de
 * `tests/db_apply_rollback_test.ts` e do `require("pg")` tardio em
 * `scripts/db-apply.cjs`.
 *
 * A Fase 0 é o coração da testabilidade do contrato: ela decide SEM banco,
 * então dá para provar aqui, com string, que ela distingue:
 *   - BEGIN/COMMIT (e toda a família de controle de transação: END,
 *     ROLLBACK, ABORT, START TRANSACTION, PREPARE TRANSACTION, COMMIT
 *     PREPARED) de BEGIN/END de corpo PL/pgSQL (legítimo, não recusado) —
 *     essa é a asserção que separa uma trava útil de uma trava que ninguém
 *     liga;
 *   - CREATE FUNCTION cru (recusado, perde grants) de CREATE OR REPLACE
 *     FUNCTION (passa);
 *   - ocorrência real de BEGIN/COMMIT de ocorrência dentro de comentário ou
 *     de string (não deve disparar recusa nos dois casos).
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O smoke test contra o disco real lê `migrationPath`/`rollbackPath`, ambos
 * resolvidos por `resolverCaminhoMigration`/`resolverCaminhoRollback` contra
 * uma migration versionada deste próprio repositório — nunca contra entrada
 * externa. Mesma justificativa de scripts/db-prove-rollback.cjs.
 */
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  SqlMalformadoError,
  removerRuido,
  detectarCreateFunctionCru,
  detectarTransacaoExplicita,
  avaliarFase0,
  detectarAlvos,
  compararFotos,
  resumirDivergencias,
  classificarResultado,
  particionarPorAlvo,
  capturarXid,
  estaEmTransacao,
  normalizarAcl,
  tirarFotoCompleta,
  provarPar,
  codigoDeSaida,
  resolverCaminhoMigration,
  resolverCaminhoRollback,
  ESTADOS,
} = require("../scripts/db-prove-rollback.cjs");

// ---------------------------------------------------------------------------
// Fixtures — uma sintética e uma retirada do banco real de migrations do
// repositório (20260940000000_home_sections_em_store_config.sql), que já
// tem: comentário mencionando literalmente as palavras "BEGIN/COMMIT", uma
// `CREATE OR REPLACE FUNCTION` com corpo `$function$ ... BEGIN ... END
// $function$`, e uma string com apóstrofo dentro de RAISE EXCEPTION. Isso
// prova o comportamento contra código real, não só contra string fabricada.
// ---------------------------------------------------------------------------

const MIGRATION_REAL_OK = `
-- Sem BEGIN/COMMIT, de propósito: com eles o ROLLBACK do script de prova
-- vira no-op e a mudança fica gravada mesmo assim.

ALTER TABLE public.store_config ADD COLUMN IF NOT EXISTS home_sections jsonb;

CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não autorizado: Apenas admins podem configurar a loja.';
  END IF;

  UPDATE public.store_config SET home_sections = config_json->'home_sections';

  RETURN result;
END;
$function$;
`;

const MIGRATION_TRANSACAO_CRUA = `
BEGIN;
ALTER TABLE public.produtos ADD COLUMN foo text;
COMMIT;
`;

const MIGRATION_FUNCTION_CRUA = `
CREATE FUNCTION public.minha_fn() RETURNS void AS $$
BEGIN
  NULL;
END;
$$ LANGUAGE plpgsql;
`;

const MIGRATION_BEGIN_EM_COMENTARIO_E_STRING = `
-- Este comentario fala de BEGIN e de COMMIT, mas nao e transacao nenhuma.
CREATE OR REPLACE FUNCTION public.f()
 RETURNS text
 LANGUAGE plpgsql
AS $$
BEGIN
  RETURN 'o texto tem a palavra BEGIN e a palavra COMMIT dentro da string';
END;
$$;
`;

// ---------------------------------------------------------------------------
// removerRuido — a base de tudo. Se ela vazar o corpo de uma função, toda a
// Fase 0 vaza atrás.
// ---------------------------------------------------------------------------

Deno.test("removerRuido apaga comentário de linha, string e corpo dollar-quote", () => {
  const limpo = removerRuido(MIGRATION_BEGIN_EM_COMENTARIO_E_STRING);
  assert(
    !limpo.includes("Este comentario fala"),
    "o comentário de linha sobreviveu à limpeza",
  );
  assert(
    !/BEGIN.*a palavra COMMIT/s.test(limpo),
    "o corpo do dollar-quote sobreviveu à limpeza",
  );
});

// ---------------------------------------------------------------------------
// Fase 0 — CREATE FUNCTION cru vs. CREATE OR REPLACE FUNCTION
// ---------------------------------------------------------------------------

Deno.test("detectarCreateFunctionCru", async (t) => {
  await t.step("acusa CREATE FUNCTION sem OR REPLACE", () => {
    const achados = detectarCreateFunctionCru(
      removerRuido(MIGRATION_FUNCTION_CRUA),
    );
    assertEquals(achados.length, 1);
  });

  await t.step("não acusa CREATE OR REPLACE FUNCTION", () => {
    const achados = detectarCreateFunctionCru(removerRuido(MIGRATION_REAL_OK));
    assertEquals(achados, []);
  });
});

Deno.test("avaliarFase0 recusa CREATE FUNCTION cru", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_FUNCTION_CRUA,
    temRollback: true,
  });
  assert(r.recusado);
  assert(r.motivos.some((m) => /OR REPLACE/.test(m)));
});

Deno.test("avaliarFase0 passa CREATE OR REPLACE FUNCTION (migration real)", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    temRollback: true,
  });
  assertEquals(
    r.recusado,
    false,
    `motivos inesperados: ${r.motivos.join("; ")}`,
  );
});

// ---------------------------------------------------------------------------
// Fase 0 — a asserção que separa uma trava útil de uma trava inútil:
// controle de transação de nível superior é recusado; BEGIN/END de CORPO
// PL/pgSQL não é.
// ---------------------------------------------------------------------------

Deno.test("detectarTransacaoExplicita", async (t) => {
  await t.step("acusa BEGIN;/COMMIT; de transação", () => {
    const r = detectarTransacaoExplicita(
      removerRuido(MIGRATION_TRANSACAO_CRUA),
    );
    assert(r.begin, "não detectou o BEGIN de transação");
    assert(r.commit, "não detectou o COMMIT de transação");
  });

  await t.step(
    "NÃO acusa BEGIN/END de corpo PL/pgSQL (migration real do repositório)",
    () => {
      const r = detectarTransacaoExplicita(removerRuido(MIGRATION_REAL_OK));
      assertEquals(
        r.achados,
        [],
        "o BEGIN/END do corpo da função foi confundido com controle de transação",
      );
    },
  );

  await t.step(
    "NÃO acusa BEGIN dentro de comentário nem dentro de string",
    () => {
      const r = detectarTransacaoExplicita(
        removerRuido(MIGRATION_BEGIN_EM_COMENTARIO_E_STRING),
      );
      assertEquals(r.achados, []);
    },
  );
});

// ---------------------------------------------------------------------------
// B1 — a família INTEIRA de controle de transação, não só BEGIN/COMMIT.
// Medida pelo revisor contra o banco: END, ROLLBACK, ABORT, START
// TRANSACTION, PREPARE TRANSACTION e COMMIT PREPARED passavam despercebidos
// pela versão anterior, que só olhava \bBEGIN\b/\bCOMMIT\b.
// ---------------------------------------------------------------------------

const MIGRACOES_TRANSACAO_FAMILIA = {
  "END sozinho encerra a transação":
    "ALTER TABLE public.produtos ADD COLUMN foo text;\nEND;\n",
  ROLLBACK: "ALTER TABLE public.produtos ADD COLUMN foo text;\nROLLBACK;\n",
  ABORT: "ALTER TABLE public.produtos ADD COLUMN foo text;\nABORT;\n",
  "START TRANSACTION":
    "START TRANSACTION;\nALTER TABLE public.produtos ADD COLUMN foo text;\n",
  "PREPARE TRANSACTION":
    "ALTER TABLE public.produtos ADD COLUMN foo text;\nPREPARE TRANSACTION 'x';\n",
  "COMMIT PREPARED":
    "ALTER TABLE public.produtos ADD COLUMN foo text;\nCOMMIT PREPARED 'x';\n",
  "COMMIT AND CHAIN":
    "ALTER TABLE public.produtos ADD COLUMN foo text;\nCOMMIT AND CHAIN;\n",
};

Deno.test("detectarTransacaoExplicita recusa a família INTEIRA de controle de transação, não só BEGIN/COMMIT (B1)", async (t) => {
  for (const [nome, sql] of Object.entries(MIGRACOES_TRANSACAO_FAMILIA)) {
    await t.step(nome, () => {
      const r = detectarTransacaoExplicita(removerRuido(sql));
      assert(
        r.achados.length > 0,
        `não detectou controle de transação em: ${nome}`,
      );
    });
  }
});

Deno.test("avaliarFase0 recusa cada membro da família de controle de transação (B1)", async (t) => {
  for (const [nome, sql] of Object.entries(MIGRACOES_TRANSACAO_FAMILIA)) {
    await t.step(nome, () => {
      const r = avaliarFase0({ sqlMigration: sql, temRollback: true });
      assert(r.recusado, `deveria recusar: ${nome}`);
    });
  }
});

const MIGRATION_CASE_WHEN_END = `
ALTER TABLE public.produtos ALTER COLUMN status SET DEFAULT (CASE WHEN true THEN 1 ELSE 2 END);
`;

Deno.test("detectarTransacaoExplicita NÃO confunde END de expressão CASE WHEN com END de transação (medido pelo revisor)", () => {
  const r = detectarTransacaoExplicita(removerRuido(MIGRATION_CASE_WHEN_END));
  assertEquals(r.achados, []);
});

Deno.test("avaliarFase0 NÃO recusa uma migration com CASE WHEN ... END dentro de uma expressão", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_CASE_WHEN_END,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${r.motivos.join("; ")}`);
});

Deno.test("detectarTransacaoExplicita NÃO confunde ROLLBACK TO SAVEPOINT com ROLLBACK de transação", () => {
  const sql = "SAVEPOINT sp1;\nROLLBACK TO SAVEPOINT sp1;\n";
  const r = detectarTransacaoExplicita(removerRuido(sql));
  assertEquals(r.achados, []);
});

Deno.test("avaliarFase0 recusa migration com BEGIN/COMMIT de transação", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_TRANSACAO_CRUA,
    temRollback: true,
  });
  assert(r.recusado);
  assert(r.motivos.some((m) => /BEGIN\/COMMIT/.test(m)));
});

Deno.test("avaliarFase0 NÃO recusa migration real com BEGIN de corpo PL/pgSQL, comentário citando BEGIN/COMMIT e string com as palavras dentro", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${r.motivos.join("; ")}`);

  const r2 = avaliarFase0({
    sqlMigration: MIGRATION_BEGIN_EM_COMENTARIO_E_STRING,
    temRollback: true,
  });
  assertEquals(r2.recusado, false, `motivos: ${r2.motivos.join("; ")}`);
});

// ---------------------------------------------------------------------------
// Fase 0 — ausência do rollback-manual
// ---------------------------------------------------------------------------

Deno.test("avaliarFase0 recusa quando não há rollback-manual", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    temRollback: false,
  });
  assert(r.recusado);
  assert(r.motivos.some((m) => /rollback-manual/.test(m)));
});

// ---------------------------------------------------------------------------
// ITEM 1 (VOLTA) — o rollback-manual passa pela MESMA Fase 0 que a
// migration, porque ele roda dentro da mesma transação da prova: um
// `BEGIN;`/`COMMIT;` de nível superior no rollback encerra a transação da
// prova exatamente como no arquivo da migration.
// ---------------------------------------------------------------------------

Deno.test("avaliarFase0 recusa um ROLLBACK-MANUAL com controle de transação de nível superior, não só a migration (item 1a)", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    sqlRollback: MIGRATION_TRANSACAO_CRUA, // tem BEGIN;/COMMIT; reais
    temRollback: true,
  });
  assert(r.recusado, "deveria recusar o par por causa do rollback-manual");
  assert(
    r.motivos.some((m) =>
      /rollback-manual contém controle de transação/.test(m),
    ),
    `motivos não citam o rollback-manual: ${r.motivos.join("; ")}`,
  );
});

Deno.test("avaliarFase0 recusa o par quando o ROLLBACK-MANUAL tem um dollar-quote malformado", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    sqlRollback: MIGRATION_DOLLAR_QUOTE_SEM_FECHAMENTO,
    temRollback: true,
  });
  assert(r.recusado);
  assert(r.motivos.some((m) => /malformado \(rollback-manual\)/.test(m)));
});

Deno.test("avaliarFase0 NÃO recusa CREATE FUNCTION sem OR REPLACE quando está no ROLLBACK — só a migration é recusada por isso, no rollback é legítimo", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    sqlRollback: MIGRATION_FUNCTION_CRUA,
    temRollback: true,
  });
  assertEquals(
    r.recusado,
    false,
    `recusa falsa: motivos: ${r.motivos.join("; ")}`,
  );
});

Deno.test("avaliarFase0 continua funcionando quando sqlRollback não é informado (retrocompatibilidade: só avalia temRollback)", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_REAL_OK,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${r.motivos.join("; ")}`);
});

// ---------------------------------------------------------------------------
// Smoke test contra o disco real: uma migration + rollback-manual que já
// existem no repositório (não passa por banco — só Fase 0). Prova o
// comportamento contra código de produção, não só contra fixture fabricada.
// ---------------------------------------------------------------------------

Deno.test("Fase 0 não recusa uma migration real do repositório com rollback-manual existente", () => {
  const migrationPath = resolverCaminhoMigration(
    "20260940000000_home_sections_em_store_config.sql",
  );
  assert(migrationPath, "a migration de fixture não foi encontrada no disco");

  const rollbackPath = resolverCaminhoRollback(migrationPath, null);
  const fs = require("node:fs");
  assert(
    fs.existsSync(rollbackPath),
    `rollback-manual esperado não existe: ${rollbackPath}`,
  );

  const sqlMigration = fs.readFileSync(migrationPath, "utf8");
  const r = avaliarFase0({ sqlMigration, temRollback: true });
  assertEquals(r.recusado, false, `motivos: ${r.motivos.join("; ")}`);
});

// ---------------------------------------------------------------------------
// Resolução de caminho do rollback-manual — a convenção do repositório
// ---------------------------------------------------------------------------

Deno.test("resolverCaminhoRollback monta o nome pela convenção do repositório", () => {
  const migrationPath =
    "C:/algum/lugar/supabase/migrations/20260101000000_exemplo.sql";
  const r = resolverCaminhoRollback(migrationPath, null);
  assertStringIncludes(r, "rollback-manual-20260101000000_exemplo.sql");
});

Deno.test("resolverCaminhoRollback respeita --rollback quando informado", () => {
  const migrationPath =
    "C:/algum/lugar/supabase/migrations/20260101000000_exemplo.sql";
  const r = resolverCaminhoRollback(migrationPath, "outro-arquivo.sql");
  assertStringIncludes(r, "outro-arquivo.sql");
});

// ---------------------------------------------------------------------------
// detectarAlvos — o que a migration real acima realmente mexe
// ---------------------------------------------------------------------------

Deno.test("detectarAlvos acha a função e a tabela da migration real", () => {
  const alvos = detectarAlvos(MIGRATION_REAL_OK);
  assert(alvos.funcoes.includes("upsert_store_config"));
  assert(alvos.tabelas.includes("store_config"));
});

// ---------------------------------------------------------------------------
// compararFotos — igual vs. diferente, e QUE aponta o que diferiu
// ---------------------------------------------------------------------------

Deno.test("compararFotos", async (t) => {
  await t.step("fotos iguais -> fiel, sem diferenças", () => {
    const foto = { funcoes: { f: ["def"] }, tabelas: { t: { colunas: [] } } };
    const r = compararFotos(foto, JSON.parse(JSON.stringify(foto)));
    assertEquals(r.igual, true);
    assertEquals(r.diferencas, []);
  });

  await t.step("fotos diferentes -> infiel, e aponta O QUE diferiu", () => {
    const antes = { funcoes: { f: ["def antigo"] } };
    const depois = { funcoes: { f: ["def novo"] } };
    const r = compararFotos(antes, depois);
    assertEquals(r.igual, false);
    assert(r.diferencas.length > 0);
    assertStringIncludes(r.diferencas[0], "funcoes.f");
    assertStringIncludes(r.diferencas[0], "def antigo");
    assertStringIncludes(r.diferencas[0], "def novo");
  });

  await t.step("diferença aninhada aponta o caminho completo", () => {
    const antes = { tabelas: { pedidos: { colunas: [{ nome: "status" }] } } };
    const depois = { tabelas: { pedidos: { colunas: [{ nome: "estado" }] } } };
    const r = compararFotos(antes, depois);
    assertEquals(r.igual, false);
    assertStringIncludes(r.diferencas[0], "tabelas.pedidos.colunas");
  });
});

// ---------------------------------------------------------------------------
// C3 — compararFotos aponta só o ITEM que mudou dentro de um array, não a
// lista inteira. Antes, qualquer divergência num array (colunas, policies,
// índices, constraints, triggers) despejava as DUAS listas completas.
// ---------------------------------------------------------------------------

Deno.test("compararFotos aponta só o item que mudou dentro de um array grande, não a lista inteira (C3)", () => {
  const colunasGrandes = Array.from({ length: 26 }, (_, i) => ({
    column_name: `coluna_${i}`,
    data_type: "text",
  }));
  const antes = { tabelas: { t: { colunas: colunasGrandes } } };
  const depois = {
    tabelas: {
      t: {
        colunas: colunasGrandes.map((c, i) =>
          i === 10 ? { ...c, data_type: "int4" } : c,
        ),
      },
    },
  };
  const r = compararFotos(antes, depois);
  assertEquals(r.igual, false);
  assertEquals(
    r.diferencas.length,
    1,
    "deveria apontar só o campo que mudou, não a lista inteira",
  );
  assertStringIncludes(r.diferencas[0], "colunas.10.data_type");
  assert(
    !r.diferencas[0].includes('coluna_0"'),
    "a lista inteira vazou para o relatório — o C3 não foi corrigido",
  );
});

// ---------------------------------------------------------------------------
// classificarResultado — a árvore de decisão completa, sem precisar de banco
// ---------------------------------------------------------------------------

Deno.test("classificarResultado", async (t) => {
  await t.step(
    "controle positivo não reagiu -> INSTRUMENTO_QUEBRADO (não é sucesso)",
    () => {
      const r = classificarResultado({
        controlePositivoIgual: true,
        temSobrevivente: true,
        controleNegativoIgual: true,
        fidelidadeIgual: true,
      });
      assertEquals(r.estado, "INSTRUMENTO_QUEBRADO");
    },
  );

  await t.step(
    "sem sobrevivente -> INSTRUMENTO_QUEBRADO, mesmo com o resto perfeito",
    () => {
      const r = classificarResultado({
        controlePositivoIgual: false,
        temSobrevivente: false,
        controleNegativoIgual: true,
        fidelidadeIgual: true,
      });
      assertEquals(r.estado, "INSTRUMENTO_QUEBRADO");
    },
  );

  await t.step("controle negativo violado -> FALHOU", () => {
    const r = classificarResultado({
      controlePositivoIgual: false,
      temSobrevivente: true,
      controleNegativoIgual: false,
      fidelidadeIgual: true,
    });
    assertEquals(r.estado, "FALHOU");
  });

  await t.step("rollback infiel -> FALHOU", () => {
    const r = classificarResultado({
      controlePositivoIgual: false,
      temSobrevivente: true,
      controleNegativoIgual: true,
      fidelidadeIgual: false,
    });
    assertEquals(r.estado, "FALHOU");
  });

  await t.step(
    "tudo certo -> SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS (não se chama mais PROVADO)",
    () => {
      const r = classificarResultado({
        controlePositivoIgual: false,
        temSobrevivente: true,
        controleNegativoIgual: true,
        fidelidadeIgual: true,
      });
      assertEquals(r.estado, "SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS");
    },
  );
});

// ---------------------------------------------------------------------------
// Códigos de saída — todos distintos entre si, o `else` nunca é sucesso.
// ---------------------------------------------------------------------------

Deno.test("os cinco estados de saída têm códigos distintos", () => {
  const codigos = Object.values(ESTADOS);
  assertEquals(new Set(codigos).size, codigos.length, "há código repetido");
  assert(
    !Object.values(ESTADOS).includes(1),
    "1 é reservado para erro de uso/inesperado",
  );
});

// ---------------------------------------------------------------------------
// C8 — codigoDeSaida nunca devolve undefined (que sairia com 0, sucesso).
// C4 — resolvido por Map, sem indexação dinâmica de objeto.
// ---------------------------------------------------------------------------

Deno.test("codigoDeSaida", async (t) => {
  await t.step("devolve o código do estado conhecido", () => {
    assertEquals(codigoDeSaida("SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS"), 0);
    assertEquals(codigoDeSaida("FALHOU"), 3);
  });

  await t.step(
    "estado desconhecido devolve 1, NUNCA 0 (process.exit(undefined) sai com 0)",
    () => {
      assertEquals(codigoDeSaida("ESTADO_QUE_NAO_EXISTE"), 1);
      assertEquals(codigoDeSaida(undefined), 1);
      assertEquals(codigoDeSaida("PROVADO"), 1, "PROVADO não existe mais");
      assertEquals(codigoDeSaida("INSTRUMENTO_QUEBRADO_TYPO"), 1);
    },
  );
});

// ---------------------------------------------------------------------------
// B3 — os três furos do scanner de ruído (removerRuido), medidos ao vivo
// contra o código ATUAL antes da correção (ver o relatório da revisão).
// ---------------------------------------------------------------------------

const MIGRATION_ESCAPE_STRING_COM_COMMIT_REAL = `
CREATE OR REPLACE FUNCTION public.f() RETURNS void AS $$
BEGIN
  NULL;
END;
$$ LANGUAGE plpgsql;
INSERT INTO foo (a) VALUES (E'nao\\'da');
COMMIT;
`;

Deno.test("removerRuido entende string de escape (E'...') e não deixa a aspa escapada fechar a string cedo demais", () => {
  const limpo = removerRuido(MIGRATION_ESCAPE_STRING_COM_COMMIT_REAL);
  assertStringIncludes(
    limpo,
    "COMMIT",
    "o COMMIT real depois da string de escape foi engolido — a aspa " +
      "escapada (\\') fechou a string cedo e a aspa real virou a " +
      "ABERTURA de uma string nunca fechada que comeu o resto do arquivo",
  );
});

Deno.test("avaliarFase0 recusa quando o COMMIT real vem depois de uma string de escape com aspa escapada", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_ESCAPE_STRING_COM_COMMIT_REAL,
    temRollback: true,
  });
  assert(r.recusado, "o COMMIT real não deveria ter sido engolido");
  assert(r.motivos.some((m) => /COMMIT/.test(m)));
});

Deno.test("removerRuido remove comentário de bloco simples, não aninhado (M8 — nenhuma fixture tinha isso)", () => {
  const sql = "/* comentario qualquer com BEGIN e COMMIT dentro */\nSELECT 1;";
  const limpo = removerRuido(sql);
  assert(!limpo.includes("comentario qualquer"));
  assert(!/\bBEGIN\b/.test(limpo));
  assert(!/\bCOMMIT\b/.test(limpo));
  assertStringIncludes(limpo, "SELECT 1;");
});

const MIGRATION_COMENTARIO_ANINHADO_COM_PALAVRA_SENSIVEL = `
/* explica: /* uso interno */ BEGIN de um paragrafo qualquer, nao e SQL de verdade */
ALTER TABLE public.produtos ADD COLUMN qux text;
`;

Deno.test("removerRuido fecha comentário de bloco ANINHADO na profundidade certa, sem vazar a palavra do comentário externo", () => {
  const limpo = removerRuido(
    MIGRATION_COMENTARIO_ANINHADO_COM_PALAVRA_SENSIVEL,
  );
  assert(
    !/\bBEGIN\b/.test(limpo),
    "a palavra BEGIN do comentário externo vazou para o SQL limpo — " +
      "o scanner fechou no PRIMEIRO */ (do comentário interno) em vez " +
      "de esperar a profundidade zerar",
  );
  assertStringIncludes(limpo, "ALTER TABLE");
});

Deno.test("avaliarFase0 NÃO recusa uma migration válida só porque um comentário aninhado tem a palavra BEGIN dentro", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_COMENTARIO_ANINHADO_COM_PALAVRA_SENSIVEL,
    temRollback: true,
  });
  assertEquals(
    r.recusado,
    false,
    `recusa falsa: motivos: ${r.motivos.join("; ")}`,
  );
});

const MIGRATION_DOLLAR_QUOTE_SEM_FECHAMENTO = `
CREATE OR REPLACE FUNCTION public.f() RETURNS void AS $$
BEGIN
  NULL;
END;
COMMIT;
`;

Deno.test("removerRuido lança SqlMalformadoError quando um dollar-quote abre e nunca fecha (M3)", () => {
  let lançou = false;
  try {
    removerRuido(MIGRATION_DOLLAR_QUOTE_SEM_FECHAMENTO);
  } catch (e) {
    lançou = e instanceof SqlMalformadoError;
  }
  assert(
    lançou,
    "um dollar-quote sem fechamento deve ser SQL malformado, nunca " +
      '"resto do arquivo é ruído" (isso engoliria um COMMIT real)',
  );
});

Deno.test("avaliarFase0 recusa (por SQL malformado) quando o dollar-quote não fecha, em vez de engolir o COMMIT em silêncio", () => {
  const r = avaliarFase0({
    sqlMigration: MIGRATION_DOLLAR_QUOTE_SEM_FECHAMENTO,
    temRollback: true,
  });
  assert(r.recusado, "dollar-quote sem fechamento deveria recusar");
  assert(r.motivos.some((m) => /malformado/.test(m)));
});

// ---------------------------------------------------------------------------
// C9/C4 — particionarPorAlvo: tudo que não é alvo vira sobrevivente de graça.
// ---------------------------------------------------------------------------

Deno.test("particionarPorAlvo", async (t) => {
  const foto = {
    tabelas: {
      produtos: { colunas: [{ nome: "id" }] },
      _ninja_migrations: { colunas: [{ nome: "version" }] },
      pedidos: { colunas: [{ nome: "id" }] },
    },
    funcoes: {
      calcular_frete: [{ def: "def1" }],
      is_admin: [{ def: "def2" }],
    },
  };
  const alvos = { tabelas: ["produtos"], funcoes: ["calcular_frete"] };

  await t.step("alvo contém só o que foi detectado", () => {
    const { alvo } = particionarPorAlvo(foto, alvos);
    assertEquals(Object.keys(alvo.tabelas), ["produtos"]);
    assertEquals(Object.keys(alvo.funcoes), ["calcular_frete"]);
  });

  await t.step(
    "sobrevivente contém TUDO que não é alvo, não uma tabela arbitrária escolhida",
    () => {
      const { sobrevivente } = particionarPorAlvo(foto, alvos);
      assertEquals(
        new Set(Object.keys(sobrevivente.tabelas)),
        new Set(["_ninja_migrations", "pedidos"]),
        "o sobrevivente deveria ser TODO o resto do schema, não uma tabela só",
      );
      assertEquals(Object.keys(sobrevivente.funcoes), ["is_admin"]);
    },
  );

  await t.step("detecção de alvo é insensível a maiúscula/minúscula", () => {
    const { alvo } = particionarPorAlvo(foto, {
      tabelas: ["PRODUTOS"],
      funcoes: [],
    });
    assertEquals(Object.keys(alvo.tabelas), ["produtos"]);
  });
});

Deno.test("particionarPorAlvo: uma migration que desliga RLS numa tabela-alvo carrega o flag no lado do alvo (fecha o C4)", () => {
  const antes = {
    tabelas: { produtos: { relrowsecurity: true, colunas: [] } },
    funcoes: {},
  };
  const depois = {
    tabelas: { produtos: { relrowsecurity: false, colunas: [] } },
    funcoes: {},
  };
  const alvos = { tabelas: ["produtos"], funcoes: [] };
  const { alvo: alvoAntes } = particionarPorAlvo(antes, alvos);
  const { alvo: alvoDepois } = particionarPorAlvo(depois, alvos);
  const r = compararFotos(alvoAntes, alvoDepois);
  assert(
    !r.igual,
    "o flag relrowsecurity precisa entrar na comparação de fidelidade — " +
      "é isso que faz um rollback que esquece de religar o RLS dar FALHOU",
  );
  assertStringIncludes(r.diferencas[0], "relrowsecurity");
});

// ---------------------------------------------------------------------------
// C5 — resumirDivergencias separa conteúdo de formatação, sem afrouxar o
// veredito (o exit code continua o mesmo nos dois casos).
// ---------------------------------------------------------------------------

Deno.test("resumirDivergencias", async (t) => {
  await t.step(
    "corrida de espaços (reindentação) no MEIO do texto conta como formatação",
    () => {
      // JSON.stringify troca quebra de linha real por `\n` literal (duas
      // letras, não mais espaço em branco) — então só a corrida de espaços
      // ENTRE "BY" e "nome" colapsa aqui, nunca através de linha.
      const detalhes = [
        {
          caminho: "x",
          antes: "SELECT *\n    ORDER BY  nome",
          depois: "SELECT *\n    ORDER BY nome",
        },
      ];
      const r = resumirDivergencias(detalhes);
      assertEquals(r, { conteudo: 0, formatacao: 1 });
    },
  );

  await t.step("valor realmente diferente conta como conteúdo", () => {
    const detalhes = [{ caminho: "x", antes: "abc", depois: "xyz" }];
    const r = resumirDivergencias(detalhes);
    assertEquals(r, { conteudo: 1, formatacao: 0 });
  });

  await t.step(
    "chave que só existe de um lado (undefined) não derruba a função",
    () => {
      // JSON.stringify(undefined) devolve o valor `undefined` (não a string
      // "undefined") — sem guarda, `.replace` nele lança TypeError. Isto
      // acontece de verdade sempre que uma tabela/função só existe ANTES ou
      // só existe DEPOIS.
      const detalhes = [
        { caminho: "tabelas.nova_tabela", antes: undefined, depois: {} },
      ];
      const r = resumirDivergencias(detalhes);
      assertEquals(r, { conteudo: 1, formatacao: 0 });
    },
  );

  await t.step("lista vazia não conta nada", () => {
    assertEquals(resumirDivergencias([]), { conteudo: 0, formatacao: 0 });
  });
});

// ---------------------------------------------------------------------------
// C1 — capturarXid/estaEmTransacao: a trava de runtime, testável com um
// client falso (sem precisar de banco de verdade). Comparar o xid capturado
// no início contra o xid atual (em vez de perguntar "existe transação?")
// resolve o alarme falso do C1: uma migration só de leitura, ou só de
// comentário, nunca escreve nada, então `pg_current_xact_id_if_assigned()`
// (a versão antiga) devolvia NULL mesmo com a transação perfeitamente sã.
// ---------------------------------------------------------------------------

Deno.test("capturarXid devolve o xid retornado pela query", async () => {
  const client = {
    async query() {
      return { rows: [{ xid: "123" }] };
    },
  };
  const xid = await capturarXid(client);
  assertEquals(xid, "123");
});

Deno.test("estaEmTransacao", async (t) => {
  await t.step(
    "true quando o xid NÃO mudou — ainda dentro da MESMA transação (resolve o C1: migration só de leitura não vira alarme falso)",
    async () => {
      const client = {
        async query() {
          return { rows: [{ xid: "100" }] };
        },
      };
      const r = await estaEmTransacao(client, "100");
      assertEquals(r, true);
    },
  );

  await t.step(
    "false quando o xid MUDOU — um COMMIT/END escondido encerrou a transação (gatilho do B1/B2)",
    async () => {
      const client = {
        async query() {
          return { rows: [{ xid: "200" }] };
        },
      };
      const r = await estaEmTransacao(client, "100");
      assertEquals(r, false);
    },
  );
});

// ---------------------------------------------------------------------------
// C2 — tirarFotoCompleta tinha ZERO cobertura direta: um teste chamado
// "...fecha o C4" só construía a foto à mão e testava compararFotos, nunca a
// função real que lê o catálogo. Apagar relrowsecurity/column_default/
// policies/constraints/triggers da query real passava despercebido (27/27
// verdes). Estes testes chamam a função de verdade contra um client falso
// que devolve linhas de catálogo canônicas.
// ---------------------------------------------------------------------------

function clientFalsoCatalogo({
  tabelas = [],
  colunas = [],
  funcoes = [],
  policies = [],
  indices = [],
  constraints = [],
  triggers = [],
}) {
  return {
    async query(sql) {
      if (/FROM pg_class/.test(sql)) return { rows: tabelas };
      if (/information_schema\.columns/.test(sql)) return { rows: colunas };
      if (/FROM pg_proc/.test(sql)) return { rows: funcoes };
      if (/pg_policies/.test(sql)) return { rows: policies };
      if (/pg_indexes/.test(sql)) return { rows: indices };
      if (/pg_constraint/.test(sql)) return { rows: constraints };
      if (/pg_trigger/.test(sql)) return { rows: triggers };
      throw new Error(`clientFalsoCatalogo: query não reconhecida: ${sql}`);
    },
  };
}

Deno.test("tirarFotoCompleta carrega os campos dos quais a fidelidade depende (fecha o C2 — a função real não tinha nenhum teste direto)", async (t) => {
  await t.step(
    "relrowsecurity, relforcerowsecurity, acl, owner, column_default, policies, constraints, triggers",
    async () => {
      const client = clientFalsoCatalogo({
        tabelas: [
          {
            nome: "produtos",
            relkind: "r",
            relrowsecurity: true,
            relforcerowsecurity: false,
            acl: "{admin=arwdDxt/admin}",
            owner: "postgres",
            viewdef: null,
          },
        ],
        colunas: [
          {
            table_name: "produtos",
            column_name: "preco",
            data_type: "numeric",
            is_nullable: "NO",
            column_default: "0",
          },
        ],
        policies: [
          {
            tablename: "produtos",
            policyname: "p1",
            cmd: "SELECT",
            permissive: "PERMISSIVE",
            roles: ["public"],
            qual: "true",
            with_check: null,
          },
        ],
        constraints: [
          {
            tablename: "produtos",
            conname: "produtos_pkey",
            contype: "p",
            definicao: "PRIMARY KEY (id)",
          },
        ],
        triggers: [
          {
            tablename: "produtos",
            tgname: "trg1",
            definicao: "CREATE TRIGGER trg1 ...",
          },
        ],
      });
      const foto = await tirarFotoCompleta(client);
      const t1 = foto.tabelas.produtos;
      assertEquals(
        t1.relrowsecurity,
        true,
        "relrowsecurity não chegou na foto",
      );
      assertEquals(
        t1.relforcerowsecurity,
        false,
        "relforcerowsecurity não chegou na foto",
      );
      assertEquals(t1.acl, "{admin=arwdDxt/admin}", "acl não chegou na foto");
      assertEquals(t1.owner, "postgres", "owner não chegou na foto");
      assertEquals(
        t1.colunas[0].column_default,
        "0",
        "column_default não chegou na foto",
      );
      assertEquals(t1.policies.length, 1, "policy não chegou na foto");
      assertEquals(t1.constraints.length, 1, "constraint não chegou na foto");
      assertEquals(t1.triggers.length, 1, "trigger não chegou na foto");
    },
  );

  await t.step(
    "view e matview entram na foto com viewdef (fecha o B2 — antes eram invisíveis dos dois lados)",
    async () => {
      const client = clientFalsoCatalogo({
        tabelas: [
          {
            nome: "vw_pedidos_resumo",
            relkind: "v",
            relrowsecurity: false,
            relforcerowsecurity: false,
            acl: null,
            owner: "postgres",
            viewdef: "SELECT id FROM pedidos;",
          },
          {
            nome: "mv_vendas_dia",
            relkind: "m",
            relrowsecurity: false,
            relforcerowsecurity: false,
            acl: null,
            owner: "postgres",
            viewdef: "SELECT dia, total FROM vendas;",
          },
        ],
      });
      const foto = await tirarFotoCompleta(client);
      assert(foto.tabelas.vw_pedidos_resumo, "view não entrou na foto");
      assertEquals(
        foto.tabelas.vw_pedidos_resumo.viewdef,
        "SELECT id FROM pedidos;",
      );
      assert(foto.tabelas.mv_vendas_dia, "matview não entrou na foto");
      assertEquals(
        foto.tabelas.mv_vendas_dia.viewdef,
        "SELECT dia, total FROM vendas;",
      );
    },
  );

  await t.step("sequence entra na foto — mesma porta das views", async () => {
    const client = clientFalsoCatalogo({
      tabelas: [
        {
          nome: "produtos_id_seq",
          relkind: "S",
          relrowsecurity: false,
          relforcerowsecurity: false,
          acl: null,
          owner: "postgres",
          viewdef: null,
        },
      ],
    });
    const foto = await tirarFotoCompleta(client);
    assert(foto.tabelas.produtos_id_seq, "sequence não entrou na foto");
    assertEquals(foto.tabelas.produtos_id_seq.relkind, "S");
  });
});

Deno.test("tirarFotoCompleta consulta pg_class incluindo view, matview e sequence no relkind, DENTRO do WHERE (fecha o B2 na FONTE — e o item 4: a asserção antiga procurava a string no texto inteiro, e 'v'/'m' também aparecem na cláusula CASE WHEN de viewdef, que é outro lugar)", async () => {
  let sqlDaConsultaDeTabelas = "";
  const client = {
    async query(sql) {
      if (/FROM pg_class/.test(sql)) {
        sqlDaConsultaDeTabelas = sql;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  await tirarFotoCompleta(client);
  // ITEM 4: extrai a lista de dentro do WHERE (nunca "includes" no texto
  // inteiro) — um mutante que restringisse só o WHERE para
  // `relkind IN ('r','p','S')`, deixando view/matview invisíveis de novo,
  // sobrevivia à asserção antiga porque 'v'/'m' continuavam presentes na
  // cláusula `CASE WHEN c.relkind IN ('v', 'm')` (medido pelo revisor: 41
  // passed, idêntico ao controle).
  const match = /WHERE[\s\S]*?relkind\s+IN\s*\(([^)]+)\)/i.exec(
    sqlDaConsultaDeTabelas,
  );
  assert(
    match,
    "não encontrou 'WHERE ... relkind IN (...)' na query de pg_class",
  );
  const listaDoWhere = match[1];
  for (const relkind of ["'r'", "'p'", "'v'", "'m'", "'S'"]) {
    assert(
      listaDoWhere.includes(relkind),
      `o WHERE da query de pg_class não inclui o relkind ${relkind} — view/matview/sequence ficariam invisíveis`,
    );
  }
});

// ---------------------------------------------------------------------------
// ITEM 2 (VOLTA) — a foto de colunas passa a resolver o TIPO COMPLETO
// (`format_type(a.atttypid, a.atttypmod)`, de `pg_attribute`), não só o nome
// nu que `information_schema.columns.data_type` devolve — `varchar(10)` e
// `varchar(255)` são os dois `character varying`; `numeric(10,2)` e
// `numeric(18,6)` são os dois `numeric`; um rollback que esquece de
// devolver a precisão/tamanho original passava como "nada mudou".
// ---------------------------------------------------------------------------

Deno.test("tirarFotoCompleta lê o tipo de coluna via format_type/atttypmod (pg_attribute), não só data_type puro (item 2)", async () => {
  let sqlDaConsultaDeColunas = "";
  const client = {
    async query(sql) {
      if (/information_schema\.columns/.test(sql)) {
        sqlDaConsultaDeColunas = sql;
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  await tirarFotoCompleta(client);
  assertStringIncludes(
    sqlDaConsultaDeColunas,
    "format_type",
    "a query de colunas não usa format_type — o modificador de tipo (precisão/tamanho) continua invisível",
  );
  assertStringIncludes(
    sqlDaConsultaDeColunas,
    "atttypmod",
    "format_type sem atttypmod não resolve o modificador do tipo",
  );
  assertStringIncludes(
    sqlDaConsultaDeColunas,
    "pg_attribute",
    "o tipo completo precisa vir de pg_attribute, não só de information_schema.columns",
  );
});

Deno.test("B2 — rollback que restaura a coluna mas esquece uma view infiel dá FALHOU, não sucesso (tirarFotoCompleta + particionarPorAlvo + compararFotos, sem banco)", async () => {
  const antes = clientFalsoCatalogo({
    tabelas: [
      {
        nome: "produtos",
        relkind: "r",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: null,
      },
      {
        nome: "vw_produtos_ativos",
        relkind: "v",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: "SELECT id FROM produtos WHERE ativo;",
      },
    ],
  });
  const depoisRestauradoParcial = clientFalsoCatalogo({
    tabelas: [
      {
        nome: "produtos",
        relkind: "r",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: null,
      },
      // rollback ESQUECEU de restaurar a view — a definição ficou diferente
      {
        nome: "vw_produtos_ativos",
        relkind: "v",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: "SELECT id, nome FROM produtos WHERE ativo;",
      },
    ],
  });
  const alvos = { tabelas: ["produtos", "vw_produtos_ativos"], funcoes: [] };

  const fotoAntes = await tirarFotoCompleta(antes);
  const fotoFinal = await tirarFotoCompleta(depoisRestauradoParcial);
  const { alvo: alvoAntes } = particionarPorAlvo(fotoAntes, alvos);
  const { alvo: alvoFinal } = particionarPorAlvo(fotoFinal, alvos);

  const fidelidade = compararFotos(alvoAntes, alvoFinal);
  assert(
    !fidelidade.igual,
    "a view infiel deveria ter sido detectada — antes do B2 ela era " +
      "invisível dos dois lados (relkind IN ('r','p') só)",
  );
  assertStringIncludes(fidelidade.diferencas.join("\n"), "viewdef");
});

// ---------------------------------------------------------------------------
// ITEM 3 (falso positivo) — normalizarAcl. `aclitem[]` não tem ordem
// semântica, mas `relacl::text`/`proacl::text` renderizam na ordem física de
// armazenamento, que muda quando um grantee some do array inteiro e volta
// depois (REVOKE seguido de re-GRANT). A armadilha: normalizar tem que
// preservar a distinção entre os TRÊS estados — NULL (privilégio padrão),
// '{}' (tudo revogado) e um ACL povoado — senão um rollback que esquece de
// restaurar grants vira falso NEGATIVO em vez do falso POSITIVO de hoje.
// ---------------------------------------------------------------------------

Deno.test("normalizarAcl", async (t) => {
  await t.step("NULL continua NULL (privilégio padrão)", () => {
    assertEquals(normalizarAcl(null), null);
  });

  await t.step(
    "undefined continua undefined (mesmo tratamento de NULL)",
    () => {
      assertEquals(normalizarAcl(undefined), undefined);
    },
  );

  await t.step("'{}' continua '{}' (tudo revogado, inclusive do dono)", () => {
    assertEquals(normalizarAcl("{}"), "{}");
  });

  await t.step(
    "o MESMO conjunto de grants em ordem diferente normaliza para o mesmo valor (o falso positivo do 20260990)",
    () => {
      const antes =
        "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}";
      const depois =
        "{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}";
      assertEquals(normalizarAcl(antes), normalizarAcl(depois));
    },
  );

  await t.step(
    "um grant a MENOS continua sendo detectado depois de normalizar (não virou cego)",
    () => {
      const completo = "{postgres=X/postgres,anon=X/postgres}";
      const soDono = "{postgres=X/postgres}";
      assert(normalizarAcl(completo) !== normalizarAcl(soDono));
    },
  );

  await t.step(
    "os três estados (NULL, '{}', povoado) continuam distinguíveis entre si depois de normalizar — a armadilha do array_agg com unnest colapsaria NULL e '{}' no mesmo valor",
    () => {
      const povoado = normalizarAcl("{postgres=X/postgres}");
      const distintos = new Set([
        normalizarAcl(null),
        normalizarAcl("{}"),
        povoado,
      ]);
      assertEquals(
        distintos.size,
        3,
        "dois dos três estados colapsaram no mesmo valor depois de normalizar",
      );
    },
  );
});

// ---------------------------------------------------------------------------
// C2 — provarPar: a orquestração extraída de main(). Fecha o mutante "main
// perde as DUAS travas" (sobrevivia porque main() nunca era chamado por
// nenhum teste) e a lacuna "erro do Postgres -> FALHOU". bancoSimulado é um
// client FALSO com estado: entende o protocolo de xid de
// capturarXid/estaEmTransacao, as 7 queries de tirarFotoCompleta, e reage a
// marcadores (`__FALHA__`, `__ENCERRA_TRANSACAO__`, `__MUDA_COLUNA__`,
// `__DESFAZ_COLUNA__`) embutidos no texto da migration/rollback simulados —
// nunca precisa de banco real.
// ---------------------------------------------------------------------------

function catalogoBase(colunasProdutos) {
  return {
    tabelas: [
      {
        nome: "produtos",
        relkind: "r",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: null,
      },
      {
        nome: "pedidos",
        relkind: "r",
        relrowsecurity: false,
        relforcerowsecurity: false,
        acl: null,
        owner: "postgres",
        viewdef: null,
      },
    ],
    colunas: [
      ...colunasProdutos.map((nome) => ({
        table_name: "produtos",
        column_name: nome,
        data_type: "text",
        is_nullable: "YES",
        column_default: null,
      })),
      {
        table_name: "pedidos",
        column_name: "id",
        data_type: "uuid",
        is_nullable: "NO",
        column_default: null,
      },
    ],
    funcoes: [],
    policies: [],
    indices: [],
    constraints: [],
    triggers: [],
  };
}

function bancoSimulado(catalogoInicial) {
  let catalogo = catalogoInicial;
  let emTransacaoExplicita = true; // provarPar só roda depois do BEGIN
  const xidDaTransacao = "1";
  let contadorXid = 1;

  return {
    async query(sqlBruto) {
      const sql = String(sqlBruto).trim();

      if (/pg_current_xact_id/.test(sql)) {
        if (emTransacaoExplicita) return { rows: [{ xid: xidDaTransacao }] };
        contadorXid += 1;
        return { rows: [{ xid: `implicita-${contadorXid}` }] };
      }
      if (/FROM pg_class/.test(sql)) return { rows: catalogo.tabelas };
      if (/information_schema\.columns/.test(sql))
        return { rows: catalogo.colunas };
      if (/FROM pg_proc/.test(sql)) return { rows: catalogo.funcoes };
      if (/pg_policies/.test(sql)) return { rows: catalogo.policies };
      if (/pg_indexes/.test(sql)) return { rows: catalogo.indices };
      if (/pg_constraint/.test(sql)) return { rows: catalogo.constraints };
      if (/pg_trigger/.test(sql)) return { rows: catalogo.triggers };

      // A partir daqui, `sql` é a migration ou o rollback-manual simulados.
      // ITEM 1b: `__ENCERRA_E_FALHA__` simula exatamente o sub-cenário do
      // cabeçalho da tarefa — `DROP COLUMN zzz; COMMIT; DROP COLUMN
      // nao_existe;` — um COMMIT real seguido de um erro de SQL NA MESMA
      // chamada. Checado ANTES de `__FALHA__` (que por si só não encerra a
      // transação) para o catch de `provarPar` ver os dois efeitos juntos.
      if (sql.includes("__ENCERRA_E_FALHA__")) {
        emTransacaoExplicita = false;
        throw new Error(
          "erro de sintaxe simulado depois de um COMMIT escondido (SQLSTATE 42601)",
        );
      }
      if (sql.includes("__FALHA__")) {
        throw new Error("erro de sintaxe simulado (SQLSTATE 42601)");
      }
      if (sql.includes("__ENCERRA_TRANSACAO__")) emTransacaoExplicita = false;
      if (sql.includes("__MUDA_COLUNA__"))
        catalogo = catalogoBase(["id", "novo"]);
      if (sql.includes("__DESFAZ_COLUNA__")) catalogo = catalogoBase(["id"]);
      return { rows: [] };
    },
  };
}

Deno.test("provarPar: migration que encerra a transação escondida vira INSTRUMENTO_QUEBRADO, nunca sucesso silencioso (B1, fecha o mutante das DUAS travas)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration: "-- __ENCERRA_TRANSACAO__",
    sqlRollback: "-- nunca deveria rodar",
  });
  assertEquals(r.veredito, "INSTRUMENTO_QUEBRADO");
  assertStringIncludes(r.detalhe, "a migration encerrou");
  assertStringIncludes(r.detalhe, "JÁ ESTÁ GRAVADA");
});

Deno.test("provarPar: rollback-manual que encerra a transação escondida vira INSTRUMENTO_QUEBRADO (B1, segunda trava)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration:
      "ALTER TABLE public.produtos ADD COLUMN novo text; -- __MUDA_COLUNA__",
    sqlRollback: "-- __ENCERRA_TRANSACAO__",
  });
  assertEquals(r.veredito, "INSTRUMENTO_QUEBRADO");
  assertStringIncludes(r.detalhe, "rollback-manual encerrou");
});

Deno.test("provarPar: erro real do Postgres ao aplicar a migration vira FALHOU, nunca INDETERMINADO (fecha a lacuna do C7/C2)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration: "-- __FALHA__",
    sqlRollback: "-- nunca deveria rodar",
  });
  assertEquals(r.veredito, "FALHOU");
  assertStringIncludes(r.detalhe, "migration falhou ao aplicar");
});

Deno.test("provarPar: erro real do Postgres ao aplicar o rollback-manual vira FALHOU", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration:
      "ALTER TABLE public.produtos ADD COLUMN novo text; -- __MUDA_COLUNA__",
    sqlRollback: "-- __FALHA__",
  });
  assertEquals(r.veredito, "FALHOU");
  assertStringIncludes(r.detalhe, "rollback-manual falhou ao aplicar");
});

// ---------------------------------------------------------------------------
// ITEM 1b (VOLTA) — o sub-cenário onde nem o aviso saía: um COMMIT real
// escondido seguido de um erro de SQL na MESMA aplicação. Antes da correção
// o `catch` marcava `abortou = true` e a checagem de xid, presa atrás de
// `!abortou &&`, nunca rodava — o veredito saía FALHOU comum, sem uma
// palavra sobre a gravação. Agora a checagem roda TAMBÉM dentro do catch.
// ---------------------------------------------------------------------------

Deno.test("provarPar: erro na migration DEPOIS de um COMMIT escondido vira INSTRUMENTO_QUEBRADO, não FALHOU mudo (item 1b)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration: "-- __ENCERRA_E_FALHA__",
    sqlRollback: "-- nunca deveria rodar",
  });
  assertEquals(r.veredito, "INSTRUMENTO_QUEBRADO");
  assertStringIncludes(r.detalhe, "migration falhou ao aplicar");
  assertStringIncludes(r.detalhe, "JÁ ESTÁ GRAVADA");
});

Deno.test("provarPar: erro no rollback-manual DEPOIS de um COMMIT escondido também vira INSTRUMENTO_QUEBRADO (item 1b, segunda metade)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration:
      "ALTER TABLE public.produtos ADD COLUMN novo text; -- __MUDA_COLUNA__",
    sqlRollback: "-- __ENCERRA_E_FALHA__",
  });
  assertEquals(r.veredito, "INSTRUMENTO_QUEBRADO");
  assertStringIncludes(r.detalhe, "rollback-manual falhou ao aplicar");
  assertStringIncludes(r.detalhe, "JÁ ESTÁ GRAVADA");
});

Deno.test("provarPar: erro COMUM (sem COMMIT escondido) continua FALHOU, não vira INSTRUMENTO_QUEBRADO por engano (controle negativo do item 1b)", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration: "-- __FALHA__",
    sqlRollback: "-- nunca deveria rodar",
  });
  assertEquals(
    r.veredito,
    "FALHOU",
    "um erro de SQL comum, sem transação encerrada por baixo, não deveria virar INSTRUMENTO_QUEBRADO",
  );
});

Deno.test("provarPar: par fiel dá o veredito de sucesso NOVO, com as dimensões medidas e não medidas na saída", async () => {
  const client = bancoSimulado(catalogoBase(["id"]));
  const r = await provarPar(client, {
    sqlMigration:
      "ALTER TABLE public.produtos ADD COLUMN novo text; -- __MUDA_COLUNA__",
    sqlRollback:
      "ALTER TABLE public.produtos DROP COLUMN novo; -- __DESFAZ_COLUNA__",
  });
  assertEquals(r.veredito, "SEM_DIVERGENCIA_NAS_DIMENSOES_MEDIDAS");
  assertStringIncludes(r.detalhe, "dimensões MEDIDAS");
  assertStringIncludes(r.detalhe, "dimensões NÃO medidas");
  assertStringIncludes(r.detalhe, "dado de linha");
});

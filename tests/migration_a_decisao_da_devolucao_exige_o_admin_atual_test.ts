// @ts-nocheck
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp --
 * Toda chave indexada e todo RegExp montado aqui vêm de constante do próprio
 * teste (RPCS, antes/depois/desfeito) ou do texto das migrations do
 * repositório; nunca de entrada de rede nem de payload de terceiro. */
// A DECISÃO DA DEVOLUÇÃO EXIGE O ADMIN DE AGORA — prova offline do par
// 20261200000000 + rollback (permissão + dado de cliente, 04/10/2026; ressalva
// R-b da revisão Opus da 20261199000000). O COMPORTAMENTO (ex-admin com JWT
// velho recusado nas três RPCs sem escrita; admin, service_role e postgres
// como antes; controle sem a guarda; rollback e preflights) é provado em
// tests/banco/admin-atual-devolucao-viva.cjs, no rpc-ci; aqui fica o que se
// prova só lendo o texto, no `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: corpo que não é o vigente + a
// guarda apaga em silêncio a correção de outra migration; guarda com outra
// mensagem/SQLSTATE muda o que o painel mostra; guarda depois de trava ou
// escrita grava pela metade ou deixa o rebaixado descobrir se a devolução
// existe; rollback que não volta byte a byte deixa a regra presa depois de
// "revertida"; hash de preflight que não é o md5 real recusa num banco
// correto (ou aceita corpo errado); GRANT/REVOKE/DROP escondido muda ACL; e
// função de outra frente redefinida aqui apaga o trabalho dela.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261200000000_a_decisao_da_devolucao_exige_o_admin_atual.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo desta migration, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert(i >= 0, `${nome} não encontrada`);
  assertEquals(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
/** O que o Postgres grava em prosrc: entre `AS $$` e `$$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $$") + "AS $$".length,
    texto.length - "$$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $$"));

const reCriacao = (nome) =>
  new RegExp(
    `^CREATE (OR REPLACE )?FUNCTION (public\\.|"public"\\.)${nome}"?\\(`,
    "gm",
  );

/** O corpo (prosrc) da ÚLTIMA definição da função num arquivo de migration. */
const corpoNaFonte = (arquivo, nome) => {
  const t = ler(arquivo);
  const re = reCriacao(nome);
  let m;
  let ultimo = -1;
  while ((m = re.exec(t))) ultimo = m.index;
  assert(ultimo >= 0, `${nome} não está em ${arquivo}`);
  const resto = t.slice(ultimo);
  const tag = /\bAS\s+(\$[A-Za-z0-9_]*\$)/.exec(resto);
  const ini = tag.index + tag[0].length;
  return resto.slice(ini, resto.indexOf(tag[1], ini));
};

const COMENTARIO =
  "-- Papel ATUAL (auth.users E profiles), não o do JWT: admin rebaixado para aqui (20261200000000).";

// As três RPCs e de onde vem o corpo vigente de cada uma.
const FONTE = "20261175000000_a_devolucao_nasce_no_pedido.sql";
const RPCS = [
  ["admin_devolucao_decidir", FONTE],
  ["admin_devolucao_registrar", FONTE],
  ["admin_devolucao_reprovar", FONTE],
];
const BASELINE = "20260806000000_baseline_do_schema_vivo.sql";

/** A regra da guarda: copia o bloco do is_admin() com is_admin_atual(), logo depois dele. */
const comGuarda = (nome, src) => {
  const alvo = "public.is_admin()";
  assertEquals(
    src.split(alvo).length - 1,
    1,
    `${nome}: is_admin() tem de aparecer uma vez`,
  );
  const i = src.indexOf(alvo);
  const iniLinha = src.lastIndexOf("\n", i) + 1;
  const s = /^[ \t]*/.exec(src.slice(iniLinha))[0];
  const fecho = `\n${s}END IF;\n`;
  const fim = src.indexOf(fecho, i) + fecho.length;
  const bloco = src.slice(iniLinha, fim);
  assert(/^[ \t]*IF /.test(bloco), `${nome}: o is_admin() não abre um IF`);
  const guarda = bloco.replace(alvo, "public.is_admin_atual()");
  return `${src.slice(0, fim)}${s}${COMENTARIO}\n${guarda}${src.slice(fim)}`;
};

const antes = {};
const depois = {};
const desfeito = {};
for (const [nome, fonte] of RPCS) {
  antes[nome] = corpoNaFonte(fonte, nome);
  depois[nome] = funcao(migration, nome);
  desfeito[nome] = funcao(rollback, nome);
}

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("as 3 funções (e só elas) são redefinidas, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assertEquals(nomes.sort(), RPCS.map(([n]) => n).sort());
  }
  // Fronteira: nada das irmãs já guardadas nem das frentes em voo.
  for (const fora of [
    "admin_devolucao_concluir",
    "admin_devolucao_reemitir_reembolso",
    "admin_devolucao_liberar_vinculo_reverso",
    "admin_devolucoes_listar",
    "devolucao_detalhe",
    "salvar_politica_de_devolucao",
    "update_order_status_atomic",
    "cancelar_pedido_com_cobranca",
    "pedido__mudar_status",
    "is_admin",
    "is_admin_atual",
    "rls_admin_atual",
  ]) {
    assert(
      !semComentarios(migration).includes(`FUNCTION public.${fora}(`),
      `${fora} redefinida`,
    );
  }
});

Deno.test("o ponto de partida de cada função é a ÚLTIMA definição dela antes desta migration", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  for (const [nome, fonte] of RPCS) {
    const re = reCriacao(nome);
    const com = nomes.filter((n) => {
      re.lastIndex = 0;
      return re.test(ler(n));
    });
    assertEquals(com.at(-1), fonte, nome);
  }
});

Deno.test("cada RPC é o corpo vigente byte a byte + UMA guarda, cópia do bloco do is_admin() com is_admin_atual()", () => {
  for (const [nome] of RPCS) {
    assertEquals(corpo(depois[nome]), comGuarda(nome, antes[nome]), nome);
    assertEquals(
      depois[nome].split("public.is_admin_atual()").length - 1,
      1,
      `${nome}: a guarda entra uma vez só`,
    );
    assertEquals(
      depois[nome].split("public.is_admin()").length - 1,
      1,
      `${nome}: o bloco do is_admin() continua`,
    );
  }
});

Deno.test("a guarda recusa com a MESMA mensagem e o MESMO SQLSTATE do 'não é admin' de sempre (42501 'Acesso negado.')", () => {
  for (const [nome] of RPCS) {
    const c = corpo(depois[nome]);
    const i = c.indexOf("public.is_admin()");
    const j = c.indexOf("public.is_admin_atual()");
    const saida = (k) =>
      c.slice(c.indexOf("THEN\n", k), c.indexOf("END IF;", k));
    assertEquals(saida(j), saida(i), nome);
    assertStringIncludes(
      saida(j),
      "RAISE EXCEPTION 'Acesso negado.' USING ERRCODE = '42501';",
    );
  }
});

Deno.test("a guarda vem ANTES de qualquer leitura de devolução, trava ou escrita (sem oráculo de existência)", () => {
  for (const [nome] of RPCS) {
    const c = semComentarios(corpo(depois[nome]));
    const iGuarda = c.indexOf("public.is_admin_atual()");
    for (const efeito of [
      /\bSELECT\b/,
      /\bFOR UPDATE\b/,
      /\bUPDATE public\./,
      /\bINSERT INTO\b/,
      /\bDELETE FROM\b/,
      /\bLOCK TABLE\b/,
      /\bPERFORM\b/,
      /\bP0002\b/,
    ]) {
      const m = efeito.exec(c);
      assert(
        m === null || m.index > iGuarda,
        `${nome}: ${efeito} antes da guarda`,
      );
    }
  }
});

Deno.test("o rollback restaura o TEXTO de cada uma das 3 byte a byte, com o mesmo cabeçalho", () => {
  for (const [nome] of RPCS) {
    assertEquals(corpo(desfeito[nome]), antes[nome], nome);
    assert(
      !desfeito[nome].includes("is_admin_atual"),
      `${nome}: guarda no rollback`,
    );
    assertEquals(
      cabecalho(desfeito[nome]),
      cabecalho(depois[nome]),
      `${nome}: cabeçalho`,
    );
    assert(!corpo(depois[nome]).includes("$$"), `${nome}: $$ dentro do corpo`);
  }
});

Deno.test("os preflights citam o md5 REAL de cada corpo (vigente e desta), o is_admin() da baseline e o is_admin_atual() da 97", () => {
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261200$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261200$"),
  );
  for (const [nome] of RPCS) {
    const velho = md5(antes[nome]);
    const novo = md5(corpo(depois[nome]));
    assert(velho !== novo, nome);
    assert(
      new RegExp(
        `\\('public\\.${nome}\\([^)]*\\)', '${velho}', '${novo}'\\)`,
      ).test(preflight),
      `${nome}: preflight`,
    );
    assert(
      new RegExp(`\\('public\\.${nome}\\([^)]*\\)', '${novo}'\\)`).test(
        preflightRb,
      ),
      `${nome}: preflight do rollback`,
    );
    assert(
      !preflightRb.includes(`'${velho}'`),
      `${nome}: o rollback só desfaz o corpo NOVO`,
    );
  }
  const baseline = ler(BASELINE);
  const i = baseline.indexOf(
    "CREATE FUNCTION public.is_admin() RETURNS boolean",
  );
  const isAdmin = baseline.slice(
    i,
    baseline.indexOf("\n$$;", i) + "\n$$;".length,
  );
  assertStringIncludes(preflight, `IS DISTINCT FROM '${md5(corpo(isAdmin))}'`);
  const da97 = ler("20261197000000_dinheiro_exige_admin_atual.sql");
  const atual = funcao(da97, "is_admin_atual");
  assertStringIncludes(preflight, `IS DISTINCT FROM '${md5(corpo(atual))}'`);
  assertStringIncludes(
    preflight,
    "has_function_privilege(v_dono, 'public.is_admin_atual()', 'EXECUTE')",
  );
  for (const sql of [preflight, preflightRb]) {
    assertStringIncludes(sql, "md5(replace(prosrc, E'\\r', ''))");
    assertStringIncludes(sql, "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:");
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql),
      "preflight que só avisa não recusa",
    );
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261200$"],
    [rollback, "DO $preflight_rollback_20261200$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    const c = semComentarios(sql);
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
    ]) {
      assert(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("o cabeçalho declara o que acontece com os dados existentes e a ordem do rollback", () => {
  assertStringIncludes(
    migration,
    "DADOS EXISTENTES: nenhuma linha é lida ou reescrita",
  );
  assertStringIncludes(migration, "IDEMPOTÊNCIA:");
  assertStringIncludes(migration, "B1_BASELINE_DIVERGENT");
  // A ordem do rollback (200 ANTES da 97): o cabeçalho a declara de fato.
  assertStringIncludes(migration, "ROLLBACK: este vem ANTES do da 97");
});

Deno.test("a prova viva roda no rpc-ci", () => {
  const ci = lerArquivo(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    ci,
    "node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-devolucao-viva.cjs",
  );
});

// @ts-nocheck
// A LOJA REGISTRA A SAUDE DA RECONCILIACAO — prova offline da 20261500000000, dos dois rollbacks, das consultas 187a/187b e do registro
// delas no portao (plano VIGIA DA FROTA, lado da loja, 26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem os segredos do Vault (reconciliacao_url / reconciliacao_secret) o pg_cron monta uma URL nula e a
// reconciliacao de pagamentos NUNCA roda, em silencio (20260808000100_reconciliacao.sql). Ninguem de fora tinha como saber. Agora:
//   - a loja guarda UMA linha (public.saude_da_reconciliacao) com o batimento da ultima rodada (quando, se degradou, quais etapas);
//   - so a edge reconciliar-pagamentos grava, pela porta saude_da_reconciliacao_registrar (EXECUTE so do service_role);
//   - qualquer um com a chave PUBLICA le a saude pela saude_da_loja() (anon e authenticated), com a idade calculada NO BANCO da loja e
//     sem nenhuma contagem de pagamento.
// A decisao real (papeis, 42501, contador, idade, concorrencia, pre-voo, mutantes) fica com
// tests/banco/a-loja-registra-a-saude-da-reconciliacao-viva.cjs (so no CI).
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { createHash } = require("node:crypto");
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const {
  contarStatements,
  ROL_FECHADO_POR_CONSULTA,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261500000000_a_loja_registra_a_saude_da_reconciliacao.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);
const A187 = "187a-conferir-a-saude-da-reconciliacao-aplicado";
const B187 = "187b-antes-a-saude-da-reconciliacao-ausente";
const PROVA_VIVA =
  "tests/banco/a-loja-registra-a-saude-da-reconciliacao-viva.cjs";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
const md5 = (s) => createHash("md5").update(s).digest("hex");
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $function$", i) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}
const REGISTRAR = "public.saude_da_reconciliacao_registrar";
const SAUDE = "public.saude_da_loja";
const MD5_REGISTRAR = md5(corpo(migration, REGISTRAR));
const MD5_SAUDE = md5(corpo(migration, SAUDE));
const ETAPAS = ["pagamentos", "cancelamentos", "estornos", "contestacoes"];

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum (nem o destrutivo)", () => {
  for (const sqlRollback of [rollback, destrutivo]) {
    const r = avaliarFase0({
      sqlMigration: migration,
      sqlRollback,
      temRollback: true,
    });
    assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  }
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao de nivel superior; os tres tem lock_timeout e statement_timeout", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${nome} contem controle de transacao`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
});

Deno.test("a tabela nasce fechada: IF NOT EXISTS, linha unica, CHECK das 4 etapas e do contador, RLS ligada sem politica e REVOKE ALL dos 4 papeis, sem GRANT", () => {
  const c = codigo(migration);
  assertStringIncludes(
    migration,
    "CREATE TABLE IF NOT EXISTS public.saude_da_reconciliacao (",
  );
  assertStringIncludes(
    c,
    "CONSTRAINT saude_da_reconciliacao_id_check CHECK (id = 1)",
  );
  assertStringIncludes(
    c,
    "CONSTRAINT saude_da_reconciliacao_contador_check CHECK (rodadas_degradadas_seguidas >= 0)",
  );
  assertStringIncludes(
    c,
    "CONSTRAINT saude_da_reconciliacao_etapas_check CHECK (etapas_com_falha <@ ARRAY['', '', '', '']::text[])",
  );
  assertStringIncludes(
    migration,
    `CHECK (etapas_com_falha <@ ARRAY[${ETAPAS.map((e) => `'${e}'`).join(", ")}]::text[])`,
  );
  assertStringIncludes(
    c,
    "ALTER TABLE public.saude_da_reconciliacao ENABLE ROW LEVEL SECURITY;",
  );
  assertStringIncludes(
    c,
    "REVOKE ALL ON TABLE public.saude_da_reconciliacao FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(
    !/CREATE\s+POLICY/i.test(c),
    "nenhuma politica: a RLS sem politica e a segunda fechadura",
  );
  assert(!/GRANT\s+[^;]*\bON\s+TABLE\b/i.test(c), "nenhum GRANT de tabela");
  assert(
    !/FORCE\s+ROW\s+LEVEL/i.test(c),
    "sem FORCE (o dono das funcoes le e grava)",
  );
});

Deno.test("fora das funcoes a migration nao escreve dado nem mexe em objeto que ja existia (aditiva)", () => {
  const c = codigo(migration);
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+|CASCADE)\b/i.test(
      c,
    ),
    "a migration escreve dado ou apaga objeto",
  );
  const alteradas = [...c.matchAll(/ALTER\s+TABLE\s+([a-z_.]+)/gi)].map(
    (m) => m[1],
  );
  assertEquals(
    [...new Set(alteradas)],
    ["public.saude_da_reconciliacao"],
    "so ALTER da tabela nova",
  );
  const criadas = [
    ...c.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-z_.]+)\(/gi),
  ]
    .map((m) => m[1])
    .sort();
  assertEquals(criadas, [SAUDE, REGISTRAR].sort());
});

Deno.test("registrar: SECURITY DEFINER, VOLATILE, search_path fixo; EXECUTE SO do service_role; upsert atomico (contador zera na boa e soma na ruim, saudavel so anda na boa)", () => {
  const c = codigo(migration);
  const assinatura = `${REGISTRAR}(boolean, text[])`;
  assertStringIncludes(
    c,
    `CREATE OR REPLACE FUNCTION ${REGISTRAR}(p_degradado boolean, p_etapas_com_falha text[]) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS`,
  );
  assertStringIncludes(
    c,
    `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  assertStringIncludes(
    c,
    `GRANT EXECUTE ON FUNCTION ${assinatura} TO service_role;`,
  );
  assertEquals(
    c.split(`GRANT EXECUTE ON FUNCTION ${assinatura}`).length - 1,
    1,
    "um GRANT so",
  );
  const b = norm(corpo(migration, REGISTRAR));
  assertStringIncludes(b, "ON CONFLICT (id) DO UPDATE SET");
  assertStringIncludes(
    b,
    "rodadas_degradadas_seguidas = CASE WHEN EXCLUDED.degradado THEN s.rodadas_degradadas_seguidas + 1 ELSE 0 END",
  );
  assertStringIncludes(
    b,
    "ultima_saudavel_em = CASE WHEN EXCLUDED.degradado THEN s.ultima_saudavel_em ELSE EXCLUDED.ultima_rodada_em END",
  );
  // Recusa o que nao e coerente com a resposta da edge, sem gravar.
  assertStringIncludes(
    b,
    "RAISE EXCEPTION 'valor_invalido' USING ERRCODE = '22023'",
  );
  for (const e of ETAPAS) assertStringIncludes(b, `'${e}'`);
});

Deno.test("saude_da_loja: SECURITY DEFINER, STABLE, search_path fixo; EXECUTE de anon e authenticated; so le a tabela da saude e devolve as 8 chaves, NENHUMA contagem de pagamento", () => {
  const c = codigo(migration);
  const assinatura = `${SAUDE}()`;
  assertStringIncludes(
    c,
    `CREATE OR REPLACE FUNCTION ${SAUDE}() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS`,
  );
  assertStringIncludes(
    c,
    `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated, service_role;`,
  );
  assertStringIncludes(
    c,
    `GRANT EXECUTE ON FUNCTION ${assinatura} TO anon, authenticated;`,
  );
  const b = corpo(migration, SAUDE);
  const lidas = [...b.matchAll(/\b(?:FROM|JOIN)\s+([a-z_.]+)/gi)].map(
    (m) => m[1],
  );
  assertEquals(
    [...new Set(lidas)],
    ["public.saude_da_reconciliacao"],
    "so le a tabela da saude",
  );
  assert(
    !/marketplace_orders|order_refunds|pagamentos_a_reconciliar|payment|count\s*\(/i.test(
      b,
    ),
    "nenhuma contagem nem tabela de pagamento",
  );
  const chaves = [...b.matchAll(/'([a-z_]+)',/g)].map((m) => m[1]);
  assertEquals(chaves, [
    "medidor",
    "ultima_rodada_em",
    "idade_rodada_s",
    "ultima_saudavel_em",
    "idade_saudavel_s",
    "degradado",
    "etapas_com_falha",
    "rodadas_degradadas_seguidas",
  ]);
  // A idade e' calculada NO BANCO da loja (o relogio de quem pergunta nao entra).
  assertStringIncludes(
    norm(b),
    "extract(epoch FROM (now() - v.ultima_rodada_em))",
  );
});

Deno.test("pre-voo e pos-voo: primeiro comando depois dos SET LOCAL, B1/B2 com os md5 calculados do proprio arquivo, catalogo apenas", () => {
  const iPre = migration.indexOf("DO $preflight_20261500000000$");
  const iTabela = migration.indexOf(
    "CREATE TABLE IF NOT EXISTS public.saude_da_reconciliacao",
  );
  const iPos = migration.indexOf("DO $posvoo_20261500000000$");
  assert(
    iPre > 0 && iTabela > iPre && iPos > iTabela,
    "pre-voo -> objetos -> pos-voo",
  );
  assertEquals(
    codigo(migration.slice(0, iPre))
      .replace(/SET LOCAL [^;]+;/g, "")
      .trim(),
    "",
    "nada alem de SET LOCAL antes do pre-voo",
  );
  const pre = migration.slice(iPre, iTabela);
  const pos = migration.slice(iPos);
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  for (const parte of [pre, pos]) {
    assertStringIncludes(parte, `'${MD5_REGISTRAR}'`);
    assertStringIncludes(parte, `'${MD5_SAUDE}'`);
  }
  // O pos-voo nao chama as funcoes (chamar registrar gravaria o batimento sem rodada nenhuma).
  assert(
    !/saude_da_reconciliacao_registrar\s*\(\s*(true|false|NULL)/i.test(pos),
    "o pos-voo chama a porta",
  );
  assert(
    !/\bFROM\s+public\.saude_da_reconciliacao\b/i.test(
      pre.replace(/--.*$/gm, "") + pos.replace(/--.*$/gm, ""),
    ),
    "pre/pos-voo leem linha",
  );
  // A ficha do cabecalho diz os md5 que o pos-voo exige.
  for (const h of [MD5_REGISTRAR, MD5_SAUDE])
    assertStringIncludes(migration.slice(0, iPre), h);
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("rollback comum: tira SO as duas funcoes (recusa corpo desconhecido) e MANTEM a tabela e a linha", () => {
  const c = codigo(rollback);
  assertStringIncludes(c, `DROP FUNCTION IF EXISTS ${SAUDE}();`);
  assertStringIncludes(
    c,
    `DROP FUNCTION IF EXISTS ${REGISTRAR}(boolean, text[]);`,
  );
  assert(!/DROP\s+TABLE/i.test(c), "o comum nao apaga a tabela");
  assert(
    !/\b(CASCADE|DELETE\s+FROM|TRUNCATE|INSERT\s+INTO|UPDATE\s+public\.)\b/i.test(
      c,
    ),
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  for (const h of [MD5_REGISTRAR, MD5_SAUDE])
    assertStringIncludes(rollback, `'${h}'`);
  assert(
    rollback.indexOf("$preflight_rollback_20261500000000$") <
      rollback.indexOf("DROP FUNCTION"),
    "pre-voo antes do DROP",
  );
});

Deno.test("rollback destrutivo: so com APAGAR, so depois do comum, recusa tabela de outra forma, sem CASCADE", () => {
  const c = codigo(destrutivo);
  assertStringIncludes(
    c,
    "DROP TABLE IF EXISTS public.saude_da_reconciliacao;",
  );
  assert(!/CASCADE|DROP\s+FUNCTION/i.test(c));
  assertStringIncludes(
    destrutivo,
    "app.confirmo_apagar_saude_da_reconciliacao",
  );
  assertStringIncludes(destrutivo, "'APAGAR'");
  assertStringIncludes(destrutivo, "ROLLBACK_COMUM_PRIMEIRO");
  assert(
    destrutivo.indexOf("DO $destrutivo_20261500000000$") <
      destrutivo.indexOf("DROP TABLE"),
    "guarda antes do DROP",
  );
});

Deno.test("187a/187b: rol fechado (8 e 5 linhas) igual aos rotulos do SQL, UM statement, so catalogo (nenhuma linha lida, nenhuma porta chamada)", () => {
  // eslint-disable-next-line security/detect-object-injection -- A187 e B187 são constantes literais deste teste.
  const rolA = ROL_FECHADO_POR_CONSULTA[A187];
  // eslint-disable-next-line security/detect-object-injection -- A187 e B187 são constantes literais deste teste.
  const rolB = ROL_FECHADO_POR_CONSULTA[B187];
  assertEquals(rolA?.length, 8);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol] of [
    [A187, rolA],
    [B187, rolB],
  ]) {
    const sql = CONSULTA(nome);
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)', '(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(
      rotulos.sort(),
      [...rol].sort(),
      `${nome}: rotulos do SQL != rol`,
    );
    const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE)\b/.test(
        cod,
      ),
      `${nome}: so leitura`,
    );
    assert(
      !/\bFROM\s+(public\.)?saude_da_reconciliacao\b/i.test(cod),
      `${nome}: nao le linha`,
    );
    assert(
      !/\b(saude_da_loja|saude_da_reconciliacao_registrar)\s*\(/.test(cod),
      `${nome}: nao chama porta`,
    );
  }
  const hashes = [...CONSULTA(A187).matchAll(/'([0-9a-f]{32})'/g)].map(
    (m) => m[1],
  );
  assertEquals(
    hashes.sort(),
    [MD5_REGISTRAR, MD5_SAUDE].sort(),
    "187a: md5 das duas funcoes desta migration",
  );
});

Deno.test("lote de UMA migration em provasDeObjetos (187a depois, 187b antes), depois do lote da 20261480, menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, portao de rol fechado e a prova viva no job do dinheiro", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261500000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261500000000"]);
  assertEquals(lotes[0].consulta, A187);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B187);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  const i184 = canais.provasDeObjetos.findIndex(
    (l) =>
      l.consulta ===
      "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado",
  );
  const i187 = canais.provasDeObjetos.findIndex((l) => l.consulta === A187);
  assert(i184 >= 0 && i187 > i184, "anexado depois do lote da 20261480");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = (
    await Deno.readTextFile(
      `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
    )
  ).replace(/\r/g, "");
  const rpc = (
    await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`)
  ).replace(/\r/g, "");
  for (const nome of [A187, B187]) {
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu, `          - ${nome}\n`);
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nos dois caminhos do rpc-ci`,
    );
  }
  const dinheiro = rpc.slice(
    rpc.indexOf("\n  contrato-dinheiro:\n"),
    rpc.indexOf("\n  provas-informacionais:\n"),
  );
  assertStringIncludes(
    dinheiro,
    `run: node tests/banco/rodar-isolado.cjs ${PROVA_VIVA}`,
  );
  await Deno.stat(`${RAIZ}/${PROVA_VIVA}`);
  assertStringIncludes(
    await Deno.readTextFile(`${RAIZ}/tests/banco/LEIA-ME.md`),
    "a-loja-registra-a-saude-da-reconciliacao-viva.cjs",
  );
});

Deno.test("tipos: a tabela e as duas funcoes estao em src/types/database.types.ts", async () => {
  const tipos = (
    await Deno.readTextFile(`${RAIZ}/src/types/database.types.ts`)
  ).replace(/\r/g, "");
  for (const nome of [
    "saude_da_reconciliacao",
    "saude_da_reconciliacao_registrar",
    "saude_da_loja",
  ]) {
    assertStringIncludes(tipos, `\n      ${nome}: {`, `${nome} sem tipo`);
  }
  assertStringIncludes(tipos, "p_etapas_com_falha: string[]");
});

Deno.test("o batimento chega a quem publica: runbook (passo 4) e DEPLOYMENT.md mandam conferir a saude_da_loja", async () => {
  const runbook = await Deno.readTextFile(
    `${RAIZ}/docs/runbooks/producao-unica-fonte.md`,
  );
  const deploy = await Deno.readTextFile(`${RAIZ}/DEPLOYMENT.md`);
  for (const doc of [runbook, deploy]) {
    assertStringIncludes(doc, "saude_da_loja");
    assertStringIncludes(doc, "idade_rodada_s");
  }
});

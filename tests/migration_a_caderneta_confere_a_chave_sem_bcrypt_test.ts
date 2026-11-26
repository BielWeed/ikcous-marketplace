// @ts-nocheck
/* eslint-disable security/detect-object-injection -- Toda chave indexada (V1, V2, A186, B186) e' constante literal deste teste. */
// A CADERNETA CONFERE A CHAVE SEM BCRYPT POR CHAMADA — prova offline da 20261490000000, dos dois rollbacks, das consultas 186a/186b, das
// sucessoras aceitas pela 182a e pela 184a e do registro no portão (26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: resolver_loja e resolver_loja_com_estado (EXECUTE do anon; a chave publicável é pública) rodavam
// extensions.crypt (bcrypt custo 10, ~80 ms) em TODA chamada, antes de olhar o endereço: chave errada em laço ocupava a CPU do banco da
// caderneta e o porteiro de todas as lojas caía em "manutenção". Agora:
//   - frota_segredo ganha hash_rapido/hash_rapido_de (sem GRANT) e as duas portas trocam SÓ a conferência da chave: o atalho sha256 vale
//     só para o hash bcrypt atual; o bcrypt roda e grava o atalho só quando a chave certa abre; a gravação nunca espera nem falha;
//   - o RETURN QUERY de cada porta é o da 20261460, letra por letra;
//   - o rollback comum devolve as portas byte a byte; o destrutivo tira as colunas só com confirmação e depois do comum.
// A decisão real (contagem de bcrypt, duas conexões, só leitura, pré-voo, mutantes) fica com
// tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-viva.cjs.
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
const NOME =
  "20261490000000_a_caderneta_confere_a_chave_sem_bcrypt_por_chamada.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const destrutivo = LER(`rollback-manual-destrutivo-${NOME}`);
const estadoDeVida = LER("20261460000000_a_loja_tem_estado_de_vida.sql");
const A186 = "186a-conferir-a-caderneta-confere-a-chave-sem-bcrypt-aplicado";
const B186 = "186b-antes-a-caderneta-confere-a-chave-sem-bcrypt-ausente";
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
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("$$;", abre));
}
const V1 = "public.resolver_loja";
const V2 = "public.resolver_loja_com_estado";
const NOVO = { [V1]: corpo(migration, V1), [V2]: corpo(migration, V2) };
const VELHO = { [V1]: corpo(estadoDeVida, V1), [V2]: corpo(estadoDeVida, V2) };
const MD5_NOVO = { [V1]: md5(NOVO[V1]), [V2]: md5(NOVO[V2]) };
const MD5_1460 = { [V1]: md5(VELHO[V1]), [V2]: md5(VELHO[V2]) };
/** O RETURN QUERY de cada porta (o que não pode mudar): da v1 a partir dele; da v2 a partir do comentário que o precede. */
const RABO = {
  [V1]: (s) => s.slice(s.indexOf("\n  RETURN QUERY")),
  [V2]: (s) => s.slice(s.indexOf("\n  -- ativa = false continua")),
};
/** A conferência da chave: do DECLARE até o RETURN QUERY (a da v2 até o comentário dela). */
const CONFERENCIA = (fn) =>
  NOVO[fn].slice(0, NOVO[fn].length - RABO[fn](NOVO[fn]).length);

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos tres arquivos abre ou fecha transacao de nivel superior; todos com lock_timeout de 5 s e statement_timeout de 30 s", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
    ["rollback destrutivo", destrutivo],
  ]) {
    assertEquals(
      detectarTransacaoExplicita(removerRuido(sql)).achados,
      [],
      `${nome} contem controle de transacao`,
    );
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
});

Deno.test("a migration escreve so: as duas colunas (IF NOT EXISTS) e as duas portas (CREATE OR REPLACE); nada de GRANT, REVOKE, DML, DROP ou CASCADE fora dos corpos", () => {
  const c = codigo(migration);
  assertStringIncludes(
    c,
    "ALTER TABLE public.frota_segredo ADD COLUMN IF NOT EXISTS hash_rapido text, ADD COLUMN IF NOT EXISTS hash_rapido_de text;",
  );
  assertEquals(c.split("CREATE OR REPLACE FUNCTION").length - 1, 2);
  assertEquals(c.split("ALTER TABLE").length - 1, 1);
  assert(!/\b(GRANT|REVOKE)\b/.test(c), "nenhum GRANT nem REVOKE");
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+)/i.test(
      c,
    ),
    "a migration escreve dado ou derruba objeto",
  );
  // O pre-voo vem antes de qualquer escrita; o pos-voo depois das duas portas.
  const iPre = migration.indexOf("DO $preflight_20261490000000$");
  const iAlter = migration.indexOf("ALTER TABLE public.frota_segredo");
  const iPos = migration.indexOf("DO $posvoo_20261490000000$");
  assert(
    iPre > 0 &&
      iAlter > iPre &&
      iPos > migration.indexOf(`CREATE OR REPLACE FUNCTION ${V2}(`),
  );
  assertEquals(
    codigo(migration.slice(0, iPre))
      .replace(/SET LOCAL [^;]+;/g, "")
      .trim(),
    "",
    "nada alem de SET LOCAL antes do pre-voo",
  );
});

Deno.test("as duas portas: o RETURN QUERY e' o da 20261460 letra por letra e a conferencia da chave e' a MESMA nas duas", () => {
  for (const fn of [V1, V2]) {
    assertEquals(
      RABO[fn](NOVO[fn]),
      RABO[fn](VELHO[fn]),
      `${fn}: o resto do corpo mudou`,
    );
    assert(RABO[fn](NOVO[fn]).length > 100, `${fn}: rabo vazio`);
  }
  assertEquals(
    CONFERENCIA(V1),
    CONFERENCIA(V2),
    "a conferencia difere entre as portas",
  );
  // A assinatura, o retorno e os atributos de cada porta: os mesmos da 20261460.
  for (const fn of [V1, V2]) {
    const cab = (sql) => {
      const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}(`);
      return sql.slice(i, sql.indexOf("AS $$", i));
    };
    assertEquals(cab(migration), cab(estadoDeVida), `${fn}: cabecalho mudou`);
  }
});

Deno.test("a conferencia: atalho so para o hash ATUAL, bcrypt so sem atalho, grava so depois da chave certa, sem esperar nem falhar em leitura", () => {
  const k = norm(CONFERENCIA(V1).replace(/--.*$/gm, ""));
  // Uma leitura da linha id = 1.
  assertStringIncludes(
    k,
    "SELECT fs.hash, fs.hash_rapido, fs.hash_rapido_de INTO v_hash, v_rapido, v_rapido_de FROM public.frota_segredo fs WHERE fs.id = 1;",
  );
  // O atalho so vale amarrado ao hash atual, e compara a chave inteira (NULL-seguro).
  assertStringIncludes(
    k,
    "IF v_rapido IS NOT NULL AND v_rapido_de = v_hash THEN",
  );
  assertStringIncludes(
    k,
    "IF v_rapido IS DISTINCT FROM encode(extensions.digest(p_chave, 'sha256'), 'hex') THEN RETURN;",
  );
  // Sem atalho: o bcrypt de sempre (NULL-seguro: crypt(NULL) e' NULL e cai no RETURN).
  assertStringIncludes(
    k,
    "IF v_hash IS NULL OR v_hash IS DISTINCT FROM extensions.crypt(p_chave, v_hash) THEN RETURN;",
  );
  // A gravacao vem DEPOIS do RETURN da chave errada, so em transacao de escrita, so com a linha livre e amarrada ao hash lido.
  const iBcrypt = k.indexOf("extensions.crypt(p_chave, v_hash)");
  const iUpdate = k.indexOf("UPDATE public.frota_segredo fs");
  assert(iBcrypt > 0 && iUpdate > iBcrypt, "o UPDATE vem depois do bcrypt");
  assertEquals(
    k.split("UPDATE public.frota_segredo").length - 1,
    1,
    "um UPDATE so",
  );
  assertStringIncludes(
    k,
    "IF current_setting('transaction_read_only') = 'off' THEN",
  );
  assertStringIncludes(
    k,
    "PERFORM 1 FROM public.frota_segredo fs WHERE fs.id = 1 AND fs.hash = v_hash FOR UPDATE SKIP LOCKED; IF FOUND THEN",
  );
  assertStringIncludes(
    k,
    "SET hash_rapido = encode(extensions.digest(p_chave, 'sha256'), 'hex'), hash_rapido_de = v_hash WHERE fs.id = 1 AND fs.hash = v_hash;",
  );
  // Nenhuma negacao NULL-insegura (IF NOT (a = b) com NULL nao entra no IF) nem crypt fora do ramo sem atalho.
  assert(!/IF NOT \(/.test(k), "negacao NULL-insegura");
  assertEquals(k.split("extensions.crypt(").length - 1, 1, "um bcrypt so");
  for (const guc of ["lock_timeout", "statement_timeout", "role"])
    assert(
      !k.includes(`SET ${guc}`) && !k.includes(`SET LOCAL ${guc}`),
      `a porta mexe em ${guc} do chamador`,
    );
});

Deno.test("md5: pre-voo aceita 20261460 ou esta (as duas no mesmo estado); pos-voo exige os corpos novos; ficha do cabecalho com os md5", () => {
  const iPre = migration.indexOf("DO $preflight_20261490000000$");
  const pre = migration.slice(
    iPre,
    migration.indexOf("ALTER TABLE public.frota_segredo"),
  );
  const pos = migration.slice(migration.indexOf("DO $posvoo_20261490000000$"));
  for (const fn of [V1, V2]) {
    assertStringIncludes(pre, `'${MD5_1460[fn]}'`);
    assertStringIncludes(pre, `'${MD5_NOVO[fn]}'`);
    assertStringIncludes(pos, `'${MD5_NOVO[fn]}'`);
    assertStringIncludes(migration.slice(0, iPre), MD5_NOVO[fn]);
  }
  assertStringIncludes(
    pre,
    `(v_hash_v1 = '${MD5_1460[V1]}' AND v_hash_v2 = '${MD5_1460[V2]}')`,
  );
  assertStringIncludes(
    pre,
    `(v_hash_v1 = '${MD5_NOVO[V1]}' AND v_hash_v2 = '${MD5_NOVO[V2]}')`,
  );
  // O pre-voo exige a 20261470 e a 20261480, o pgcrypto (crypt e digest), o mesmo dono, a ACL so do anon e as colunas tudo-ou-nada.
  for (const pedaco of [
    "B1_BASELINE_DIVERGENT",
    "public.frota_mudar_estado(text, text, text, text, text, text, text, text, timestamptz)",
    "has_table_privilege('service_role', c.oid,",
    "to_regprocedure('extensions.digest(text, text)')",
    "to_regprocedure('extensions.crypt(text, text)')",
    "proowner",
    "relowner",
    "'hash_rapido:text:false:-:-,hash_rapido_de:text:false:-:-'",
    "ikcous.chave1490_base",
  ])
    assertStringIncludes(pre, pedaco);
  // O pre-voo e o pos-voo nao leem linha da caderneta.
  for (const bloco of [pre, pos])
    assert(
      !/\bFROM\s+public\.(frota_lojas|frota_segredo)\b/i.test(
        bloco.replace(/--.*$/gm, ""),
      ),
      "conferencia le linha da caderneta",
    );
  for (const pedaco of [
    "POSVOO_20261490000000",
    "has_table_privilege('service_role', c.oid,",
    "has_any_column_privilege('anon', c.oid,",
    "ikcous.chave1490_base",
  ])
    assertStringIncludes(pos, pedaco);
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("rollback comum: as duas portas voltam BYTE A BYTE aos corpos da 20261460, nada mais (nem GRANT, nem DROP, nem dado)", () => {
  assertEquals(md5(corpo(rollback, V1)), MD5_1460[V1]);
  assertEquals(md5(corpo(rollback, V2)), MD5_1460[V2]);
  const c = codigo(rollback);
  assertEquals(c.split("CREATE OR REPLACE FUNCTION").length - 1, 2);
  assert(
    !/\b(GRANT|REVOKE|DROP|ALTER\s+TABLE|DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.|INSERT\s+INTO|CASCADE)\b/i.test(
      c,
    ),
    "o rollback comum mexe em outra coisa",
  );
  const pre = rollback.slice(
    rollback.indexOf("DO $preflight_rollback_20261490000000$"),
  );
  for (const fn of [V1, V2]) {
    assertStringIncludes(pre, `'${MD5_NOVO[fn]}'`);
    assertStringIncludes(pre, `'${MD5_1460[fn]}'`);
  }
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "POSVOO_ROLLBACK_20261490000000");
});

Deno.test("rollback destrutivo: so com confirmacao e com as portas da 20261460 no ar; tira so as duas colunas, sem CASCADE", () => {
  assertStringIncludes(
    destrutivo,
    "current_setting('app.confirmo_apagar_atalho_da_chave_da_frota', true), '') <> 'APAGAR'",
  );
  for (const fn of [V1, V2])
    assertStringIncludes(destrutivo, `'${MD5_1460[fn]}'`);
  assertStringIncludes(destrutivo, "ATALHO_DA_CHAVE_ROLLBACK_COMUM_PRIMEIRO");
  const c = codigo(destrutivo);
  assertStringIncludes(
    c,
    "ALTER TABLE public.frota_segredo DROP COLUMN IF EXISTS hash_rapido_de, DROP COLUMN IF EXISTS hash_rapido;",
  );
  assert(!/CASCADE/i.test(c));
  assert(
    !/\b(DROP\s+(TABLE|FUNCTION)|DELETE|UPDATE|INSERT|GRANT|REVOKE)\b/i.test(c),
  );
  const iConf = destrutivo.indexOf("DO $destrutivo_20261490000000$");
  assert(
    iConf > 0 && iConf < destrutivo.indexOf("ALTER TABLE public.frota_segredo"),
  );
});

Deno.test("186a/186b: rol fechado (6 e 5 linhas) igual aos rotulos do SQL, UM statement, so catalogo, md5 certo de cada lado", () => {
  const rolA = ROL_FECHADO_POR_CONSULTA[A186];
  const rolB = ROL_FECHADO_POR_CONSULTA[B186];
  assertEquals(rolA?.length, 6);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol, esperados] of [
    [A186, rolA, [MD5_NOVO[V1], MD5_NOVO[V2]]],
    [B186, rolB, [MD5_1460[V1], MD5_1460[V2]]],
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
      !/\bFROM\s+(public\.)?(frota_lojas|frota_segredo|frota_estado_historico)\b/i.test(
        cod,
      ),
      `${nome}: nao le linha`,
    );
    assert(
      !/\b(frota_mudar_estado|resolver_loja(_com_estado)?)\s*\(/.test(cod),
      `${nome}: nao chama porta`,
    );
    assert(
      !/to_regprocedure\(\s*'extensions\./.test(sql),
      `${nome}: extensions pelo catalogo`,
    );
    const hashes = [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
    assertEquals(hashes.sort(), [...esperados].sort(), `${nome}: md5`);
  }
});

Deno.test("182a e 184a aceitam os corpos desta migration como SUCESSORES, ao lado dos da 20261460 (o portao da release nao para depois da 186)", () => {
  for (const nome of [
    "182a-conferir-o-estado-de-vida-da-loja-aplicado",
    "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado",
  ]) {
    const sql = CONSULTA(nome);
    for (const fn of [V1, V2])
      assertStringIncludes(sql, `h IN ('${MD5_1460[fn]}', '${MD5_NOVO[fn]}')`);
    assertStringIncludes(sql, "20261490000000");
  }
  // As 'b' (ausencia) continuam exigindo so o corpo da 20261460: aceitar a sucessora ali autorizaria apply fora de ordem.
  for (const nome of [
    "182b-antes-o-estado-de-vida-da-loja-ausente",
    "183b-antes-a-loja-muda-de-estado-so-pela-porta-ausente",
    "184b-antes-a-caderneta-fecha-para-o-service-role-ausente",
  ])
    for (const fn of [V1, V2])
      assert(
        !CONSULTA(nome).includes(MD5_NOVO[fn]),
        `${nome} cita a sucessora`,
      );
});

Deno.test("lote de UMA migration em provasDeObjetos (186a depois, 186b antes), anexado no fim, menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, portao de rol fechado e a prova viva no rpc-ci", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261490000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261490000000"]);
  assertEquals(lotes[0].consulta, A186);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B186);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  assertStringIncludes(lotes[0]._comentario, "IKCOUS_FROTA_URL");
  // Anexado no fim quando entrou: logo depois do lote da 20261480 (os lotes posteriores, como o da 20261510, vêm depois dele).
  const i186 = canais.provasDeObjetos.findIndex((l) => l.consulta === A186);
  assertEquals(
    canais.provasDeObjetos[i186 - 1]?.consulta,
    "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado",
    "anexado logo depois do lote da 20261480",
  );
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = await Deno.readTextFile(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  );
  const rpc = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  for (const nome of [A186, B186]) {
    assert(
      CONSULTAS_DE_ROL_FECHADO.has(nome),
      `${nome} fora de CONSULTAS_DE_ROL_FECHADO`,
    );
    assertStringIncludes(menu.replace(/\r/g, ""), `          - ${nome}\n`);
    assertEquals(
      rpc.split(`"scripts/publicacao/consultas/${nome}.sql"`).length - 1,
      2,
      `${nome}: nos dois caminhos do rpc-ci`,
    );
  }
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-viva.cjs",
  );
});

Deno.test("as provas vivas da 20261460, 20261470 e 20261480 desfazem esta ANTES (o pre-voo delas confere os corpos da 20261460)", async () => {
  const modulo = await Deno.readTextFile(
    `${RAIZ}/tests/banco/a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs`,
  );
  // O módulo roda o rollback COMUM e depois o DESTRUTIVO confirmado, os dois pelo nome desta migration (CHAVE_SEM_BCRYPT.nome).
  const iComum = modulo.indexOf("ler(`rollback-manual-$");
  const iConfirma = modulo.indexOf(
    "app.confirmo_apagar_atalho_da_chave_da_frota = 'APAGAR'",
  );
  const iDestrutivo = modulo.indexOf("ler(`rollback-manual-destrutivo-$");
  assert(
    iComum > 0 && iConfirma > iComum && iDestrutivo > iConfirma,
    "comum -> confirmacao -> destrutivo",
  );
  assertStringIncludes(modulo, `nome: "${NOME}"`);
  for (const prova of [
    "a-loja-tem-estado-de-vida-viva.cjs",
    "a-loja-muda-de-estado-so-pela-porta-viva.cjs",
    "a-caderneta-fecha-para-o-service-role-viva.cjs",
  ]) {
    const t = await Deno.readTextFile(`${RAIZ}/tests/banco/${prova}`);
    const main = t.slice(t.indexOf("async function main()"));
    const iDesfaz = main.indexOf("await desfazerChaveSemBcryptNoClone(c);");
    assert(iDesfaz > 0, `${prova}: nao desfaz a 20261490`);
    assert(
      iDesfaz < main.indexOf("await provar("),
      `${prova}: desfaz depois de provar`,
    );
    assertStringIncludes(
      t,
      'require("./a-caderneta-confere-a-chave-sem-bcrypt-posterior.cjs")',
    );
  }
});

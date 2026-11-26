// @ts-nocheck
// O ADMIN COPIA E APAGA AS FOTOS DA LOJA — prova offline da 20261550000000, do rollback, das consultas 192a/192b, do registro no portao
// e da entrada no fim de POSTERIORES_A_97 (26/11/2026; lacuna L4 da loja nova).
//
// O DEFEITO QUE ESTE TESTE FIXA: a loja recem-instalada nasce sem politica SELECT nos buckets `products` e `banners` (a 20261071000000
// deixou as de listagem do molde de fora). Pela regra do Postgres, um DELETE com WHERE (o remove do Storage) e o copy do Storage leem a
// linha antes de agir, e sem politica SELECT a linha some: duplicar produto com foto falha e apagar foto ou banner apaga 0 arquivo, sem erro.
// A migration cria "Admin Select Access (products|banners)": SELECT so para authenticated, so no bucket, so para o admin de AGORA.
//
// O GUARDA e' rls_admin_atual(), NUNCA is_admin_atual(): authenticated NAO tem EXECUTE na is_admin_atual (20261197), e o Postgres confere
// o EXECUTE de toda funcao do plano ao montar a consulta. Uma politica com is_admin_atual() faria TODO SELECT de usuario logado em
// storage.objects (inclusive as fotos de devolucao do cliente) cair com 42501. E' o mesmo guarda das politicas de escrita (20261360000000).
// A decisao real (admin apaga e copia, cliente e visitante nada, rollback, reaplicar, convivencia com a "Public Display") fica com
// tests/banco/o-admin-copia-e-apaga-as-fotos-viva.cjs (so no CI).
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
const {
  contarStatements,
  ROL_FECHADO_POR_CONSULTA,
} = require("../scripts/publicacao/conferir-banco.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const VERSAO = "20261550000000";
const NOME = `${VERSAO}_o_admin_copia_e_apaga_as_fotos_da_loja.sql`;
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const A192 = "192a-conferir-o-admin-copia-e-apaga-as-fotos-aplicado";
const B192 = "192b-antes-o-admin-copia-e-apaga-as-fotos-ausente";
const PROVA_VIVA = "tests/banco/o-admin-copia-e-apaga-as-fotos-viva.cjs";
const POSTERIOR = "tests/banco/o-admin-copia-e-apaga-as-fotos-posterior.cjs";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
// Os comandos de nivel superior, COM o texto das strings, sem comentarios de linha, sem os blocos DO (pre-voo, pos-voo, conferencia:
// so leem catalogo) e sem os SET LOCAL.
const comandosDeTopo = (sql) =>
  norm(
    sql
      .replace(/--.*$/gm, "")
      .replace(/DO \$([a-z0-9_]+)\$[\s\S]*?END \$\1\$;/g, "")
      .replace(/SET LOCAL [^;]+;/g, ""),
  )
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

const politica = (bucket) =>
  `CREATE POLICY "Admin Select Access (${bucket})" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = '${bucket}' AND (SELECT public.rls_admin_atual()))`;

const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);

Deno.test("avaliarFase0 nao recusa o par migration + rollback; nenhum dos dois abre ou fecha transacao; os dois tem lock_timeout e statement_timeout", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    assertEquals(
      detectarTransacaoExplicita(removerRuido(sql)).achados,
      [],
      `${nome} contem controle de transacao`,
    );
    assert(!/^\s*(BEGIN|COMMIT)\b/im.test(removerRuido(sql)), nome);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
});

Deno.test("a migration faz EXATAMENTE quatro coisas: DROP IF EXISTS + CREATE da politica SELECT de cada bucket, so authenticated, so o admin de agora; nenhum dado tocado", () => {
  assertEquals(comandosDeTopo(migration), [
    'DROP POLICY IF EXISTS "Admin Select Access (products)" ON storage.objects',
    politica("products"),
    'DROP POLICY IF EXISTS "Admin Select Access (banners)" ON storage.objects',
    politica("banners"),
  ]);
  const c = codigo(migration);
  assert(
    !/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w|TRUNCATE|ALTER\s+TABLE|ALTER\s+POLICY|GRANT|REVOKE|CASCADE|DROP\s+(TABLE|FUNCTION|TRIGGER|INDEX|COLUMN))\b/i.test(
      c,
    ),
    "a migration escreve dado, mexe em ACL ou apaga algo que nao e a propria politica",
  );
  // O guarda: rls_admin_atual (EXECUTE de authenticated). is_admin_atual NAO tem EXECUTE de authenticated: a politica derrubaria
  // com 42501 todo SELECT logado em storage.objects. is_admin() le o JWT (ex-admin passaria por ~1 h).
  const topo = comandosDeTopo(migration).join(";");
  assert(!topo.includes("is_admin_atual"), "o guarda e rls_admin_atual()");
  assert(!/is_admin\(\)/.test(topo), "nunca o is_admin() do JWT");
  assert(!/\bTO\s+(public|anon)\b/i.test(topo), "visitante fica de fora");
  assert(!/FOR\s+(ALL|DELETE|INSERT|UPDATE)\b/i.test(topo), "so SELECT");
});

Deno.test("pre-voo e pos-voo: pre-voo e' o primeiro comando e so le; recusa (B1) politica homonima alheia, porta do admin divergente e storage.objects sem RLS; pos-voo (B2) exige as duas politicas exatas", () => {
  const iPre = migration.indexOf(`DO $preflight_${VERSAO}$`);
  const iPrimeiroDrop = migration.indexOf("\nDROP POLICY IF EXISTS");
  const iPos = migration.indexOf(`DO $posvoo_${VERSAO}$`);
  assert(
    iPre > 0 && iPrimeiroDrop > iPre && iPos > iPrimeiroDrop,
    "pre-voo -> politicas -> pos-voo",
  );
  assertEquals(
    codigo(migration.slice(0, iPre))
      .replace(/SET LOCAL [^;]+;/g, "")
      .trim(),
    "",
    "nada alem de SET LOCAL antes do pre-voo",
  );
  const pre = norm(migration.slice(iPre, iPrimeiroDrop));
  const pos = norm(migration.slice(iPos));
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  // a porta da 20261197 pelo corpo (o mesmo md5 que a 20261360 e a 20261450 conferem) e o EXECUTE so de authenticated
  assertStringIncludes(pre, "ccb7a56e835b8181795fffb7bee97305");
  assertStringIncludes(
    pre,
    "has_function_privilege('authenticated', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')",
  );
  assertStringIncludes(
    pre,
    "has_function_privilege('anon', to_regprocedure('public.rls_admin_atual()'), 'EXECUTE')",
  );
  assertStringIncludes(pre, "relrowsecurity");
  assertStringIncludes(pre, "Admin Select Access (products)");
  assertStringIncludes(pre, "Admin Select Access (banners)");
  for (const bucket of ["products", "banners"]) {
    // a forma exata deparseada com search_path = pg_catalog (o mesmo texto que o pos-voo exige)
    const esperado = `((bucket_id = ''${bucket}''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))`;
    assertStringIncludes(pre, esperado);
    assertStringIncludes(pos, esperado);
  }
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  assert(
    !/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/.test(
      (pre + pos).replace(/'[^']*'/g, "''").replace(/--.*$/gm, ""),
    ),
    "pre/pos-voo so leem",
  );
  const cabecalho = migration.slice(0, iPre);
  for (const trecho of [
    "DADOS EXISTENTES",
    "ROLLBACK",
    "Public Display",
    "is_admin_atual",
    "42501",
  ]) {
    assertStringIncludes(cabecalho, trecho);
  }
});

Deno.test("rollback: so os dois DROP POLICY IF EXISTS das politicas desta migration; pre-voo recusa politica homonima alheia; conferencia final exige as duas ausentes", () => {
  assertEquals(comandosDeTopo(rollback), [
    'DROP POLICY IF EXISTS "Admin Select Access (products)" ON storage.objects',
    'DROP POLICY IF EXISTS "Admin Select Access (banners)" ON storage.objects',
  ]);
  const c = codigo(rollback);
  assert(
    !/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+\w|TRUNCATE|CREATE|GRANT|REVOKE|CASCADE)\b/i.test(
      c,
    ),
    "o rollback escreve dado ou cria algo",
  );
  const iPre = rollback.indexOf(`DO $preflight_rollback_${VERSAO}$`);
  const iDrop = rollback.indexOf("\nDROP POLICY IF EXISTS");
  assert(iPre > 0 && iPre < iDrop, "pre-voo antes dos DROP");
  const pre = norm(rollback.slice(iPre, iDrop));
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(
    pre,
    "((bucket_id = ''products''::text) AND ( SELECT public.rls_admin_atual() AS rls_admin_atual))",
  );
  assertStringIncludes(rollback, `DO $conferencia_rollback_${VERSAO}$`);
});

Deno.test("192a/192b: rol fechado igual aos rotulos do SQL, UM statement, so leitura; a 192a exige as duas politicas exatas; a 192b exige as duas ausentes e a base do pre-voo", () => {
  // eslint-disable-next-line security/detect-object-injection -- A192 e B192 são constantes literais deste teste.
  const rolA = ROL_FECHADO_POR_CONSULTA[A192];
  // eslint-disable-next-line security/detect-object-injection -- A192 e B192 são constantes literais deste teste.
  const rolB = ROL_FECHADO_POR_CONSULTA[B192];
  assertEquals(rolA?.length, 4);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol] of [
    [A192, rolA],
    [B192, rolB],
  ]) {
    const sql = CONSULTA(nome);
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rotulos = [...sql.matchAll(/SELECT '([^']+)',\s*'(?:sim|nao)'/g)].map(
      (m) => m[1],
    );
    assertEquals(
      rotulos.sort(),
      [...rol].sort(),
      `${nome}: rotulos do SQL != rol`,
    );
    const cod = sql.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
    assert(
      !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|COMMENT)\b/.test(
        cod,
      ),
      `${nome}: so leitura`,
    );
    // nenhum arquivo do bucket e' lido: so catalogo
    assert(!/FROM\s+storage\.objects/i.test(cod), `${nome}: le objeto`);
  }
  const a = CONSULTA(A192);
  for (const bucket of ["products", "banners"]) {
    assertStringIncludes(
      a,
      `'((bucket_id=''${bucket}''::text)AND(SELECTrls_admin_atual()ASrls_admin_atual))'`,
    );
  }
  assertStringIncludes(CONSULTA(B192), "ccb7a56e835b8181795fffb7bee97305");
});

Deno.test("portao: antes do apply (192a NEGATIVA + 192b POSITIVA) = APLICAR; 192a POSITIVA com o ledger sem a versao = PARAR; depois = NADA", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes(VERSAO),
  );
  assertEquals(lotes.length, 1);
  const lote = lotes[0];
  assertEquals(lote.versoes, [VERSAO]);
  assertEquals(lote.consulta, A192);
  assertEquals(lote.ausenciaConfirmadaPor, B192);
  assert(
    !("backfillLedger" in lote) &&
      !("nuncaAplicar" in lote) &&
      !("soNosRefs" in lote),
    "apply normal, em toda loja",
  );
  const { decidirLote } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const quando = { run: { createdAt: "2026-11-26T10:00:00Z" } };
  const negativa = { estado: "NEGATIVA", motivo: "ausente", ...quando };
  const positiva = { estado: "POSITIVA", motivo: "ok", ...quando };
  const decisao = decidirLote({
    lote,
    faltam: [VERSAO],
    exigeProva: true,
    prova: negativa,
    diagnostico: new Map([[B192, positiva]]),
  });
  assertEquals(decisao.acao, "APLICAR", decisao.motivo);
  assertEquals(decisao.versoes, [VERSAO]);
  assertEquals(
    decidirLote({ lote, faltam: [VERSAO], exigeProva: true, prova: positiva })
      .acao,
    "PARAR",
  );
  assertEquals(
    decidirLote({ lote, faltam: [], exigeProva: true, prova: positiva }).acao,
    "NADA",
  );
});

Deno.test("registro: depois do lote da 20261510000000, menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, rol fechado e a prova viva no job do dinheiro", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const i188 = canais.provasDeObjetos.findIndex(
    (l) => l.consulta === "188a-conferir-o-livro-de-registro-aplicado",
  );
  const i192 = canais.provasDeObjetos.findIndex((l) => l.consulta === A192);
  assert(i188 >= 0 && i192 > i188, "anexado depois do lote da 20261510000000");
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
  for (const nome of [A192, B192]) {
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
    "o-admin-copia-e-apaga-as-fotos-viva.cjs",
  );
});

Deno.test("POSTERIORES_A_97: as politicas citam rls_admin_atual(), entao a migration fica no FIM das duas listas (admin-atual-viva e pagamentos-rpc-viva) pela definicao unica do modulo -posterior", async () => {
  const { FOTOS_DA_LOJA } = require(`../${POSTERIOR}`);
  assertEquals(FOTOS_DA_LOJA.nome, NOME);
  assert(Object.isFrozen(FOTOS_DA_LOJA));
  assertStringIncludes(FOTOS_DA_LOJA.noAr, "Admin Select Access (products)");
  assertStringIncludes(FOTOS_DA_LOJA.noAr, "Admin Select Access (banners)");
  assertStringIncludes(FOTOS_DA_LOJA.noAr, "AS sim");
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = (await Deno.readTextFile(`${RAIZ}/${arq}`)).replace(/\r/g, "");
    assertStringIncludes(
      t,
      'require("./o-admin-copia-e-apaga-as-fotos-posterior.cjs")',
    );
    const inicio = t.indexOf("const POSTERIORES_A_97 = [");
    const fim = t.indexOf("\n];", inicio);
    const corpo = t
      .slice(inicio, fim)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("//"));
    assertEquals(corpo.at(-1), "FOTOS_DA_LOJA,", `${arq}: ultimo da lista`);
  }
});

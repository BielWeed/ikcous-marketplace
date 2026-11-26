// @ts-nocheck
// A LOJA NOVA NASCE COM A FICHA — prova offline da 20261540000000, do rollback, das consultas 191a/191b e do registro delas no portao
// (26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: loja recem-instalada ficava com public.store_config VAZIA (nenhuma migration nem o instalador gravava a
// linha id = 1). Sem ela o porteiro responde 503 "em manutencao" em todas as rotas, forma_de_pagamento_aceita recusa todo pedido,
// calculate-shipping quebra, credenciais-mercado-pago devolve FICHA_NAO_EXISTE e read/save_store_identity levantam IDENTITY_MISSING.
// Agora a migration semeia a ficha (INSERT ... ON CONFLICT DO NOTHING: nas lojas que ja tem a linha, nada muda) e deixa uma MARCA no
// catalogo (COMMENT ON TABLE), porque a prova da casa e' POR OBJETO: sem a marca, a 191a sairia POSITIVA antes do apply na IKCOUS e na
// Savy (que ja tem a linha) e o portao da release (decidirLote) PARARIA por "ledger sem a versao, objetos ja no banco".
// A decisao real (linha criada, porteiro/identidade/pagamento, reaplicar, rollback, pre-voo) fica com
// tests/banco/a-loja-nova-nasce-com-a-ficha-viva.cjs (so no CI).
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
const VERSAO = "20261540000000";
const NOME = `${VERSAO}_a_loja_nova_nasce_com_a_ficha.sql`;
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const A191 = "191a-conferir-a-loja-nova-nasce-com-a-ficha-aplicado";
const B191 = "191b-antes-a-loja-nova-nasce-com-a-ficha-ausente";
const PROVA_VIVA = "tests/banco/a-loja-nova-nasce-com-a-ficha-viva.cjs";
const MARCA = "ficha_da_loja_20261540000000";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
// Os comandos de nivel superior, COM o texto das strings (o removerRuido as esvazia), sem os comentarios de linha, sem os blocos DO
// (pre-voo, pos-voo e conferencia, que so leem catalogo e a linha) e sem os SET LOCAL.
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

Deno.test("a migration faz EXATAMENTE duas coisas: o INSERT da ficha com ON CONFLICT DO NOTHING e a marca no catalogo; nenhum DELETE, UPDATE nem DROP", () => {
  assertEquals(comandosDeTopo(migration), [
    "INSERT INTO public.store_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
    `COMMENT ON TABLE public.store_config IS '${MARCA}'`,
  ]);
  const c = codigo(migration);
  assertEquals(
    c.split("INSERT INTO").length - 1,
    1,
    "UM INSERT so (o pos-voo so le)",
  );
  assert(
    !/\b(DELETE\s+FROM|UPDATE\s+public\.|DROP\s+|TRUNCATE|ALTER\s+TABLE|CASCADE|DO\s+UPDATE)\b/i.test(
      c,
    ),
    "a migration apaga, reescreve ou altera algo",
  );
  // So o id: o dominio_publico fica NULL (quem o grava e' o instalador, por loja), e a trigger dominio_publico_so_muda_pela_frota_no_insert
  // so dispara quando ele (ou as chaves publicas, pagamento_online, manutencao) nasce preenchido.
  assert(!/dominio_publico\s*[,)]/.test(c.split("INSERT INTO")[1]));
});

Deno.test("pre-voo e pos-voo: pre-voo e' o primeiro comando; recusa (B1) comentario que nao e' NULL nem a marca, tabela ausente, sem chave em id ou com coluna NOT NULL sem default; pos-voo (B2) exige a linha id = 1 e a marca", () => {
  const iPre = migration.indexOf(`DO $preflight_${VERSAO}$`);
  // Ancorado no inicio da linha: o cabecalho cita os dois comandos.
  const iInsert = migration.indexOf("\nINSERT INTO public.store_config");
  const iComment = migration.indexOf("\nCOMMENT ON TABLE public.store_config");
  const iPos = migration.indexOf(`DO $posvoo_${VERSAO}$`);
  assert(
    iPre > 0 && iInsert > iPre && iComment > iInsert && iPos > iComment,
    "pre-voo -> INSERT -> COMMENT -> pos-voo",
  );
  assertEquals(
    codigo(migration.slice(0, iPre))
      .replace(/SET LOCAL [^;]+;/g, "")
      .trim(),
    "",
    "nada alem de SET LOCAL antes do pre-voo",
  );
  const pre = norm(migration.slice(iPre, iInsert));
  const pos = norm(migration.slice(iPos));
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(
    pre,
    "obj_description('public.store_config'::regclass, 'pg_class')",
  );
  assertStringIncludes(pre, `IS DISTINCT FROM '${MARCA}'`);
  assertStringIncludes(pre, "to_regclass('public.store_config') IS NULL");
  assertStringIncludes(pre, "attnotnull");
  assertStringIncludes(pre, "atthasdef");
  assertStringIncludes(pos, "B2_POSVOO_DIVERGENTE");
  assertStringIncludes(pos, "FROM public.store_config WHERE id = 1");
  assertStringIncludes(pos, `IS DISTINCT FROM '${MARCA}'`);
  assert(
    !/\b(INSERT|UPDATE|DELETE)\b/.test(
      (pre + pos).replace(/'[^']*'/g, "''").replace(/--.*$/gm, ""),
    ),
    "pre/pos-voo so leem",
  );
  // A ficha do cabecalho conta o que acontece com a linha que ja existia e com o rollback.
  assertStringIncludes(migration.slice(0, iPre), "DADOS EXISTENTES");
  assertStringIncludes(migration.slice(0, iPre), "ROLLBACK");
});

Deno.test("rollback: tira SO a marca (e so se ela for a marca); a ficha NUNCA sai, e o porque esta escrito", () => {
  assertEquals(comandosDeTopo(rollback), [
    "COMMENT ON TABLE public.store_config IS NULL",
  ]);
  const c = codigo(rollback);
  assert(
    !/\b(DELETE\s+FROM|UPDATE\s+public\.|DROP\s+|TRUNCATE|INSERT\s+INTO|CASCADE)\b/i.test(
      c,
    ),
    "o rollback apaga ou escreve dado",
  );
  const iPre = rollback.indexOf(`DO $preflight_rollback_${VERSAO}$`);
  assert(
    iPre > 0 &&
      iPre < rollback.indexOf("COMMENT ON TABLE public.store_config IS NULL"),
    "pre-voo antes do COMMENT",
  );
  const pre = norm(
    rollback.slice(
      iPre,
      rollback.indexOf("COMMENT ON TABLE public.store_config IS NULL"),
    ),
  );
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(pre, `IS DISTINCT FROM '${MARCA}'`);
  assertStringIncludes(rollback, `DO $conferencia_rollback_${VERSAO}$`);
  // O porque da linha ficar: apagar a ficha derruba a loja (porteiro 503, pagamento recusado, identidade ausente).
  const cabecalho = rollback.slice(0, rollback.indexOf("SET LOCAL"));
  assertStringIncludes(cabecalho, "A FICHA FICA");
  assertStringIncludes(cabecalho, "503");
  assertStringIncludes(cabecalho, "forma_de_pagamento_aceita");
});

Deno.test("191a/191b: rol fechado igual aos rotulos do SQL, UM statement, so leitura; a 191a exige a marca E a ficha; a 191b exige comentario NULL e traz a linha INFORMATIVA da ficha", () => {
  // eslint-disable-next-line security/detect-object-injection -- A191 e B191 são constantes literais deste teste.
  const rolA = ROL_FECHADO_POR_CONSULTA[A191];
  // eslint-disable-next-line security/detect-object-injection -- A191 e B191 são constantes literais deste teste.
  const rolB = ROL_FECHADO_POR_CONSULTA[B191];
  assertEquals(rolA?.length, 4);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol] of [
    [A191, rolA],
    [B191, rolB],
  ]) {
    const sql = CONSULTA(nome);
    assertEquals(new Set(rol).size, rol.length, `${nome}: rotulo repetido`);
    assertEquals(contarStatements(sql), 1, `${nome}: UM statement`);
    const rotulos = [
      ...sql.matchAll(/SELECT '([^']+)',\s*(?:'(?:sim|nao)'|\()/g),
    ].map((m) => m[1]);
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
  }
  const a = CONSULTA(A191);
  assertStringIncludes(
    a,
    `obj_description(to_regclass('public.store_config'), 'pg_class') = '${MARCA}'`,
  );
  assertStringIncludes(a, "FROM public.store_config WHERE id = 1");
  assertStringIncludes(a, "FROM public.v_store_config");
  const b = CONSULTA(B191);
  assertStringIncludes(
    b,
    "obj_description(to_regclass('public.store_config'), 'pg_class') IS NULL",
  );
  // A linha INFORMATIVA (molde da 111a): esperado = vivo, nunca reprova; diz se a ficha ja existia antes do apply.
  const informativo = rolB.filter((i) => i.startsWith("informativo:"));
  assertEquals(informativo.length, 1);
  assertStringIncludes(b, `SELECT '${informativo[0]}',`);
});

Deno.test("portao: banco com a ficha e SEM a marca (IKCOUS/Savy antes do apply) -> 191a NEGATIVA + 191b POSITIVA = APLICAR; o desenho sem marca (191a POSITIVA) PARARIA", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes(VERSAO),
  );
  assertEquals(lotes.length, 1);
  const lote = lotes[0];
  assertEquals(lote.versoes, [VERSAO]);
  assertEquals(lote.consulta, A191);
  assertEquals(lote.ausenciaConfirmadaPor, B191);
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
  const negativa = { estado: "NEGATIVA", motivo: "sem a marca", ...quando };
  const positiva = { estado: "POSITIVA", motivo: "ok", ...quando };
  const decisao = decidirLote({
    lote,
    faltam: [VERSAO],
    exigeProva: true,
    prova: negativa,
    diagnostico: new Map([[B191, positiva]]),
  });
  assertEquals(decisao.acao, "APLICAR", decisao.motivo);
  assertEquals(decisao.versoes, [VERSAO]);
  // Controle: se a 191a saisse POSITIVA antes do apply (o que aconteceria sem a marca), o portao PARA.
  assertEquals(
    decidirLote({
      lote,
      faltam: [VERSAO],
      exigeProva: true,
      prova: positiva,
    }).acao,
    "PARAR",
  );
  // Depois do apply (ledger completo e 191a POSITIVA): nada a fazer.
  assertEquals(
    decidirLote({ lote, faltam: [], exigeProva: true, prova: positiva }).acao,
    "NADA",
  );
});

Deno.test("registro: depois do lote da 20261500000000, menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, rol fechado e a prova viva no job do dinheiro", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const i187 = canais.provasDeObjetos.findIndex(
    (l) => l.consulta === "187a-conferir-a-saude-da-reconciliacao-aplicado",
  );
  const i191 = canais.provasDeObjetos.findIndex((l) => l.consulta === A191);
  assert(i187 >= 0 && i191 > i187, "anexado depois do lote da 20261500000000");
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
  for (const nome of [A191, B191]) {
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
    "a-loja-nova-nasce-com-a-ficha-viva.cjs",
  );
});

Deno.test("textos: o instalador nao diz mais que 10 migrations semeiam a ficha; o runbook troca o INSERT manual pela migration e mantem so o UPDATE do dominio_publico", async () => {
  const instalador = await Deno.readTextFile(
    `${RAIZ}/scripts/frota/instalador-banco.mjs`,
  );
  assert(!instalador.includes("10 migrations a semeiam"));
  assertStringIncludes(instalador, VERSAO);
  const runbook = (
    await Deno.readTextFile(`${RAIZ}/docs/runbooks/producao-unica-fonte.md`)
  ).replace(/\r/g, "");
  assert(
    !runbook.includes("nasce sem a\n   linha `id = 1`. Crie essa linha"),
    "o passo manual antigo de criar a linha saiu",
  );
  assertStringIncludes(runbook, VERSAO);
  assertStringIncludes(
    runbook,
    "UPDATE public.store_config SET dominio_publico =",
  );
});

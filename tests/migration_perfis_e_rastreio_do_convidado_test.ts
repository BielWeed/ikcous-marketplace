// Guardas ESTATICAS das migrations 20261340000000 (politicas de perfil/endereco exigem o admin atual),
// 20261341000000 (o codigo do convidado trava a linha na tentativa) e 20261342000000 (o rastreio do convidado
// nao devolve a nota do pedido). O comportamento com papeis reais e corridas esta em
// tests/banco/admin-atual-perfis-viva.cjs e tests/banco/rastreio-do-convidado-viva.cjs (Postgres efemero do rpc-ci).
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
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

const A1340 =
  "20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql";
const A1341 =
  "20261341000000_o_codigo_do_convidado_trava_a_linha_na_tentativa.sql";
const A1342 =
  "20261342000000_o_rastreio_do_convidado_nao_devolve_a_nota_do_pedido.sql";
const A1217 =
  "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql";
const dir = "supabase/migrations/";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const semComentarios = (sql: string) => removerRuido(sql);

/** Corpo ($$ ... $$) de `CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2(`. */
function corpoDaV2(sql: string): string {
  const cab = "CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v2(";
  const ini = sql.indexOf(cab);
  assert(ini >= 0, "nao achei a v2");
  assertEquals(sql.indexOf(cab, ini + 1), -1, "v2 definida 2x");
  const abre = sql.indexOf("AS $$", ini) + "AS $$".length;
  const fim = sql.indexOf("$$;", abre);
  assert(fim > abre);
  return sql.slice(abre, fim);
}

const todas = [A1340, A1341, A1342];

Deno.test("1340-1342: cada migration termina no NOTIFY, nao abre transacao propria, tem pre-voo e conferencia; o rollback-manual tambem nao e transacional e passa na fase 0", () => {
  for (const nome of todas) {
    const sql = ler(dir + nome);
    const rollback = ler(`${dir}rollback-manual-${nome}`);
    assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), nome);
    assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
    assertStringIncludes(sql, "$conferencia_");
    assertStringIncludes(sql, "SET LOCAL lock_timeout");
    assertStringIncludes(sql, `rollback-manual-${nome}`);
    assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
    for (const texto of [sql, rollback])
      assertEquals(
        detectarTransacaoExplicita(semComentarios(texto)).achados,
        [],
        nome,
      );
    assertEquals(
      avaliarFase0({
        sqlMigration: sql,
        sqlRollback: rollback,
        temRollback: true,
      }).recusado,
      false,
      nome,
    );
    // Aditiva: nada de DROP TABLE/COLUMN, DELETE, TRUNCATE ou UPDATE de dado.
    for (const texto of [sql, rollback])
      assertEquals(
        /\b(DROP\s+(TABLE|COLUMN|SCHEMA)|DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.)/i.test(
          semComentarios(texto),
        ),
        false,
        `${nome}: mexe em dado ou apaga objeto`,
      );
  }
});

Deno.test("1340: 13 ALTER POLICY trocam is_admin() por rls_admin_atual(); o rollback devolve as 13; sem GRANT, REVOKE nem CREATE/DROP POLICY", () => {
  const sql = semComentarios(ler(dir + A1340));
  const rb = semComentarios(ler(`${dir}rollback-manual-${A1340}`));
  assert(!/\b(GRANT|REVOKE|CREATE\s+POLICY|DROP\s+POLICY)\b/i.test(sql));
  assert(!/\b(GRANT|REVOKE|CREATE\s+POLICY|DROP\s+POLICY)\b/i.test(rb));
  const alteracoes = (texto: string) =>
    [
      ...texto.matchAll(
        /ALTER POLICY[\s\S]*?;(?=\s*(?:ALTER POLICY|DO |NOTIFY|$))/g,
      ),
    ].map((m) => m[0]);
  const novas = alteracoes(sql);
  const velhas = alteracoes(rb);
  assertEquals(novas.length, 13);
  assertEquals(velhas.length, 13);
  for (const a of novas) {
    assertStringIncludes(a, "public.rls_admin_atual()");
    assert(!/\bis_admin\(\)/.test(a), a);
  }
  for (const a of velhas) {
    assertStringIncludes(a, "public.is_admin()");
    assert(!/rls_admin_atual/.test(a), a);
  }
  // Mesma politica, mesma tabela, na mesma ordem nos dois arquivos.
  const alvo = (a: string) =>
    a
      .match(/ALTER POLICY\s+("[^"]+"|\w+)\s+ON\s+([\w.]+)/)!
      .slice(1, 3)
      .join(" ");
  assertEquals(velhas.map(alvo), novas.map(alvo));
  assertEquals(new Set(novas.map(alvo)).size, 13);
  // Nenhuma troca de papel (TO ...): so USING / WITH CHECK.
  for (const a of [...novas, ...velhas]) assert(!/\bTO\s+\w/.test(a), a);
});

Deno.test("1341/1342: corpos da v2 conferem com os hashes do pre-voo; 1341 = 1217 + a trava de linha; 1342 = 1341 sem a chave notes; os rollbacks devolvem o corpo anterior byte a byte", () => {
  const c1217 = corpoDaV2(ler(dir + A1217));
  const m1341 = ler(dir + A1341);
  const m1342 = ler(dir + A1342);
  const c1341 = corpoDaV2(m1341);
  const c1342 = corpoDaV2(m1342);
  const h1217 = md5(c1217);
  const h1341 = md5(c1341);
  const h1342 = md5(c1342);
  assertEquals(h1217, "53b5e632657b82206daa6aa992a50c0d");
  assertEquals(h1341, "34199947ecded0fd9400b5fd0276ea47");
  assertEquals(h1342, "02208ac9d2abe2e8b03790349d491ecb");
  // pre-voo e conferencia citam os hashes certos
  assertStringIncludes(m1341, `('${h1217}', '${h1341}')`);
  assertStringIncludes(m1342, `('${h1341}', '${h1342}')`);
  assertStringIncludes(m1341, `IS DISTINCT FROM '${h1341}'`);
  assertStringIncludes(m1342, `IS DISTINCT FROM '${h1342}'`);
  // rollbacks: o corpo restaurado e IGUAL ao da migration anterior, e o pre-voo exige o corpo desta
  const r1341 = ler(`${dir}rollback-manual-${A1341}`);
  const r1342 = ler(`${dir}rollback-manual-${A1342}`);
  assertEquals(corpoDaV2(r1341), c1217);
  assertEquals(corpoDaV2(r1342), c1341);
  assertStringIncludes(r1341, h1341);
  assertStringIncludes(r1342, h1342);
  // diferencas exatas entre os corpos (sem contar comentarios)
  const linhas = (s: string) => s.split("\n");
  const so = (a: string, b: string) =>
    linhas(b)
      .filter((l) => !linhas(a).includes(l))
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("--"));
  assertEquals(so(c1217, c1341), ["LIMIT 1", "FOR UPDATE OF v;"]);
  assertEquals(so(c1341, c1342), []);
  assertEquals(
    linhas(c1341)
      .filter((l) => !linhas(c1342).includes(l))
      .map((l) => l.trim()),
    ["'notes', o.notes,"],
  );
  assertEquals(c1341.split("FOR UPDATE OF v").length - 1, 1);
  assertEquals(c1217.split("FOR UPDATE").length - 1, 0);
  // o CPF segue fora e as demais colunas de retorno ficam
  for (const c of [c1341, c1342]) {
    assertStringIncludes(c, "(o.customer_data - 'cpf')");
    assertStringIncludes(c, "'tracking_code', o.tracking_code");
  }
  assert(!c1342.includes("o.notes"));
  // nem GRANT nem REVOKE: a ACL da v2 nao muda (CREATE OR REPLACE a preserva)
  for (const t of [m1341, m1342, r1341, r1342])
    assert(!/\b(GRANT|REVOKE)\b/i.test(semComentarios(t)));
});

Deno.test("1340-1342: registros de publicacao completos (lotes, consultas, rois, workflows, prova viva no rpc-ci, lista de provas, VERIFICACOES) e as cadeias de sucessoras", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA: rois,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lotes = [
    [
      "20261340000000",
      "64a-conferir-politicas-de-perfil-e-endereco-aplicado",
      "64b-antes-politicas-de-perfil-e-endereco-is-admin",
      4,
    ],
    [
      "20261341000000",
      "65a-conferir-codigo-do-convidado-trava-a-linha-aplicado",
      "65b-antes-codigo-do-convidado-corpo-da-1217",
      3,
    ],
    [
      "20261342000000",
      "66a-conferir-rastreio-do-convidado-sem-nota-aplicado",
      "66b-antes-rastreio-do-convidado-corpo-da-1341",
      3,
    ],
  ] as Array<[string, string, string, number]>;
  const rpcCi = ler(".github/workflows/rpc-ci.yml");
  const menu = ler(".github/workflows/conferir-banco-da-loja.yml");
  for (const [versao, a, b, n] of lotes) {
    const lote = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
      p.versoes?.includes(versao),
    );
    assertEquals(lote.length, 1, versao);
    assertEquals(lote[0].consulta, a);
    assertEquals(lote[0].ausenciaConfirmadaPor, b);
    assertEquals(lote[0].versoes, [versao]);
    for (const consulta of [a, b]) {
      const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
      const sql = ler(caminho);
      // eslint-disable-next-line security/detect-object-injection -- `consulta` vem só do par [a, b] da tabela literal `lotes` deste teste, nunca de entrada externa.
      const rol = rois[consulta];
      assertEquals(contarStatements(sql), 1, consulta);
      assertEquals(rol.length, n, consulta);
      assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
      assertStringIncludes(menu, `- ${consulta}\n`);
      assertEquals(rpcCi.split(`"${caminho}"`).length - 1, 2, consulta);
      const itens = [...sql.matchAll(/SELECT '([^']+)',/g)].map((m) => m[1]);
      assertEquals([...rol].sort(), itens.sort(), consulta);
      const linhas = rol.map((item: string) => ({
        item,
        esperado: "x",
        vivo: "x",
        ok: true,
      }));
      assertEquals(estruturaDoRolFechado(linhas, rol), null);
      assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
      // so catalogo: nenhuma tabela de dados no FROM/JOIN
      assert(
        !/(?<!DISTINCT\s)\b(?:FROM|JOIN)\s+(?:public\.|auth\.)?(?:marketplace_orders|otp_verifications|profiles|user_addresses|users)\b/i.test(
          sql,
        ),
        `${consulta} le tabela de dados`,
      );
    }
  }
  // A 1340 exige a conferencia de papel contraditorio (8b) antes de aplicar em cada loja.
  const l40 = canais.provasDeObjetos.find((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261340000000"),
  );
  assertEquals(l40.conferenciasAntesDoApply, ["8b-papeis-contraditorios"]);
  // provas vivas no rpc-ci (uma vez cada) e na lista do job do dinheiro
  for (const prova of ["admin-atual-perfis-viva", "rastreio-do-convidado-viva"])
    assertEquals(
      rpcCi.split(`rodar-isolado.cjs tests/banco/${prova}.cjs`).length - 1,
      1,
      prova,
    );
  const lista = ler(
    "tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts",
  );
  for (const prova of ["admin-atual-perfis-viva", "rastreio-do-convidado-viva"])
    assertStringIncludes(lista, `"tests/banco/${prova}.cjs"`);
  // marcadores do aplicador manual (so as duas que trocam corpo de funcao)
  const dbApply = ler("scripts/db-apply.cjs");
  assertStringIncludes(dbApply, `"${A1341}"`);
  assertStringIncludes(dbApply, `"${A1342}"`);
  // sucessoras: 21a e 23a aceitam os corpos novos da v2 (a 23b e' o ANTES e nao os aceita)
  const q21a = ler(
    "scripts/publicacao/consultas/21a-conferir-teto-de-email-aplicado.sql",
  );
  const q23a = ler(
    "scripts/publicacao/consultas/23a-conferir-consulta-antiga-de-pedido-fechada.sql",
  );
  const q23b = ler(
    "scripts/publicacao/consultas/23b-antes-consulta-antiga-de-pedido-aberta.sql",
  );
  const h41 = md5(corpoDaV2(ler(dir + A1341)));
  const h42 = md5(corpoDaV2(ler(dir + A1342)));
  const sha = (s: string) =>
    createHash("sha256").update(s, "utf8").digest("hex");
  for (const c of [corpoDaV2(ler(dir + A1341)), corpoDaV2(ler(dir + A1342))]) {
    assertStringIncludes(q21a, sha(c));
    assertStringIncludes(q21a, sha(c.replace(/\n/g, "\r\n")));
  }
  assertStringIncludes(q23a, h41);
  assertStringIncludes(q23a, h42);
  assert(!q23b.includes(h41) && !q23b.includes(h42));
  // as provas antigas desfazem as posteriores
  assertStringIncludes(
    ler("tests/banco/admin-atual-viva.cjs"),
    "PERFIS_ADMIN_ATUAL,\n",
  );
  assertStringIncludes(
    ler("tests/banco/pagamentos-rpc-viva.cjs"),
    "PERFIS_ADMIN_ATUAL,\n",
  );
});

Deno.test("1342: nenhum arquivo do app le `notes` da resposta do rastreio do convidado", () => {
  // O convidado so chama a v2 em useOrders (verificacao do codigo); `notes` so e' lido em telas do painel.
  const mapper = ler("src/lib/mappers.ts");
  assertStringIncludes(mapper, "notes: row.notes || undefined");
  for (const tela of [
    "src/components/ui/custom/OrderSearch.tsx",
    "src/views/OrderDetailsView.tsx",
  ]) {
    let texto = "";
    try {
      texto = ler(tela);
    } catch {
      continue; // tela inexistente nesta arvore
    }
    assert(!/\.notes\b/.test(texto), `${tela} le .notes`);
  }
});

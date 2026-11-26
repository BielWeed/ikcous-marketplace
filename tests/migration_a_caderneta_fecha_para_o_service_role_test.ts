// @ts-nocheck
// A CADERNETA FECHA PARA O SERVICE_ROLE — prova offline do par 20261480000000 + rollback comum, das consultas 184a/184b e do registro
// delas no portão (plano L8, 26/11/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: no banco da caderneta (public.frota_lojas guarda o endereço e a chave publicável do banco de CADA loja;
// public.frota_segredo guarda o hash da chave da frota) o service_role ainda tinha TODOS os privilégios de tabela, herdados do ALTER
// DEFAULT PRIVILEGES do schema public (cabeçalho da 20261141). Nada no repositório lê essas tabelas como service_role: o porteiro só chama
// a resolver_loja/resolver_loja_com_estado (SECURITY DEFINER, EXECUTE só do anon) e o resto usa o dono do banco. Agora:
//   - a migration faz UM REVOKE ALL ... FROM service_role nas duas tabelas e nada mais;
//   - o pré-voo recusa a 20261460 fora do estado do repositório, dono diferente entre tabelas e portas, e um service_role com só PARTE
//     dos privilégios (o rollback não teria como reproduzir esse estado);
//   - o rollback comum devolve o GRANT ALL que existia (medido no efêmero: service_role=arwdDxtm/postgres nas duas).
// A decisão real (papéis, 42501, porteiro, pré-voo, mutantes) fica com tests/banco/a-caderneta-fecha-para-o-service-role-viva.cjs.
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
const NOME = "20261480000000_a_caderneta_fecha_para_o_service_role.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const estadoDeVida = LER("20261460000000_a_loja_tem_estado_de_vida.sql");
const A184 = "184a-conferir-a-caderneta-fecha-para-o-service-role-aplicado";
const B184 = "184b-antes-a-caderneta-fecha-para-o-service-role-ausente";
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
const MD5_V1 = md5(corpo(estadoDeVida, "public.resolver_loja"));
const MD5_V2 = md5(corpo(estadoDeVida, "public.resolver_loja_com_estado"));
const REVOKE =
  "REVOKE ALL ON TABLE public.frota_lojas, public.frota_segredo FROM service_role;";
const GRANT =
  "GRANT ALL ON TABLE public.frota_lojas, public.frota_segredo TO service_role;";
/** O esqueleto do arquivo sem comentários, com cada bloco DO e cada texto entre aspas esvaziados (removerRuido): o que sobra é o que ESCREVE. */
const ESQUELETO = (meio) =>
  norm(
    `SET LOCAL lock_timeout = ''; SET LOCAL statement_timeout = ''; DO ; ${meio} DO ; NOTIFY pgrst, '';`,
  );

Deno.test("avaliarFase0 nao recusa o par migration + rollback comum", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos dois arquivos abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback comum", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${nome} contem controle de transacao`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
  }
});

Deno.test("a migration escreve UMA coisa so: o REVOKE ALL das duas tabelas para o service_role (nada de GRANT, DML, DDL, CASCADE, outro papel)", () => {
  // pre-voo (DO), o REVOKE, pos-voo (DO) e o NOTIFY: nada mais fora dos blocos.
  assertEquals(codigo(migration), ESQUELETO(REVOKE));
  const c = codigo(migration);
  assertEquals(c.split(REVOKE).length - 1, 1, "um REVOKE so");
  assert(!/\bGRANT\b/.test(c), "nenhum GRANT");
  assert(!/CASCADE/i.test(c), "sem CASCADE");
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+|ALTER\s+TABLE|CREATE\s+)/i.test(
      c,
    ),
    "a migration escreve dado ou mexe em objeto",
  );
});

Deno.test("o pre-voo e' o primeiro comando depois dos SET LOCAL, recusa com B1_BASELINE_DIVERGENT, exige a 20261460 (md5 das portas), o mesmo dono e service_role com tudo ou nada", () => {
  const iPre = migration.indexOf("DO $preflight_20261480000000$");
  const iRevoke = migration.indexOf(REVOKE);
  const iPos = migration.indexOf("DO $posvoo_20261480000000$");
  assert(
    iPre > 0 && iRevoke > iPre && iPos > iRevoke,
    "pre-voo -> REVOKE -> pos-voo",
  );
  const antes = codigo(migration.slice(0, iPre))
    .replace(/SET LOCAL [^;]+;/g, "")
    .trim();
  assertEquals(antes, "", "nada alem de SET LOCAL antes do pre-voo");
  const pre = migration.slice(iPre, iRevoke);
  assertStringIncludes(pre, "B1_BASELINE_DIVERGENT");
  // A 20261460 aplicada: os md5 da v1 e da v2 que ELA deixa (calculados do arquivo dela).
  assertStringIncludes(pre, `'${MD5_V1}'`);
  assertStringIncludes(pre, `'${MD5_V2}'`);
  // O dono das portas SECURITY DEFINER e' o dono das duas tabelas (senao a porta deixaria de ler a caderneta).
  assertStringIncludes(pre, "proowner");
  assertStringIncludes(pre, "relowner");
  // service_role com tudo (o conjunto do dono, concedido pelo dono, sem grant option) ou nada; nada de coluna.
  assertStringIncludes(pre, "acldefault('r', c.relowner)");
  assertStringIncludes(pre, "attacl");
  // O pre-voo nao le linha da caderneta.
  assert(
    !/\bFROM\s+public\.(frota_lojas|frota_segredo)\b/i.test(
      pre.replace(/--.*$/gm, ""),
    ),
    "o pre-voo le linha da caderneta",
  );
  // A ficha do cabecalho diz os md5 que o pre-voo exige.
  for (const h of [MD5_V1, MD5_V2])
    assertStringIncludes(migration.slice(0, iPre), h);
  assertStringIncludes(migration, "NOTIFY pgrst, 'reload schema';");
});

Deno.test("o pos-voo confere: service_role sem nenhum dos 7 privilegios nas duas, anon e authenticated sem nada, a porta do porteiro ainda do anon", () => {
  const pos = migration.slice(migration.indexOf("DO $posvoo_20261480000000$"));
  assertStringIncludes(pos, "POSVOO_20261480000000");
  for (const papel of ["service_role", "anon", "authenticated"])
    assertStringIncludes(
      pos,
      `has_table_privilege('${papel}', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    );
  assertStringIncludes(pos, "has_any_column_privilege('service_role'");
  assertStringIncludes(pos, "has_function_privilege('anon'");
  assertStringIncludes(pos, "ikcous.cofre1480_base");
});

Deno.test("rollback comum: pre-voo antes, UM GRANT ALL de volta (sem GRANT OPTION), nada mais", () => {
  assertEquals(codigo(rollback), ESQUELETO(GRANT));
  assert(
    rollback.indexOf("$preflight_rollback_20261480000000$") <
      rollback.indexOf(GRANT),
    "pre-voo antes do GRANT",
  );
  const c = codigo(rollback);
  assert(!/GRANT\s+OPTION/i.test(c), "sem GRANT OPTION");
  assert(
    !/\b(REVOKE|DROP|DELETE\s+FROM|TRUNCATE|UPDATE\s+public\.|INSERT\s+INTO|CASCADE)\b/i.test(
      c,
    ),
    "o rollback apaga dado ou fecha outra coisa",
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(rollback, "POSVOO_ROLLBACK_20261480000000");
});

Deno.test("nenhum caminho do app le a caderneta direto pela API (so pelas portas resolver_loja*): o service_role nao tem o que perder", async () => {
  const arquivos = [];
  const andar = async (d) => {
    for await (const e of Deno.readDir(d)) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) {
        if (e.name !== "node_modules") await andar(p);
      } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) arquivos.push(p);
    }
  };
  for (const d of ["src", "supabase/functions"]) await andar(`${RAIZ}/${d}`);
  arquivos.push(`${RAIZ}/middleware.ts`);
  const achados = [];
  for (const p of arquivos) {
    const t = await Deno.readTextFile(p);
    if (/rest\/v1\/frota_|\.from\(\s*["'`]frota_/.test(t)) achados.push(p);
  }
  assertEquals(achados, []);
  assert(
    !/frota_(lojas|segredo)/.test(
      (
        await Promise.all(
          arquivos
            .filter((p) => p.includes("supabase/functions"))
            .map((p) => Deno.readTextFile(p)),
        )
      ).join("\n"),
    ),
    "edge function cita a caderneta",
  );
});

Deno.test("184a/184b: rol fechado (6 e 5 linhas) igual aos rotulos do SQL, UM statement, so catalogo (nenhuma linha da caderneta), md5 da 20261460", () => {
  // eslint-disable-next-line security/detect-object-injection -- A184 e B184 são constantes literais deste teste.
  const rolA = ROL_FECHADO_POR_CONSULTA[A184];
  // eslint-disable-next-line security/detect-object-injection -- A184 e B184 são constantes literais deste teste.
  const rolB = ROL_FECHADO_POR_CONSULTA[B184];
  assertEquals(rolA?.length, 6);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol] of [
    [A184, rolA],
    [B184, rolB],
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
    const hashes = [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
    assertEquals(hashes.sort(), [MD5_V1, MD5_V2].sort(), `${nome}: md5`);
  }
});

Deno.test("lote de UMA migration em provasDeObjetos (184a depois, 184b antes), anexado no fim, menu do conferir-banco-da-loja, os dois caminhos do rpc-ci, portao de rol fechado e a prova viva no rpc-ci", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261480000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261480000000"]);
  assertEquals(lotes[0].consulta, A184);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B184);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  assertStringIncludes(lotes[0]._comentario, "IKCOUS_FROTA_URL");
  assertEquals(canais.provasDeObjetos.at(-1).consulta, A184, "anexado no fim");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = await Deno.readTextFile(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  );
  const rpc = await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`);
  for (const nome of [A184, B184]) {
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
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-caderneta-fecha-para-o-service-role-viva.cjs",
  );
});

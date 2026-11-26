// @ts-nocheck
/* eslint-disable security/detect-object-injection -- Toda chave indexada (A190, B190) e' constante literal deste teste. */
// A LOJA GRANDE NAO TRAVA O BALCAO NEM OS AVISOS — prova offline da 20261530000000, do rollback-manual, das consultas 190a/190b,
// do registro no portao e dos tipos (26/11/2026; plano PLANO-LOJA-GRANDE-BANCO, T1).
//
// O DEFEITO QUE ESTE TESTE FIXA: o balcao achava o cliente pela get_admin_customers_paged, que a cada pausa de digitacao recalcula
// crm__vendas(now()) e junta TODOS os perfis com TODOS os pedidos antes de filtrar (a loja com 20 mil clientes e 50 mil pedidos
// le centenas de milhares de linhas para mostrar 8 nomes). Agora:
//   - nasce a porta leve buscar_clientes_do_balcao(text, integer): as guardas, o termo e o FILTRO sao copias LETRA POR LETRA da
//     20261412000000 (o mesmo cliente que a porta antiga acharia), sem ler pedido nenhum;
//   - nascem 2 indices (produtos por data de cadastro e id; historico do pedido por status e data), produtos ANTES do historico
//     (a ordem em que a venda do balcao e o cancelamento travam as duas tabelas);
//   - nada existente e recriado: a get_admin_customers_paged continua intacta.
// A decisao real (diferencial contra a porta antiga, zero leitura de pedidos, guardas, EXPLAIN, tempos, mutantes, reaplicar e
// rollback) fica com tests/banco/a-loja-grande-nao-trava-o-balcao-viva.cjs, que so roda no Postgres efemero do CI.
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
  "20261530000000_a_loja_grande_nao_trava_o_balcao_nem_os_avisos.sql";
const LER = (n) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${n}`).replace(/\r/g, "");
const migration = LER(NOME);
const rollback = LER(`rollback-manual-${NOME}`);
const fonte412 = LER("20261412000000_o_crm_ignora_reembolso_integral.sql");
const A190 = "190a-conferir-a-loja-grande-nao-trava-o-balcao-aplicado";
const B190 = "190b-antes-a-loja-grande-nao-trava-o-balcao-ausente";
const CONSULTA = (n) =>
  Deno.readTextFileSync(
    `${RAIZ}/scripts/publicacao/consultas/${n}.sql`,
  ).replace(/\r/g, "");
const PROVA_VIVA = "tests/banco/a-loja-grande-nao-trava-o-balcao-viva.cjs";

const norm = (s) => s.replace(/\s+/g, " ").trim();
const codigo = (s) => norm(removerRuido(s));
const md5 = (s) => createHash("md5").update(s).digest("hex");
function corpo(sql, nome) {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION ${nome}(`);
  assert(i >= 0, `${nome} nao encontrada`);
  const abre = sql.indexOf("AS $$", i) + "AS $$".length;
  return sql.slice(abre, sql.indexOf("$$;", abre));
}
/** Linhas [de, ate] (numeradas a partir de 1, como no editor) da 20261412000000. */
const LINHAS_412 = (de, ate) =>
  fonte412
    .split("\n")
    .slice(de - 1, ate)
    .join("\n");
const PORTA = corpo(migration, "public.buscar_clientes_do_balcao");
const MD5_PORTA = md5(PORTA);
const MD5_ANTIGA = md5(corpo(fonte412, "public.get_admin_customers_paged"));

const INDICE_PRODUTOS =
  "CREATE INDEX IF NOT EXISTS idx_produtos_data_cadastro_id\n  ON public.produtos (data_cadastro DESC, id);";
const INDICE_HISTORICO =
  "CREATE INDEX IF NOT EXISTS idx_order_history_status_criado\n  ON public.marketplace_order_history (new_status, created_at DESC);";

Deno.test("as fontes copiadas sao as da 20261412000000: guardas (84-90), termo (93-100) e filtro (160-175), e a antiga tem o md5 conhecido", () => {
  assertEquals(MD5_ANTIGA, "bdac47c59600f44cf59ac6c74e44a55e");
  assert(LINHAS_412(84, 84).startsWith("    IF NOT public.is_admin() THEN"));
  assert(
    LINHAS_412(93, 93).startsWith("    v_clean_search := TRIM(p_search);"),
  );
  assertEquals(LINHAS_412(160, 160), "        WHERE (");
  assertEquals(LINHAS_412(175, 175), "        )");
});

Deno.test("avaliarFase0 nao recusa o par migration + rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum dos dois arquivos abre ou fecha transacao de nivel superior; os dois com lock_timeout de 5 s e statement_timeout de 30 s", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback", rollback],
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

Deno.test("exatamente 2 CREATE INDEX IF NOT EXISTS, sem CONCURRENTLY, e o de produtos ANTES do do historico (a ordem de trava da venda e do cancelamento)", () => {
  const c = codigo(migration);
  assertEquals(c.split("CREATE INDEX").length - 1, 2);
  assertEquals(c.split("CREATE INDEX IF NOT EXISTS").length - 1, 2);
  assert(
    !/CONCURRENTLY/i.test(c),
    "CONCURRENTLY nao roda dentro da transacao do aplicador",
  );
  assert(!/UNIQUE/i.test(c), "nenhum indice unico");
  const iProdutos = migration.indexOf(INDICE_PRODUTOS);
  const iHistorico = migration.indexOf(INDICE_HISTORICO);
  assert(iProdutos > 0, "indice de produtos com a definicao do plano");
  assert(iHistorico > 0, "indice do historico com a definicao do plano");
  assert(
    iProdutos < iHistorico,
    "produtos tem de vir ANTES do historico: a venda do balcao e o cancelamento travam produtos primeiro",
  );
  // A regra da ordem esta escrita no cabecalho.
  assertStringIncludes(migration, "PRIMEIRO produtos, DEPOIS o historico");
  // O pre-voo vem antes do primeiro indice; o pos-voo depois da porta.
  const iPre = migration.indexOf("DO $preflight_20261530000000$");
  const iPorta = migration.indexOf(
    "CREATE OR REPLACE FUNCTION public.buscar_clientes_do_balcao(",
  );
  const iPos = migration.indexOf("DO $posvoo_20261530000000$");
  assert(iPre > 0 && iPre < iProdutos, "pre-voo antes de qualquer escrita");
  assert(iHistorico < iPorta && iPorta < iPos, "pos-voo depois da porta");
});

Deno.test("a porta leve: plpgsql, STABLE, SECURITY DEFINER, search_path public/extensions, e UMA so funcao criada", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.buscar_clientes_do_balcao(p_search text, p_limite integer)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE\n SECURITY DEFINER\n SET search_path TO 'public', 'extensions'\nAS $$",
  );
  const c = codigo(migration);
  assertEquals(c.split("CREATE OR REPLACE FUNCTION").length - 1, 1);
  assertEquals(c.split("CREATE FUNCTION").length - 1, 0);
  assert(
    !/get_admin_customers_paged/.test(c),
    "a porta antiga nao e recriada nem tocada",
  );
});

Deno.test("guardas, termo e FILTRO sao copias letra por letra da 20261412000000 (comparacao de string)", () => {
  assertStringIncludes(PORTA, `\n${LINHAS_412(84, 90)}\n`);
  assertStringIncludes(PORTA, `\n${LINHAS_412(93, 100)}\n`);
  assertStringIncludes(PORTA, `\n${LINHAS_412(160, 175)}\n`);
  // A guarda e o filtro aparecem UMA vez (nada de segundo caminho sem guarda).
  assertEquals(PORTA.split("public.is_admin_atual()").length - 1, 1);
  assertEquals(PORTA.split(LINHAS_412(160, 175)).length - 1, 1);
  // A guarda vem antes de qualquer leitura.
  assert(
    PORTA.indexOf("public.is_admin_atual()") <
      PORTA.indexOf("FROM public.profiles"),
  );
});

Deno.test("a porta NAO le pedidos (nem CRM, nem push, nem devolucao) e junta auth.users por LEFT JOIN", () => {
  const sem = removerRuido(PORTA);
  for (const proibido of [
    /marketplace_order/i,
    /crm__/i,
    /order_refunds/i,
    /devolucoes/i,
    /push_subscriptions/i,
    /fin__/i,
  ])
    assert(!proibido.test(sem), `a porta le ${proibido}`);
  assertStringIncludes(
    PORTA,
    "FROM public.profiles p\n        LEFT JOIN auth.users u ON u.id = p.id\n",
  );
  assertEquals(
    (PORTA.match(/JOIN auth\.users/g) || []).length,
    1,
    "auth.users entra UMA vez",
  );
  assert(
    !/(INNER|^|\s)JOIN auth\.users/.test(
      PORTA.replace("LEFT JOIN auth.users", ""),
    ),
  );
  // O endereco principal e o da 20261412000000 (LATERAL, um por cliente).
  assertStringIncludes(PORTA, `\n${LINHAS_412(151, 157)}\n`);
});

Deno.test("a porta: teto 1..50, ordem created_at DESC + id, total por count(*) OVER() e a resposta {data:[{id,full_name,phone,email}],total_count}", () => {
  assertStringIncludes(
    PORTA,
    "v_limite := LEAST(GREATEST(COALESCE(p_limite, 8), 1), 50);",
  );
  assertStringIncludes(PORTA, "ORDER BY p.created_at DESC, p.id");
  assertStringIncludes(PORTA, "COUNT(*) OVER () AS full_count");
  assertStringIncludes(PORTA, "LIMIT v_limite");
  assertStringIncludes(PORTA, "COALESCE(p.whatsapp, u.phone) AS phone");
  assertStringIncludes(
    PORTA,
    "jsonb_build_object('id', a.id, 'full_name', a.full_name, 'phone', a.phone, 'email', a.email)",
  );
  assertStringIncludes(PORTA, "'data', v_data,");
  assertStringIncludes(PORTA, "'total_count', v_total_count");
  assert(!/OFFSET/i.test(PORTA), "o balcao so le a primeira pagina");
  assert(!/\b(INSERT|UPDATE|DELETE|PERFORM)\b/.test(removerRuido(PORTA)));
});

Deno.test("ACL: REVOKE de PUBLIC, anon, authenticated e service_role; GRANT so ao authenticated", () => {
  const c = codigo(migration);
  assertStringIncludes(
    c,
    "REVOKE ALL ON FUNCTION public.buscar_clientes_do_balcao(text, integer) FROM PUBLIC, anon, authenticated, service_role;",
  );
  assertStringIncludes(
    c,
    "GRANT EXECUTE ON FUNCTION public.buscar_clientes_do_balcao(text, integer) TO authenticated;",
  );
  assertEquals(c.split("GRANT ").length - 1, 1);
  assertEquals(c.split("REVOKE ").length - 1, 1);
  const iRevoke = c.indexOf("REVOKE ALL ON FUNCTION");
  assert(iRevoke < c.indexOf("GRANT EXECUTE"), "REVOKE antes do GRANT");
});

Deno.test("aditiva: nada de DELETE, UPDATE, INSERT, TRUNCATE, DROP, ALTER TABLE nem CASCADE fora dos corpos", () => {
  const c = codigo(migration);
  assert(
    !/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+|ALTER\s+TABLE|CASCADE)/i.test(
      c,
    ),
    "a migration escreve dado ou derruba/altera objeto",
  );
});

Deno.test("o pre-voo e o pos-voo conhecem o md5 do corpo da porta (o pre-voo recusa outra porta com o mesmo nome)", () => {
  assertEquals(migration.split(`'${MD5_PORTA}'`).length - 1, 2);
  for (const bloco of [
    "$preflight_20261530000000$",
    "$posvoo_20261530000000$",
  ]) {
    const i = migration.indexOf(`DO ${bloco}`);
    const f = migration.indexOf(`END ${bloco}`, i);
    assert(i > 0 && f > i, bloco);
    const trecho = migration.slice(i, f);
    assertStringIncludes(trecho, `'${MD5_PORTA}'`);
    assertStringIncludes(trecho, "'btree (data_cadastro DESC, id)'");
    assertStringIncludes(trecho, "'btree (new_status, created_at DESC)'");
  }
  assertStringIncludes(migration, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(migration, "B2_POSVOO_DIVERGENTE");
});

Deno.test("rollback: derruba os 3 objetos (produtos antes do historico), sem CASCADE, sem DML, e so os desta migration", () => {
  const c = codigo(rollback);
  const drops = [
    "DROP FUNCTION IF EXISTS public.buscar_clientes_do_balcao(text, integer);",
    "DROP INDEX IF EXISTS public.idx_produtos_data_cadastro_id;",
    "DROP INDEX IF EXISTS public.idx_order_history_status_criado;",
  ];
  for (const d of drops) assertStringIncludes(c, d);
  assertEquals(c.split("DROP ").length - 1, 3);
  assert(
    c.indexOf(drops[1]) < c.indexOf(drops[2]),
    "produtos antes do historico, a mesma ordem de trava da migration",
  );
  assert(!/CASCADE/i.test(c));
  assert(
    !/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE|ALTER)\b/i.test(c),
  );
  // O pre-voo do rollback recusa derrubar o que nao e desta migration.
  assertStringIncludes(rollback, `'${MD5_PORTA}'`);
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  const iPre = rollback.indexOf("DO $preflight_rollback_20261530000000$");
  assert(iPre > 0 && iPre < rollback.indexOf("DROP FUNCTION"));
  assertStringIncludes(rollback, "ledger");
});

Deno.test("190a/190b: rol fechado (6 e 5 linhas) igual aos rotulos do SQL, UM statement, so catalogo, md5 certo de cada lado", () => {
  const rolA = ROL_FECHADO_POR_CONSULTA[A190];
  const rolB = ROL_FECHADO_POR_CONSULTA[B190];
  assertEquals(rolA?.length, 6);
  assertEquals(rolB?.length, 5);
  for (const [nome, rol, esperados] of [
    [A190, rolA, [MD5_PORTA, MD5_ANTIGA]],
    [B190, rolB, [MD5_ANTIGA]],
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
      !/\bFROM\s+(public\.|auth\.)?(profiles|users|marketplace_orders|marketplace_order_history|produtos|user_addresses)\b/i.test(
        cod,
      ),
      `${nome}: nao le linha`,
    );
    assert(
      !/\b(buscar_clientes_do_balcao|get_admin_customers_paged)\s*\(/.test(cod),
      `${nome}: nao chama porta`,
    );
    const hashes = [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]);
    assertEquals(hashes.sort(), [...esperados].sort(), `${nome}: md5`);
  }
});

Deno.test("lote de UMA migration em provasDeObjetos (190a depois, 190b antes) logo depois do lote da 20261490, menu, os dois caminhos do rpc-ci, portao de rol fechado e a prova viva no job do dinheiro", async () => {
  const canais = JSON.parse(
    await Deno.readTextFile(`${RAIZ}/scripts/frota/canais-de-backend.json`),
  );
  const lotes = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261530000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].versoes, ["20261530000000"]);
  assertEquals(lotes[0].consulta, A190);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B190);
  assert(
    !("backfillLedger" in lotes[0]) &&
      !("nuncaAplicar" in lotes[0]) &&
      !("soNosRefs" in lotes[0]),
  );
  const i190 = canais.provasDeObjetos.findIndex((l) => l.consulta === A190);
  assertEquals(
    canais.provasDeObjetos[i190 - 1]?.consulta,
    "186a-conferir-a-caderneta-confere-a-chave-sem-bcrypt-aplicado",
    "anexado logo depois do lote da 20261490",
  );
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("../scripts/frota/publicar-release.mjs", import.meta.url).href
  );
  const menu = await Deno.readTextFile(
    `${RAIZ}/.github/workflows/conferir-banco-da-loja.yml`,
  );
  const rpc = (
    await Deno.readTextFile(`${RAIZ}/.github/workflows/rpc-ci.yml`)
  ).replace(/\r/g, "");
  for (const nome of [A190, B190]) {
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
  const passo = `run: node tests/banco/rodar-isolado.cjs ${PROVA_VIVA}`;
  assertEquals(rpc.split(passo).length - 1, 1);
  // No job BLOQUEANTE do dinheiro (antes do job informacional).
  assert(rpc.indexOf(passo) < rpc.indexOf("\n  provas-informacionais:"));
  assert(rpc.indexOf(passo) > rpc.indexOf("\n  contrato-dinheiro:"));
  const leiaMe = await Deno.readTextFile(`${RAIZ}/tests/banco/LEIA-ME.md`);
  assertStringIncludes(leiaMe, "a-loja-grande-nao-trava-o-balcao-viva.cjs");
});

Deno.test("inventario das portas: a porta nova e do LOGADO (so authenticated executa), leitura, SECURITY DEFINER", async () => {
  const inv = JSON.parse(
    await Deno.readTextFile(
      `${RAIZ}/tests/banco/portas-do-visitante-permitidas.json`,
    ),
  );
  const linhas = inv.funcoes.filter((f) =>
    f.funcao.startsWith("public.buscar_clientes_do_balcao("),
  );
  assertEquals(linhas.length, 1);
  assertEquals(
    linhas[0].funcao,
    "public.buscar_clientes_do_balcao(p_search text, p_limite integer)",
  );
  assertEquals(linhas[0].executa, ["authenticated"]);
  assertEquals(linhas[0].tipo, "leitura");
  assertEquals(linhas[0].secdef, true);
  assertEquals(linhas[0].situacao, "logado");
});

Deno.test("tipos do front: a porta nova esta em database.types.ts com os dois argumentos e devolve Json", async () => {
  const tipos = (
    await Deno.readTextFile(`${RAIZ}/src/types/database.types.ts`)
  ).replace(/\r/g, "");
  assertStringIncludes(
    tipos,
    "      buscar_clientes_do_balcao: {\n        Args: { p_limite: number; p_search: string };\n        Returns: Json;\n      };\n",
  );
});

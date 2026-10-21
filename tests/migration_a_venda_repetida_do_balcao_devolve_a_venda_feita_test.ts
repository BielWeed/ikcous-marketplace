// @ts-nocheck
// A VENDA REPETIDA DO BALCÃO DEVOLVE A VENDA FEITA — prova offline do par 20261235000000 +
// rollback (caçada de 14/10/2026). O COMPORTAMENTO (a espera pela primeira, o `ja_existia` com o MESMO
// pedido, as chaves diferentes e a venda sem chave que não se serializam) é provado com duas conexões
// reais em tests/banco/venda-balcao-mesma-chave-viva.cjs; aqui fica o que se prova só lendo o texto, no
// `npm run test:unit`.
//
// Riscos amarrados: corpo que não é o vigente (o da 20261199000000, com os dois gates de admin) apaga uma
// guarda em silêncio; trocar mais do que a UMA trava declarada muda outra regra do balcão; a trava tomada
// ANTES do gate (quem não é da loja seguraria uma chave); hash de preflight que não é o md5 real;
// rollback que não volta byte a byte; GRANT/REVOKE/COMMENT escondido; consultas 8e, 9a, 36a e 36b com o
// hash errado.
//
// Asserções por `node:assert/strict` (embutido no Deno): roda sem rede.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const { createHash } = require("node:crypto");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261235000000_a_venda_repetida_do_balcao_devolve_a_venda_feita.sql";
const NOVENTA_E_NOVE = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const HASH_VIGENTE = "6a421904a7c99a0e17ca58f2f891c71d";
const HASH_NOVO = "996caf02505ac16a8bded73bcf8900aa";
const ASSINATURA =
  "public.registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);

const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

/** Texto da função num arquivo, do CREATE até o `$$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
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

const antes = funcao(ler(NOVENTA_E_NOVE), "registrar_venda_presencial");
const depois = funcao(migration, "registrar_venda_presencial");
const desfeito = funcao(rollback, "registrar_venda_presencial");

const INICIO_DA_TRAVA =
  "        -- A MESMA CHAVE ESPERA A PRIMEIRA TERMINAR (20261235000000).";
const FIM_DA_TRAVA = "        SELECT o.id, o.canal, o.vendedor_id\n";

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("só registrar_venda_presencial é redefinida, nos dois arquivos", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, ["registrar_venda_presencial"]);
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição antes desta migration (a 20261199000000), com o md5 citado nas notas", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const com = nomes.filter((n) =>
    /^CREATE (OR REPLACE )?FUNCTION (public\.|"public"\.")registrar_venda_presencial"?\(/m.test(
      ler(n),
    ),
  );
  assert.equal(com.at(-1), NOVENTA_E_NOVE);
  assert.equal(md5(corpo(antes)), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261199000000 byte a byte MAIS UM bloco: a trava consultiva pela chave, depois dos gates e antes de conferir a chave", () => {
  const c = corpo(depois);
  const i = c.indexOf(INICIO_DA_TRAVA);
  const j = c.indexOf(FIM_DA_TRAVA);
  assert.ok(i > 0 && j > i, "o bloco da trava não foi achado");
  assert.equal(c.indexOf(INICIO_DA_TRAVA, i + 1), -1, "o bloco aparece 2x");
  // tirado o bloco, sobra EXATAMENTE o corpo da 99
  assert.equal(c.slice(0, i) + c.slice(j), corpo(antes));
  // o bloco é comentário + UM PERFORM, nada mais
  const bloco = semComentarios(c.slice(i, j)).replace(/\s+/g, " ").trim();
  assert.equal(
    bloco,
    "PERFORM pg_catalog.pg_advisory_xact_lock( pg_catalog.hashtextextended('venda_presencial:' || p_idempotency_key::text, 0));",
  );
  // dentro do IF da chave não nula, DEPOIS dos dois gates de admin e da checagem de sessão, ANTES da conferência
  const posGate1 = c.indexOf("IF public.is_admin() IS DISTINCT FROM true THEN");
  const posGate2 = c.indexOf(
    "IF public.is_admin_atual() IS DISTINCT FROM true THEN",
  );
  const posSessao = c.indexOf("IF v_vendedor IS NULL THEN");
  const posIf = c.indexOf("IF p_idempotency_key IS NOT NULL THEN");
  assert.ok(posGate1 > 0 && posGate2 > posGate1 && posSessao > posGate2);
  assert.ok(posIf > posSessao && i > posIf, "a trava vem depois dos gates");
  assert.ok(
    c.slice(posIf, i).trim().split("\n").length < 30 &&
      !/FOR NO KEY UPDATE|FOR UPDATE/.test(c.slice(0, i)),
    "nenhuma trava de linha antes da consultiva",
  );
  assert.ok(!c.includes("$$"), "$$ dentro do corpo");
  // o cabeçalho (assinatura, SECURITY DEFINER, search_path) é o mesmo
  assert.equal(cabecalho(depois), cabecalho(antes));
  assert.ok(!cabecalho(depois).includes("STABLE"));
  assert.ok(cabecalho(depois).includes("SECURITY DEFINER"));
  assert.ok(
    cabecalho(depois).includes("SET search_path TO 'pg_catalog', 'pg_temp'"),
  );
  // a trava é a ÚNICA do arquivo
  assert.equal(c.split("pg_advisory").length - 1, 1);
  // a chave NULL não toma trava: o PERFORM está dentro do IF de chave não nula
  assert.ok(c.slice(posIf, i).includes("p_idempotency_key IS NOT NULL"));
});

Deno.test("o rollback devolve o corpo da 20261199000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
  assert.equal(corpo(desfeito), corpo(antes));
  assert.equal(md5(corpo(desfeito)), HASH_VIGENTE);
  assert.equal(cabecalho(desfeito), cabecalho(depois));
});

Deno.test("os preflights e as conferências citam o md5 REAL dos dois corpos e recusam com B1_BASELINE_DIVERGENT", () => {
  const novo = md5(corpo(depois));
  assert.equal(novo, HASH_NOVO);
  assert.notEqual(novo, HASH_VIGENTE);
  const preflight = migration.slice(
    0,
    migration.indexOf("END $preflight_20261235$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261235$"),
  );
  assert.ok(
    preflight.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${novo}')`),
    "preflight da migration",
  );
  assert.ok(
    preflightRb.includes(`('${ASSINATURA}', '${HASH_VIGENTE}', '${novo}')`),
    "preflight do rollback",
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
  const conferencia = migration.slice(
    migration.indexOf("DO $conferencia_20261235$"),
  );
  assert.ok(conferencia.includes(`IS DISTINCT FROM '${novo}'`));
  const conferenciaRb = rollback.slice(
    rollback.indexOf("DO $conferencia_rollback_20261235$"),
  );
  assert.ok(conferenciaRb.includes(`IS DISTINCT FROM '${HASH_VIGENTE}'`));
  // Nenhum hash em lugar nenhum que não seja um dos dois.
  for (const sql of [migration, rollback]) {
    const hashes = new Set(
      [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]),
    );
    for (const h of hashes)
      assert.ok([HASH_VIGENTE, novo].includes(h), `hash estranho ${h}`);
  }
  // O hash da ficha de verificação é o do corpo novo.
  assert.ok(migration.includes(`esperado: ${novo}.`));
});

Deno.test("o pré-voo e a conferência olham atributos e ACL (EXECUTE só para authenticated), a sobrecarga e a existência", () => {
  for (const sql of [
    migration.slice(0, migration.indexOf("END $preflight_20261235$")),
    migration.slice(migration.indexOf("DO $conferencia_20261235$")),
    rollback.slice(0, rollback.indexOf("END $preflight_rollback_20261235$")),
    rollback.slice(rollback.indexOf("DO $conferencia_rollback_20261235$")),
  ]) {
    assert.ok(
      sql.includes(
        "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      ),
    );
    assert.ok(sql.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"));
    assert.ok(
      sql.includes("has_function_privilege('service_role', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      sql.includes("has_function_privilege('authenticated', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      sql.includes(
        "p.proconfig = ARRAY['search_path=pg_catalog, pg_temp']::text[]",
      ),
    );
    assert.ok(sql.includes("p.prosecdef"));
    assert.ok(sql.includes("p.pronargs = 8"));
  }
  assert.ok(migration.includes("tem sobrecarga em public"));
  assert.ok(rollback.includes("tem sobrecarga em public"));
  // a rede de segurança que a função consulta depois da trava: o índice único da chave
  assert.ok(
    migration.includes("marketplace_orders_chave_da_compra_unica"),
    "o pré-voo confere o índice único da chave",
  );
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/COMMENT/DROP/ALTER/gatilho no par", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261235$"],
    [rollback, "DO $preflight_rollback_20261235$"],
  ]) {
    const i = sql.indexOf(bloco);
    assert.ok(i >= 0 && sql.indexOf("END $preflight") > i);
    const antesDoBloco = semComentarios(sql.slice(0, i));
    for (const escrita of [
      /CREATE\s/i,
      /REVOKE\s/i,
      /GRANT\s/i,
      /ALTER\s/i,
      /DROP\s/i,
    ]) {
      assert.ok(!escrita.test(antesDoBloco), `${escrita} antes do preflight`);
    }
    // fora do corpo da função (o corpo, que é o do balcão, grava vendas por dentro)
    const c = semComentarios(
      sql.replace(funcao(sql, "registrar_venda_presencial"), ""),
    );
    for (const proibido of [
      /^\s*GRANT\b/im,
      /^\s*REVOKE\b/im,
      /^\s*COMMENT\s+ON\b/im,
      /\bDROP\s+(FUNCTION|TABLE|TRIGGER|POLICY|COLUMN)\b/i,
      /^\s*ALTER\s/im,
      /^\s*CREATE\s+TRIGGER\b/im,
      /^\s*(INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    ]) {
      assert.ok(!proibido.test(c), `${proibido} no arquivo`);
    }
  }
});

Deno.test("os cabeçalhos apontam a prova viva e o rollback", () => {
  assert.ok(
    migration.includes("tests/banco/venda-balcao-mesma-chave-viva.cjs"),
  );
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
  assert.ok(rollback.includes("COM ELE VOLTA O DEFEITO"));
});

Deno.test("as consultas 36a/36b, a 8e e a 9a citam os md5 REAIS dos dois corpos", () => {
  const novo = md5(corpo(depois));
  const c36a = lerArquivo(
    "scripts/publicacao/consultas/36a-conferir-venda-repetida-do-balcao-aplicado.sql",
  );
  const c36b = lerArquivo(
    "scripts/publicacao/consultas/36b-antes-venda-repetida-do-balcao-corpo-vigente.sql",
  );
  assert.ok(c36a.includes(`'${novo}'`), "36a cita o md5 do corpo novo");
  assert.ok(!c36a.includes(HASH_VIGENTE), "36a não cita o corpo antigo");
  assert.ok(c36b.includes(`'${HASH_VIGENTE}'`), "36b cita o md5 do vigente");
  assert.ok(!c36b.includes(novo), "36b não cita o corpo novo");
  // o marcador das duas consultas é o texto REAL da trava, e só o corpo novo o tem
  const marcador =
    "hashtextextended('venda_presencial:' || p_idempotency_key::text, 0)";
  assert.ok(corpo(depois).includes(marcador));
  assert.ok(!corpo(antes).includes(marcador));
  for (const sql of [c36a, c36b])
    assert.ok(
      sql.includes(marcador.replace(/'/g, "''")),
      "a consulta mede o marcador com a aspa dobrada",
    );
  // a 8e (rol de sucessoras) aceita o corpo novo como sucessor e continua aceitando o da 99
  const c8e = lerArquivo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(`('registrar_venda_presencial', '${novo}', '20261235000000')`),
    "a 8e tem de aceitar o corpo novo como sucessora",
  );
  assert.ok(
    c8e.includes(`('registrar_venda_presencial', '${HASH_VIGENTE}')`),
    "a 8e continua tendo o corpo da 20261199000000 como o `final`",
  );
  // A 36a aceita SOMENTE a sucessora medida que preserva a trava; a 36b continua
  // negativa nela, porque prova o ANTES historico da 235 (sem trava).
  const hashSucessora = md5(
    corpo(
      funcao(
        ler(
          "20261249000000_o_motivo_do_desconto_do_balcao_nao_chega_a_cliente.sql",
        ),
        "registrar_venda_presencial",
      ),
    ),
  );
  assert.ok(c36a.includes(`f.m = '${hashSucessora}'`));
  assert.ok(!c36b.includes(hashSucessora), "36b nao aceita quem ja tem trava");
  // A 9a (igualdade exata) acompanha o corpo FINAL vivo, hoje o sucessor da
  // 20261280. Os hashes da 235 e 249 continuam obrigatórios na 8e/36a acima.
  const c9a = lerArquivo(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  const sucessora = funcao(
    ler("20261280000000_o_balcao_registra_so_o_total_conferido.sql"),
    "registrar_venda_presencial",
  );
  assert.ok(
    c9a.includes(`('registrar_venda_presencial', '${md5(corpo(sucessora))}')`),
  );
  assert.ok(!c9a.includes(novo), "9a não fixa mais a 235 como corpo final");
  assert.ok(!c9a.includes(HASH_VIGENTE));
});

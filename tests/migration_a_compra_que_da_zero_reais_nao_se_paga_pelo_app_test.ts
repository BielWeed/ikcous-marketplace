// @ts-nocheck
// A COMPRA QUE DÁ R$ 0,00 NÃO SE PAGA PELO APP — prova offline do par 20261236000000 + rollback
// (decisão do dono de 14/10/2026). O COMPORTAMENTO (a recusa antes do pedido, da baixa do estoque e do uso
// do cupom, os meios que não mudam, o R$ 0,01 que segue nascendo) é provado num Postgres real em
// tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs; aqui fica o que se prova só lendo o
// texto, no `npm run test:unit`.
//
// Riscos amarrados: corpo que não é o da 20261229000000 (o do endereço da compra) apaga em silêncio o bloco
// 6-bis; trocar mais do que o UM bloco declarado muda outra regra do checkout; o bloco depois do INSERT do
// pedido (o pedido nasceria e a recusa viria tarde); a recusa lendo o total que o CLIENTE mandou; a v23 (a
// compra na entrega) tocada; hash de preflight que não é o md5 real; rollback que não volta byte a byte;
// GRANT/REVOKE/COMMENT escondido; consultas 31a, 37a e 37b com o hash errado.
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
  "20261236000000_a_compra_que_da_zero_reais_nao_se_paga_pelo_app.sql";
const VINTE_E_NOVE = "20261229000000_o_endereco_da_compra_fica_no_pedido.sql";
const HASH_VIGENTE = "b1ee9337105f442511c13a75977911b7";
const HASH_NOVO = "6002fc8db6c1d402bc704f018a0c2621";
const FN = "create_marketplace_order_v24";

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

/** Texto da função num arquivo, do CREATE até o `$function$;`. */
const funcao = (sql, nome) => {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não encontrada`);
  assert.equal(sql.indexOf(marcador, i + 1), -1, `${nome} aparece 2x`);
  const resto = sql.slice(i + 1);
  return resto.slice(
    0,
    resto.indexOf("\n$function$;") + "\n$function$;".length,
  );
};
/** O que o Postgres grava em prosrc: entre `AS $function$` e `$function$;`. */
const corpo = (texto) =>
  texto.slice(
    texto.indexOf("AS $function$") + "AS $function$".length,
    texto.length - "$function$;".length,
  );
const cabecalho = (texto) => texto.slice(0, texto.indexOf("AS $function$"));

const antes = funcao(ler(VINTE_E_NOVE), FN);
const depois = funcao(migration, FN);
const desfeito = funcao(rollback, FN);

const INICIO_DO_BLOCO =
  "    -- 6-ter. COMPRA QUE DÁ R$ 0,00 NÃO SE PAGA PELO APP";
const FIM_DO_BLOCO = "    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO";
const CONDICAO =
  "IF p_payment_method = 'online' AND round(v_calculated_total, 2) <= 0 THEN";

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

Deno.test("só create_marketplace_order_v24 é redefinida, nos dois arquivos (a v23, da compra na entrega, NÃO é tocada)", () => {
  for (const sql of [migration, rollback]) {
    const nomes = [
      ...semComentarios(sql).matchAll(
        /^CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)\(/gm,
      ),
    ].map((m) => m[1]);
    assert.deepEqual(nomes, [FN]);
    assert.ok(
      !/CREATE OR REPLACE FUNCTION public\.create_marketplace_order_v23\(/.test(
        sql,
      ),
    );
  }
});

Deno.test("o ponto de partida é a ÚLTIMA definição da v24 antes desta migration (a 20261229000000), com o md5 citado", () => {
  const nomes = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .filter((e) => e.isFile && /^\d{14}_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter((n) => n < NOME)
    .sort();
  const com = nomes.filter((n) =>
    new RegExp(
      `^CREATE (OR REPLACE )?FUNCTION (public\\.|"public"\\.)${FN}"?\\(`,
      "m",
    ).test(ler(n)),
  );
  assert.equal(com.at(-1), VINTE_E_NOVE);
  assert.equal(md5(corpo(antes)), HASH_VIGENTE);
});

Deno.test("o corpo novo é o da 20261229000000 byte a byte MAIS UM bloco (o 6-ter): depois da trava do preço e antes da cópia do endereço, ANTES do INSERT do pedido, da baixa do estoque e do uso do cupom", () => {
  const c = corpo(depois);
  const i = c.indexOf(INICIO_DO_BLOCO);
  const j = c.indexOf(FIM_DO_BLOCO);
  assert.ok(i > 0 && j > i, "o bloco 6-ter não foi achado");
  assert.equal(c.indexOf(INICIO_DO_BLOCO, i + 1), -1, "o bloco aparece 2x");
  // tirado o bloco, sobra EXATAMENTE o corpo da 20261229000000
  assert.equal(c.slice(0, i) + c.slice(j), corpo(antes));
  // o bloco é comentário + UM IF com UM RAISE EXCEPTION, nada mais
  const bloco = semComentarios(c.slice(i, j)).replace(/\s+/g, " ").trim();
  assert.ok(bloco.startsWith(CONDICAO), bloco);
  assert.equal(bloco.split("RAISE EXCEPTION").length - 1, 1);
  assert.ok(bloco.endsWith("END IF;"), bloco);
  assert.ok(
    bloco.includes("pedido_sem_valor_a_pagar_pelo_app"),
    "o identificador estável da recusa vai no DETAIL",
  );
  assert.ok(
    !/\b(INSERT|UPDATE|DELETE|PERFORM)\b/i.test(bloco),
    "o bloco só decide, não escreve",
  );
  // o total é o CALCULADO pelo servidor: nunca o que o cliente mandou
  assert.ok(!bloco.includes("p_total_amount"), "o bloco lê o total do cliente");
  assert.ok(bloco.includes("v_calculated_total"));
  // a ordem: depois do cálculo do total e da trava de preço adulterado; antes de tudo o que grava
  const posTotal = c.indexOf("v_calculated_total");
  const posInsert = c.indexOf("INSERT INTO public.marketplace_orders");
  const posEstoque = c.search(/UPDATE\s+public\.(produtos|product_variants)/i);
  const posCupom = c.search(/coupon_usage|used_count|coupon_uses/i);
  assert.ok(
    posTotal >= 0 && posTotal < i,
    "o total é calculado antes do bloco",
  );
  assert.ok(posInsert > j, "o INSERT do pedido vem depois do bloco");
  if (posEstoque >= 0)
    assert.ok(posEstoque > j, "a baixa do estoque vem depois");
  if (posCupom >= 0) assert.ok(posCupom > j, "o uso do cupom vem depois");
  // o meio de pagamento que muda é só o `online` (pix, card e cash seguem como antes)
  assert.equal(c.split(CONDICAO).length - 1, 1);
  assert.ok(!c.includes("$$"), "$$ dentro do corpo");
  // o cabeçalho (assinatura, SECURITY DEFINER, search_path, retorno uuid) é o mesmo
  assert.equal(cabecalho(depois), cabecalho(antes));
  assert.ok(!cabecalho(depois).includes("STABLE"));
  assert.ok(cabecalho(depois).includes("SECURITY DEFINER"));
  assert.ok(cabecalho(depois).includes("SET search_path TO 'public'"));
  assert.ok(cabecalho(depois).includes("RETURNS uuid"));
});

Deno.test("o rollback devolve o corpo da 20261229000000 byte a byte (md5 vigente), com o mesmo cabeçalho", () => {
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
    migration.indexOf("END $preflight_20261236$"),
  );
  const preflightRb = rollback.slice(
    0,
    rollback.indexOf("END $preflight_rollback_20261236$"),
  );
  for (const sql of [preflight, preflightRb]) {
    assert.ok(sql.includes(`v_antigo constant text := '${HASH_VIGENTE}'`));
    assert.ok(sql.includes(`v_novo constant text := '${novo}'`));
    assert.ok(sql.includes("md5(replace(prosrc, E'\\r', ''))"));
    assert.ok(sql.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
    assert.ok(!/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(sql));
  }
  const conferencia = migration.slice(
    migration.indexOf("DO $conferencia_20261236$"),
  );
  assert.ok(conferencia.includes(`v_esperado constant text := '${novo}'`));
  const conferenciaRb = rollback.slice(
    rollback.indexOf("DO $conferencia_rollback_20261236$"),
  );
  assert.ok(
    conferenciaRb.includes(`v_esperado constant text := '${HASH_VIGENTE}'`),
  );
  // Nenhum hash em lugar nenhum que não seja um dos dois.
  for (const sql of [migration, rollback]) {
    const hashes = new Set(
      [...sql.matchAll(/'([0-9a-f]{32})'/g)].map((m) => m[1]),
    );
    for (const h of hashes)
      assert.ok([HASH_VIGENTE, novo].includes(h), `hash estranho ${h}`);
  }
});

Deno.test("o pré-voo e a conferência olham atributos e ACL (anon, authenticated e service_role sim; PUBLIC não), a sobrecarga e a existência", () => {
  for (const sql of [
    migration.slice(0, migration.indexOf("END $preflight_20261236$")),
    migration.slice(migration.indexOf("DO $conferencia_20261236$")),
    rollback.slice(0, rollback.indexOf("END $preflight_rollback_20261236$")),
    rollback.slice(rollback.indexOf("DO $conferencia_rollback_20261236$")),
  ]) {
    assert.ok(
      sql.includes(
        "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
      ),
    );
    assert.ok(sql.includes("p.prosecdef"));
    assert.ok(sql.includes("search_path=public"));
  }
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes("tem sobrecarga em public"));
    assert.ok(sql.includes("(13 argumentos)"));
  }
});

Deno.test("os preflights vêm ANTES de qualquer escrita; nenhum GRANT/REVOKE/COMMENT/DROP/ALTER/gatilho e nenhum INSERT/UPDATE/DELETE fora do corpo da função", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261236$"],
    [rollback, "DO $preflight_rollback_20261236$"],
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
    // fora do corpo da função (o corpo, que é o do checkout, grava pedidos por dentro)
    const c = semComentarios(sql.replace(funcao(sql, FN), ""));
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
    migration.includes(
      "tests/banco/a-compra-que-da-zero-reais-nao-se-paga-pelo-app-viva.cjs",
    ),
  );
  assert.ok(migration.includes(`rollback-manual-${NOME}`));
  assert.ok(rollback.includes("COM ELE VOLTA O"));
});

Deno.test("as consultas 37a/37b e a 31a citam os md5 REAIS dos corpos e o marcador REAL da recusa", () => {
  const novo = md5(corpo(depois));
  const c37a = lerArquivo(
    "scripts/publicacao/consultas/37a-conferir-compra-de-zero-reais-nao-se-paga-pelo-app-aplicado.sql",
  );
  const c37b = lerArquivo(
    "scripts/publicacao/consultas/37b-antes-compra-de-zero-reais-nao-se-paga-pelo-app-corpo-vigente.sql",
  );
  assert.ok(c37a.includes(`'${novo}'`), "37a cita o md5 do corpo novo");
  assert.ok(!c37a.includes(HASH_VIGENTE), "37a não cita o corpo antigo");
  assert.ok(c37b.includes(`'${HASH_VIGENTE}'`), "37b cita o md5 do vigente");
  assert.ok(!c37b.includes(novo), "37b não cita o corpo novo");
  // os marcadores são o texto REAL do bloco, e só o corpo novo o tem
  const identificador = "pedido_sem_valor_a_pagar_pelo_app";
  assert.ok(corpo(depois).includes(identificador));
  assert.ok(corpo(depois).includes(CONDICAO));
  assert.ok(!corpo(antes).includes(identificador));
  assert.ok(c37a.includes(CONDICAO.replace(/'/g, "''")));
  assert.ok(c37a.includes(identificador));
  assert.ok(c37b.includes(identificador));
  // a 31a aceita o corpo novo como sucessor da v24 (e a 20261244000000, depois dele, como a segunda) e responde com o da 20261229000000
  const c31a = lerArquivo(
    "scripts/publicacao/consultas/31a-conferir-endereco-da-compra-fica-no-pedido.sql",
  );
  assert.ok(
    c31a.includes(
      `f.m IN ('${HASH_VIGENTE}', '${novo}', '85c37af4baa2f5ce1375bdd9e943c746')`,
    ),
  );
  assert.equal(c31a.split(novo).length - 1, 1);
});

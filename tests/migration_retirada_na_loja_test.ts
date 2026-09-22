// @ts-nocheck
// A RETIRADA NA LOJA NASCE NO SERVIDOR — prova offline do par
// 20261169000000 + rollback (release 1.5.3, 22/09/2026).
//
// O QUE ESTE TESTE FIXA:
//   1. o corpo novo de create_marketplace_order_v23/_v24 é o da
//      20261168000000 BYTE A BYTE + só as três trocas da retirada (2-ter,
//      bloco 4, INSERT) — tirar as três trocas devolve o texto da 20261168
//      exatamente, sem uma vírgula de diferença;
//   2. o preflight pina o corpo que a 20261168 deixou nos DOIS fins de linha
//      — LF (CI Linux) e CRLF (o que está VIVO nos bancos das lojas, medido
//      pela hub em 22/09: v23 2d99adfd…, v24 b728cea3…) — e aborta com
//      mensagem clara se a 20261167 (coluna store_address) faltar;
//   3. o rollback reaplica os statements da 20261168 byte a byte;
//   4. a entrada VERIFICACOES reprova contra o corpo sem a retirada.
// Sabotar qualquer asserção abaixo (tirar o COALESCE fail-closed do = ANY,
// esquecer o id canônico, gravar frete que não é 0) reabre um caminho de
// dinheiro: pedido de retirada nascendo em loja que não a oferece, ou sem o
// endereço da loja no pedido.
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
const { avaliarChecagem, VERIFICACOES } = require("../scripts/db-apply.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261169000000_a_retirada_na_loja_nasce_no_servidor.sql";
const ANTERIOR =
  "20261168000000_a_transportadora_exige_pagamento_antecipado.sql";
const lf = (s) => s.replace(/\r\n/g, "\n");
const migration = lf(
  Deno.readTextFileSync(`${DIR}../supabase/migrations/${NOME}`),
);
const rollback = lf(
  Deno.readTextFileSync(`${DIR}../supabase/migrations/rollback-manual-${NOME}`),
);
const anterior = lf(
  Deno.readTextFileSync(`${DIR}../supabase/migrations/${ANTERIOR}`),
);

// Medido pela hub nos DOIS bancos das lojas (IKCOUS e SAVY), 22/09/2026:
// prosrc VIVO depois da 20261168000000 (gravado com CRLF).
const HASH_VIVO_V23 =
  "2d99adfd1028e60fcb02de34e6818ace4d8c55d1202f172fd603786604d6d28c";
const HASH_VIVO_V24 =
  "b728cea3264227075578946beaa9c2fa0d2f1b400c207d839609bfa5e14b4682";

/** Statement completo (do CREATE ao `$function$;`) e o miolo (o prosrc). */
function statement(sql, funcao) {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${funcao}(`);
  assert(ini >= 0, `${funcao} não encontrada`);
  const a = sql.indexOf("$function$", ini) + "$function$".length;
  const z = sql.indexOf("$function$", a);
  return {
    texto: sql.slice(ini, z + "$function$;".length),
    miolo: sql.slice(a, z),
  };
}

async function sha256Hex(texto) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(texto),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const crlf = (s) => s.replace(/\n/g, "\r\n");

/** Tira as três trocas da retirada — o que sobra tem de ser a 20261168. */
function semAsTrocas(texto, versao) {
  let t = texto;
  const iniA = t.indexOf("    ELSIF v_opcao = 'store-pickup' THEN\n");
  const fimA = t.indexOf(`    ELSE\n        -- A ${versao} é a RPC`);
  assert(iniA > 0 && fimA > iniA, `${versao}: troca (a) fora do lugar`);
  t = t.slice(0, iniA) + t.slice(fimA);

  const iniB = t.indexOf(
    "    -- RETIRADA NA LOJA (20261169000000): frete ZERO.",
  );
  const fimB = t.indexOf("    ELSIF p_destination_cep IS NOT NULL THEN");
  assert(iniB > 0 && fimB > iniB, `${versao}: troca (b) fora do lugar`);
  t = t.slice(0, iniB) + t.slice(fimB);

  const iniC = t.indexOf(
    "        )\n        -- RETIRADA NA LOJA (20261169000000): o RETRATO",
  );
  const marcaFimC = "ELSE '{}'::jsonb END,\n";
  const fimC = t.indexOf(marcaFimC, iniC);
  assert(iniC > 0 && fimC > iniC, `${versao}: troca (c) fora do lugar`);
  t = `${t.slice(0, iniC)}        ),\n${t.slice(fimC + marcaFimC.length)}`;
  return t;
}

for (const [funcao, versao] of [
  ["create_marketplace_order_v23", "v23"],
  ["create_marketplace_order_v24", "v24"],
]) {
  Deno.test(`${versao}: corpo = 20261168 byte a byte + SÓ as três trocas da retirada`, () => {
    const novo = statement(migration, funcao).texto;
    const velho = statement(anterior, funcao).texto;
    assert(novo !== velho, "a migration não mudou nada");
    assertEquals(semAsTrocas(novo, versao), velho);
  });

  Deno.test(`${versao}: o ramo do 2-ter revalida os TRÊS requisitos, fail-closed, antes do frete grátis`, () => {
    const corpo = statement(migration, funcao).miolo;
    const ramo = corpo.slice(
      corpo.indexOf("    ELSIF v_opcao = 'store-pickup' THEN\n"),
      corpo.indexOf(`    ELSE\n        -- A ${versao} é a RPC`),
    );
    // id canônico (o bloco 4 e o INSERT leem o parâmetro cru)
    assertStringIncludes(
      ramo,
      "IF p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN",
    );
    // chave habilitada — COALESCE(..., false): NULL no array não habilita
    assertStringIncludes(
      ramo,
      "IF COALESCE('store-pickup' = ANY(COALESCE(v_store_config.enabled_shipping_methods, '{}'::text[])), false) = false THEN",
    );
    // endereço físico não vazio
    assertStringIncludes(
      ramo,
      "IF NULLIF(btrim(COALESCE(v_store_config.store_address, '')), '') IS NULL THEN",
    );
    // CEP local, mesma prova fail-closed do local-delivery
    assertStringIncludes(
      ramo,
      "OR COALESCE(public.is_local_cep(v_store_config.origin_cep, v_cep_de_entrega, v_store_config.local_cep_range), false) = false THEN",
    );
    // Frases JÁ classificadas pelo front (recusaDoPedido.ts)
    assertStringIncludes(
      ramo,
      "'Opção de entrega inválida. Volte ao carrinho e escolha uma entrega válida.'",
    );
    assertStringIncludes(
      ramo,
      "'Entrega local não disponível para o CEP informado.'",
    );
    // Pagamento = regras da entrega local: o ramo NÃO restringe meio.
    assertEquals(ramo.includes("p_payment_method"), false);
    // Antes do loop de validação e do bloco 4 (onde mora o frete grátis).
    assert(
      corpo.indexOf("ELSIF v_opcao = 'store-pickup'") <
        corpo.indexOf("-- 3. Validation Loop"),
    );
  });

  Deno.test(`${versao}: bloco 4 cobra frete ZERO na retirada, entre o local-delivery e o cache`, () => {
    const corpo = statement(migration, funcao).miolo;
    const ramo =
      "    ELSIF p_shipping_option_id = 'store-pickup' THEN\n" +
      "        v_dest_cep := regexp_replace(COALESCE(p_destination_cep, ''), '\\D', '', 'g');\n" +
      "        v_shipping_validated := 0;\n";
    assertEquals(corpo.split(ramo).length - 1, 1);
    const pos = corpo.indexOf(ramo);
    assert(
      pos > corpo.indexOf("ELSIF p_shipping_option_id = 'local-delivery' THEN"),
    );
    assert(pos < corpo.indexOf("ELSIF p_destination_cep IS NOT NULL THEN"));
  });

  Deno.test(`${versao}: o INSERT grava o retrato do endereço da loja SÓ na retirada`, () => {
    const corpo = statement(migration, funcao).miolo;
    assertStringIncludes(
      corpo,
      "        || CASE WHEN p_shipping_option_id = 'store-pickup'\n" +
        "                THEN jsonb_build_object('pickup_address', btrim(v_store_config.store_address))\n" +
        "                ELSE '{}'::jsonb END,\n",
    );
  });
}

Deno.test("preflight: hashes da 20261168 em LF e CRLF recalculados do arquivo — o CRLF é o VIVO medido nas lojas", async () => {
  const v23 = statement(anterior, "create_marketplace_order_v23").miolo;
  const v24 = statement(anterior, "create_marketplace_order_v24").miolo;
  // A ponte com o banco vivo: o prosrc que a hub mediu é o miolo da 20261168
  // com CRLF. Se o arquivo mudar, este teste reprova antes do banco recusar.
  assertEquals(await sha256Hex(crlf(v23)), HASH_VIVO_V23);
  assertEquals(await sha256Hex(crlf(v24)), HASH_VIVO_V24);
  for (const h of [
    HASH_VIVO_V23,
    HASH_VIVO_V24,
    await sha256Hex(v23),
    await sha256Hex(v24),
  ]) {
    assertStringIncludes(migration, `'${h}'`);
  }
});

Deno.test("preflight: aceita o PRÓPRIO corpo (LF e CRLF) — reaplicar é no-op", async () => {
  for (const funcao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    const miolo = statement(migration, funcao).miolo;
    assertStringIncludes(migration, `'${await sha256Hex(miolo)}'`);
    assertStringIncludes(migration, `'${await sha256Hex(crlf(miolo))}'`);
  }
});

Deno.test("preflight: aborta com mensagem clara sem a 20261167 (store_address) e sem enabled_shipping_methods — não cria coluna", () => {
  const preflight = migration.slice(
    migration.indexOf("DO $preflight$"),
    migration.indexOf("END $preflight$;"),
  );
  assertStringIncludes(preflight, "column_name = 'store_address'");
  assertStringIncludes(
    preflight,
    "aplique antes a 20261167000000_sobre_a_loja_ganha_endereco_e_descricao.sql",
  );
  assertStringIncludes(
    preflight,
    "column_name = 'enabled_shipping_methods' AND udt_name = '_text'",
  );
  // O preflight vem ANTES de qualquer statement que mude o banco.
  assert(
    migration.indexOf("END $preflight$;") <
      migration.indexOf("CREATE OR REPLACE FUNCTION public."),
  );
  const codigo = removerRuido(migration);
  assertEquals(/ALTER\s+TABLE/i.test(codigo), false);
  assertEquals(/ADD\s+COLUMN/i.test(codigo), false);
});

Deno.test("sem BEGIN/COMMIT, sem DROP, sem GRANT, sem UPDATE/INSERT de dado — nos dois arquivos", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
  for (const sql of [migration, rollback]) {
    const codigo = removerRuido(sql);
    assertEquals(/\bDROP\s+/i.test(codigo), false, "DROP no par");
    assertEquals(/\bGRANT\s+/i.test(codigo), false, "GRANT no par");
    assertEquals(/\bREVOKE\s+/i.test(codigo), false, "REVOKE no par");
    assertEquals(/UPDATE\s+public\.store_config/i.test(codigo), false);
  }
  assertEquals(migration.split("CREATE OR REPLACE FUNCTION").length - 1, 2);
  assertEquals(rollback.split("CREATE OR REPLACE FUNCTION").length - 1, 2);
});

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("rollback: os dois statements são os da 20261168 byte a byte", () => {
  for (const funcao of [
    "create_marketplace_order_v23",
    "create_marketplace_order_v24",
  ]) {
    assertEquals(
      statement(rollback, funcao).texto,
      statement(anterior, funcao).texto,
    );
  }
  assertEquals(rollback.includes("store-pickup' THEN"), false);
});

Deno.test("rollback: preflight aceita o corpo da 20261169 e o da 20261168 (LF e CRLF), nada mais", async () => {
  const preflight = rollback.slice(
    rollback.indexOf("DO $preflight$"),
    rollback.indexOf("END $preflight$;"),
  );
  const esperados = [];
  for (const sql of [migration, anterior]) {
    for (const funcao of [
      "create_marketplace_order_v23",
      "create_marketplace_order_v24",
    ]) {
      const miolo = statement(sql, funcao).miolo;
      esperados.push(await sha256Hex(miolo), await sha256Hex(crlf(miolo)));
    }
  }
  const pinados = preflight.match(/'[0-9a-f]{64}'/g).map((s) => s.slice(1, -1));
  assertEquals([...pinados].sort(), [...esperados].sort());
  assert(
    rollback.indexOf("END $preflight$;") <
      rollback.indexOf("CREATE OR REPLACE FUNCTION public."),
  );
});

// ---------------------------------------------------------------------------
// VERIFICACOES provada por SABOTAGEM: a MESMA checagem que o db-apply roda
// contra o banco reprova no corpo da 20261168 (sem a retirada) e verifica no
// corpo novo.
// ---------------------------------------------------------------------------
Deno.test("VERIFICACOES tem entrada para a 20261169000000 (v23 e v24)", () => {
  // eslint-disable-next-line security/detect-object-injection -- NOME é constante deste arquivo, não entrada de usuário
  const entrada = VERIFICACOES[NOME];
  assert(entrada !== undefined, "sem entrada em VERIFICACOES");
  assertEquals(
    entrada.map((c) => c.funcao),
    ["create_marketplace_order_v23", "create_marketplace_order_v24"],
  );
});

for (const [indice, funcao] of [
  [0, "create_marketplace_order_v23"],
  [1, "create_marketplace_order_v24"],
]) {
  Deno.test(`SABOTAGEM ${funcao}: corpo da 20261168 (sem a retirada) reprova; corpo novo verifica`, () => {
    // eslint-disable-next-line security/detect-object-injection -- índice fixo deste arquivo
    const checagem = VERIFICACOES[NOME][indice];
    assertEquals(
      avaliarChecagem(statement(anterior, funcao).texto, checagem).situacao,
      "falhou",
    );
    assertEquals(
      avaliarChecagem(statement(migration, funcao).texto, checagem).situacao,
      "verificada",
    );
  });
}

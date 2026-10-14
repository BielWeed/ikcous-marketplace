// @ts-nocheck
// O ENDERECO DA COMPRA FICA NO PEDIDO — prova offline do par 20261229000000 + rollback (dado de cliente; cacada
// de 14/10/2026). O COMPORTAMENTO pelo caminho real do checkout (a copia, editar e apagar depois, endereco de
// outro usuario, convidada, retirada, dinheiro/estoque/cupom identicos, mutantes, pre-voo, conferencia,
// atomicidade, concorrencia) e' provado em tests/banco/endereco-no-pedido-viva.cjs e o portao da release em
// tests/banco/endereco-no-pedido-portao-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo de v23 e de v24 tem de ser o corpo VIVO (o da 20261174000000) MAIS o bloco 6-bis (nada
// mais), o corpo do rollback tem de ser o antigo BYTE A BYTE, a assinatura e os atributos nao podem mudar,
// nenhum GRANT/REVOKE pode entrar (a ACL fica como esta), a leitura da copia tem de repetir o filtro de DONO,
// o pre-voo vem antes da troca e a conferencia depois, e o arquivo nao pode abrir transacao.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261229000000_o_endereco_da_compra_fica_no_pedido.sql";
const ANTIGA = "20261174000000_formas_de_pagamento_por_loja.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationAntiga = ler(ANTIGA);
const md5 = (s) => createHash("md5").update(s).digest("hex");

const V23 = "create_marketplace_order_v23";
const V24 = "create_marketplace_order_v24";
const hAntigo = (fn) =>
  fn === V23
    ? "59cbccc4aa8762a26cf98f2acf1c721a"
    : "8381691b7a03a9b232d21de8d756991d";
const funcaoDe = (sql, fn) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  assert.ok(ini >= 0, `${fn} nao achada`);
  const ab = sql.indexOf("$function$", ini);
  const corpoIni = ab + "$function$".length;
  return {
    cabeca: sql.slice(ini, corpoIni),
    corpo: sql.slice(corpoIni, sql.indexOf("$function$", corpoIni)),
    quantas: sql.split(`CREATE OR REPLACE FUNCTION public.${fn}(`).length - 1,
  };
};
const ANCORA = "    -- 7. Create Order Header\n    BEGIN\n";

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
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

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa: o aplicador abre a transacao)", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("so as duas funcoes sao criadas (um CREATE OR REPLACE de cada, uma vez em cada arquivo); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora dos blocos DO de conferencia", () => {
  for (const sql of [migration, rollback])
    for (const fn of [V23, V24])
      assert.equal(funcaoDe(sql, fn).quantas, 1, `${fn}: um CREATE OR REPLACE`);
  const fora = (sql) =>
    removerRuido(sql)
      // tira os blocos DO (pre-voo e conferencia) e os corpos das funcoes
      .replace(/DO \$[a-z_0-9]+\$[\s\S]*?END \$[a-z_0-9]+\$;/g, "")
      .replace(/\$function\$[\s\S]*?\$function\$/g, "$function$$function$");
  for (const sql of [migration, rollback]) {
    const resto = fora(sql);
    assert.ok(
      !/\b(GRANT|REVOKE|DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE|CREATE TABLE|CREATE INDEX|CREATE TRIGGER|CREATE POLICY)\b/i.test(
        resto,
      ),
      `statement a mais fora dos blocos: ${resto.slice(0, 200)}`,
    );
  }
  // a declaracao (assinatura, atributos) e' a MESMA da 20261174000000, byte a byte
  for (const fn of [V23, V24]) {
    const antiga = funcaoDe(migrationAntiga, fn);
    assert.equal(
      funcaoDe(migration, fn).cabeca,
      antiga.cabeca,
      `${fn}: declaracao`,
    );
    assert.equal(
      funcaoDe(rollback, fn).cabeca,
      antiga.cabeca,
      `${fn}: declaracao do rollback`,
    );
    for (const trecho of [
      "RETURNS uuid",
      "LANGUAGE plpgsql",
      "SECURITY DEFINER",
      "SET search_path TO 'public'",
    ])
      assert.ok(antiga.cabeca.includes(trecho), `${fn}: ${trecho}`);
  }
});

Deno.test("o corpo vivo e' o da 20261174000000 (md5 conhecido) e o corpo novo e' ele com UM bloco inserido antes do passo 7 (nada mais); o rollback recria o corpo vivo BYTE A BYTE", () => {
  for (const fn of [V23, V24]) {
    const antigo = funcaoDe(migrationAntiga, fn).corpo;
    const novo = funcaoDe(migration, fn).corpo;
    const volta = funcaoDe(rollback, fn).corpo;
    assert.equal(
      md5(antigo),
      hAntigo(fn),
      `${fn}: o corpo da 20261174000000 mudou`,
    );
    assert.equal(
      volta,
      antigo,
      `${fn}: o rollback nao e o corpo antigo byte a byte`,
    );
    assert.equal(
      antigo.split(ANCORA).length - 1,
      1,
      `${fn}: ancora do passo 7`,
    );
    const i = novo.indexOf("    -- 6-bis. O ENDEREÇO DA COMPRA FICA NO PEDIDO");
    assert.ok(i > 0, `${fn}: sem o bloco 6-bis`);
    const bloco = novo.slice(i, novo.indexOf(ANCORA));
    assert.equal(
      antigo.replace(ANCORA, bloco + ANCORA),
      novo,
      `${fn}: corpo novo != antigo + bloco`,
    );
    // o pre-voo, a conferencia e o rollback declaram os mesmos hashes
    for (const sql of [migration, rollback]) {
      assert.ok(
        sql.includes(`'${hAntigo(fn)}'`),
        `${fn}: hash antigo no arquivo`,
      );
      assert.ok(sql.includes(`'${md5(novo)}'`), `${fn}: hash novo no arquivo`);
    }
  }
});

Deno.test("o bloco 6-bis: so com conta (v_user_id), so com p_address_id, so sem endereco digitado e nunca na retirada; copia as 8 chaves sem chave nula; a leitura repete o filtro de DONO; fica entre a trava de preco e o INSERT do pedido; NAO mexe em total, estoque, cupom nem frete", () => {
  for (const fn of [V23, V24]) {
    const novo = funcaoDe(migration, fn).corpo;
    const condicao =
      "    IF v_address_data_sem_cpf IS NULL\n       AND v_user_id IS NOT NULL\n       AND p_address_id IS NOT NULL\n       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN\n";
    assert.equal(novo.split(condicao).length - 1, 1, `${fn}: condicao`);
    const leitura =
      "        SELECT jsonb_strip_nulls(jsonb_build_object(\n" +
      "                   'cep', ua.cep,\n" +
      "                   'street', ua.street,\n" +
      "                   'number', ua.number,\n" +
      "                   'complement', ua.complement,\n" +
      "                   'neighborhood', ua.neighborhood,\n" +
      "                   'city', ua.city,\n" +
      "                   'state', ua.state,\n" +
      "                   'reference', ua.reference\n" +
      "               ))\n" +
      "          INTO v_address_data_sem_cpf\n" +
      "          FROM public.user_addresses ua\n" +
      "         WHERE ua.id = p_address_id AND ua.user_id = v_user_id;\n";
    assert.equal(novo.split(leitura).length - 1, 1, `${fn}: leitura`);
    // posicao: depois da trava de preco adulterado (passo 6) e antes do INSERT do cabecalho (passo 7)
    const pos = (t) => novo.indexOf(t);
    assert.ok(
      pos("-- 6. Price Tampering Protection") < pos(condicao),
      `${fn}: depois do passo 6`,
    );
    assert.ok(
      pos(condicao) < pos("-- 7. Create Order Header"),
      `${fn}: antes do passo 7`,
    );
    // o INSERT continua gravando a MESMA variavel que o bloco preenche
    assert.equal(
      novo.split("'address', v_address_data_sem_cpf,").length - 1,
      1,
    );
    // o passo 1 (posse do endereco) segue de pe e vem ANTES de qualquer leitura da copia
    const posse =
      "IF NOT EXISTS (SELECT 1 FROM user_addresses WHERE id = p_address_id AND user_id = v_user_id) THEN";
    assert.equal(
      novo.split(posse).length - 1,
      1,
      `${fn}: posse do endereco (passo 1)`,
    );
    assert.ok(
      pos(posse) < pos(condicao),
      `${fn}: a posse e' provada antes da copia`,
    );
    // o bloco so toca a variavel do endereco: nenhuma outra atribuicao nele
    const i = novo.indexOf("    -- 6-bis.");
    const bloco = novo.slice(i, novo.indexOf("-- 7. Create Order Header"));
    const atribuicoes = [
      ...bloco
        .replace(/--.*$/gm, "")
        .matchAll(/\b(v_[a-z_]+)\s*:?=|INTO\s+(v_[a-z_]+)/g),
    ];
    assert.deepEqual(
      [...new Set(atribuicoes.map((m) => m[1] ?? m[2]))],
      ["v_address_data_sem_cpf"],
      `${fn}: o bloco 6-bis atribui algo alem de v_address_data_sem_cpf`,
    );
  }
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261229000000 (sem ela a migration sai PULADA, codigo 2): as duas funcoes, a condicao do bloco e o filtro de dono, 1 vez cada", () => {
  const src = Deno.readTextFileSync(
    new URL("scripts/db-apply.cjs", DIR),
  ).replace(/\r\n/g, "\n");
  const i = src.indexOf(`"${NOME}": [`);
  assert.ok(i > 0, "sem entrada em VERIFICACOES");
  const entrada = src.slice(i, src.indexOf('\n  ],\n  "2026', i + 10));
  for (const fn of [V23, V24])
    assert.ok(entrada.includes(`funcao: "${fn}"`), fn);
  assert.equal(entrada.split("vezes: 1").length - 1, 4);
  assert.ok(!/vezes:\s*[02-9]/.test(entrada), "todas as contagens sao 1");
  // os marcadores contam no corpo VIVO: cada um tem de aparecer UMA vez no corpo novo e ZERO no antigo
  const marcadores = [
    "IF v_address_data_sem_cpf IS NULL\n       AND v_user_id IS NOT NULL\n       AND p_address_id IS NOT NULL\n       AND p_shipping_option_id IS DISTINCT FROM 'store-pickup' THEN",
    "FROM public.user_addresses ua\n         WHERE ua.id = p_address_id AND ua.user_id = v_user_id;",
  ];
  for (const fn of [V23, V24])
    for (const m of marcadores) {
      assert.equal(
        funcaoDe(migration, fn).corpo.split(m).length - 1,
        1,
        `${fn}: novo`,
      );
      assert.equal(
        funcaoDe(migrationAntiga, fn).corpo.split(m).length - 1,
        0,
        `${fn}: antigo`,
      );
    }
});

Deno.test("o pre-voo vem antes da troca dos corpos, aceita SO os dois corpos de cada funcao, confere atributos, ACL de sempre e user_addresses; a conferencia vem depois e exige as DUAS funcoes no estado novo", () => {
  const iPre = migration.indexOf("DO $preflight_20261229$");
  const iV23 = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${V23}(`);
  const iV24 = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${V24}(`);
  const iConf = migration.indexOf("DO $conferencia_20261229$");
  assert.ok(
    iPre > 0 && iPre < iV23 && iV23 < iV24 && iV24 < iConf,
    "ordem pre-voo, v23, v24, conferencia",
  );
  const pre = migration.slice(iPre, iV23);
  const conf = migration.slice(iConf);
  assert.equal(pre.split("B1_BASELINE_DIVERGENT").length - 1 >= 6, true);
  for (const trecho of [
    "v_hash IS DISTINCT FROM v_antigo AND v_hash IS DISTINCT FROM v_novo",
    "l.lanname = 'plpgsql'",
    "p.prosecdef",
    "p.provolatile = 'v'",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_result(p.oid) = 'uuid'",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "has_function_privilege('service_role', v_oid, 'EXECUTE')",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_table_privilege(",
    "'cep', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'reference'",
    "count(*) FROM pg_proc p",
  ])
    assert.ok(pre.includes(trecho), `pre-voo sem: ${trecho}`);
  for (const trecho of [
    "v_hash IS DISTINCT FROM v_esperado",
    "alcançável por PUBLIC",
    "perdeu EXECUTE",
    "ficou com sobrecarga",
    "atributos de % mudaram",
  ])
    assert.ok(conf.includes(trecho), `conferencia sem: ${trecho}`);
  // o hash esperado pela conferencia e' o NOVO de cada funcao
  for (const fn of [V23, V24])
    assert.ok(
      conf.includes(`'${md5(funcaoDe(migration, fn).corpo)}'`),
      `${fn}: hash novo na conferencia`,
    );
});

Deno.test("o rollback tem pre-voo (corpo conhecido, atributos, ACL) e conferencia (corpo volta ao antigo); nunca da EXECUTE a PUBLIC (nem GRANT nem REVOKE)", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261229$");
  const iV23 = rollback.indexOf(`CREATE OR REPLACE FUNCTION public.${V23}(`);
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261229$");
  assert.ok(iPre > 0 && iPre < iV23 && iV23 < iConf);
  const conf = rollback.slice(iConf);
  for (const fn of [V23, V24])
    assert.ok(
      rollback.slice(iPre, iV23).includes(`'${hAntigo(fn)}'`) &&
        conf.includes(`'${hAntigo(fn)}'`),
    );
  assert.ok(conf.includes("corpo vivo de % (hash %) não voltou ao antigo"));
  assert.ok(conf.includes("aberta para PUBLIC"));
  assert.ok(!/\b(GRANT|REVOKE)\b/.test(removerRuido(rollback)));
});

Deno.test("o cabecalho declara o que o dono precisa saber: sem backfill (decisao do dono), a ordem, o rollback e quem JA le a copia (etiqueta e antifraude) e quem passa a ler neste PR (comprovante)", () => {
  for (const trecho of [
    "SEM backfill",
    "rollback-manual-20261229000000",
    "melhor-envio-etiqueta",
    "DADOS EXISTENTES",
    "PRÉ-VOO",
    "IDEMPOTÊNCIA E TRANSAÇÃO",
    "tests/banco/endereco-no-pedido-viva.cjs",
  ])
    assert.ok(migration.includes(trecho), trecho);
  // O que o cabecalho afirma sobre os LEITORES da copia e' conferido no codigo deles
  // (texto ao contrario ja saiu uma vez: dizia que a etiqueta lia a conta e o comprovante a copia).
  assert.ok(migration.includes("A ETIQUETA NÃO PRECISA MUDAR"));
  assert.ok(!migration.includes("lê o endereço ATUAL da"));
  assert.ok(migration.includes("fonteDoEnderecoDoComprovante"));
  assert.ok(migration.includes("send-order-confirmation"));
  const funcoes = new URL("supabase/functions/", DIR);
  const etiqueta = Deno.readTextFileSync(
    new URL("melhor-envio-etiqueta/index.ts", funcoes),
  );
  assert.ok(
    /const fonte = cd\.addressData \|\| \(typeof cd\.address === 'object'/.test(
      etiqueta,
    ),
    "a etiqueta prefere customer_data.address (objeto)",
  );
  const antifraude = Deno.readTextFileSync(
    new URL("_shared/dados-antifraude.ts", funcoes),
  );
  assert.ok(antifraude.includes("enderecoDaOrder(customerData?.address)"));
  const comprovante = Deno.readTextFileSync(
    new URL("_shared/comprovante.ts", funcoes),
  );
  assert.ok(
    comprovante.includes("export function fonteDoEnderecoDoComprovante"),
  );
  assert.ok(comprovante.includes("= fonteDoEnderecoDoComprovante("));
  for (const trecho of [
    "COM ELE VOLTA O DEFEITO",
    "FICAM com a cópia",
    "A ACL NÃO é tocada",
  ])
    assert.ok(rollback.includes(trecho), trecho);
});

Deno.test("so a 20261174000000 define o corpo vivo de v23 e v24 antes deste par (nenhuma migration posterior a redefine); depois dele, so este par", () => {
  const dir = new URL("supabase/migrations/", DIR);
  const definem = [];
  for (const e of Deno.readDirSync(dir)) {
    if (!e.isFile || !e.name.endsWith(".sql") || e.name.startsWith("rollback-"))
      continue;
    if (e.name < ANTIGA) continue;
    const t = Deno.readTextFileSync(new URL(e.name, dir));
    for (const fn of [V23, V24])
      if (t.includes(`CREATE OR REPLACE FUNCTION public.${fn}(`))
        definem.push(`${e.name}:${fn}`);
  }
  assert.deepEqual(
    definem.sort(),
    [
      `${ANTIGA}:${V23}`,
      `${ANTIGA}:${V24}`,
      `${NOME}:${V23}`,
      `${NOME}:${V24}`,
    ].sort(),
  );
});

Deno.test("o front: o mapper do pedido ja prefere a copia de customer_data.address ao endereco vivo, e o checkout de quem tem conta manda so o id (+ CPF), nunca o endereco digitado", () => {
  const mapper = Deno.readTextFileSync(
    new URL("src/lib/mappers.ts", DIR),
  ).replace(/\r\n/g, "\n");
  assert.ok(
    mapper.includes(
      '(typeof customerData.address === "object" ? customerData.address : null) ||\n    row.address ||',
    ),
    "o mapper nao prefere customer_data.address a row.address",
  );
  const checkout = Deno.readTextFileSync(
    new URL("src/views/customer/CheckoutView.tsx", DIR),
  ).replace(/\r\n/g, "\n");
  assert.ok(checkout.includes("addressId: user ? selectedAddressId : null,"));
  assert.ok(
    checkout.includes(
      "addressData: user\n        ? cpfParaRpc\n          ? { cpf: cpfParaRpc }\n          : null",
    ),
  );
});

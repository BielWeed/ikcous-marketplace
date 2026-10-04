// @ts-nocheck
// RECUSADO E RECEBIDO RECUSAM O NULO — prova offline do par
// 20261195000000 + rollback (dinheiro, 04/10/2026). A prova VIVA (as duas
// funções de verdade, no Postgres efêmero, com preflight e rollback aplicados)
// mora em tests/banco/pagamentos-rpc-viva.cjs; aqui fica o que se prova só
// lendo o texto.
//
// Cada asserção está amarrada a um risco: corpo novo que difere do vigente em
// mais do que a mudança prometida ressuscita ou apaga regra de dinheiro sem
// ninguém ter pedido (a migration copia o corpo INTEIRO); a guarda do NULL
// DEPOIS do SELECT ... FOR UPDATE faz a recusa esperar o lock de quem está
// gravando; a guarda ANTES do is_admin() deixa quem não é admin descobrir
// coisa pela mensagem; STRICT devolveria NULL em silêncio (o mesmo defeito com
// outra cara); GRANT/REVOKE repetido reabre a ACL; hash do preflight que não é
// o md5 real do corpo recusa a migration num banco CORRETO (ou aceita um corpo
// errado); rollback que não bate byte a byte deixa o defeito preso mesmo
// depois de "revertido"; e uma redefinição POSTERIOR das funções faria esta
// migration ressuscitar corpo velho.
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
const { createHash } = require("node:crypto");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const PASTA = `${DIR}../supabase/migrations`;
const NOME = "20261195000000_recusado_e_recebido_recusam_nulo.sql";
const NOME_901 = "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql";
const NOME_1020 = "20261020000000_lojista_registra_pagamento_recebido.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${PASTA}/${n}`).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration901 = ler(NOME_901);
const migration1020 = ler(NOME_1020);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

// Da assinatura até o fechamento da função — o texto da função, sem cabeçalho
// nem preflight. confirmar fecha em `$confirmar$;`; registrar, em `$$;`.
const RE_CONFIRMAR =
  /CREATE OR REPLACE FUNCTION public\.confirmar_pagamento\([\s\S]*?\n\$confirmar\$;/;
const RE_REGISTRAR =
  /CREATE OR REPLACE FUNCTION public\.registrar_pagamento_recebido\([\s\S]*?\n\$\$;/;
// O corpo (o que o Postgres grava em prosrc): entre `AS <tag>` e o fechamento.
const RE_CORPO_CONFIRMAR =
  /CREATE OR REPLACE FUNCTION public\.confirmar_pagamento\([\s\S]*?AS \$confirmar\$([\s\S]*?)\$confirmar\$;/;
const RE_CORPO_REGISTRAR =
  /CREATE OR REPLACE FUNCTION public\.registrar_pagamento_recebido\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/;

const pega = (re, sql, rotulo) => {
  const x = sql.match(re);
  assert(x, `${rotulo} não encontrada`);
  return x;
};
const confirmar = (sql) => pega(RE_CONFIRMAR, sql, "confirmar_pagamento")[0];
const registrar = (sql) =>
  pega(RE_REGISTRAR, sql, "registrar_pagamento_recebido")[0];
const corpoConfirmar = (sql) =>
  pega(RE_CORPO_CONFIRMAR, sql, "corpo de confirmar_pagamento")[1];
const corpoRegistrar = (sql) =>
  pega(RE_CORPO_REGISTRAR, sql, "corpo de registrar_pagamento_recebido")[1];

const confirmarVigente = confirmar(migration901);
const registrarVigente = registrar(migration1020);
const confirmarNova = confirmar(migration);
const registrarNova = registrar(migration);

const confirmarVigenteSC = norm(semComentarios(confirmarVigente));
const registrarVigenteSC = norm(semComentarios(registrarVigente));
const confirmarNovaSC = norm(semComentarios(confirmarNova));
const registrarNovaSC = norm(semComentarios(registrarNova));

const GUARDA_ANTIGA = "IF v_pedido.payment_status <> 'aguardando' THEN";
const GUARDA_NOVA =
  "IF v_pedido.payment_status IS DISTINCT FROM 'aguardando' THEN";
const AUTORIZACAO =
  "IF NOT public.is_admin() THEN RAISE EXCEPTION 'Não autorizado: só a loja registra pagamento recebido.'; END IF;";
const BLOCO_NULO =
  "IF p_recebido IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).'; END IF;";

Deno.test("avaliarFase0 não recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transação de nível superior", () => {
  assertEquals(detectarTransacaoExplicita(removerRuido(migration)).achados, []);
  assertEquals(detectarTransacaoExplicita(removerRuido(rollback)).achados, []);
});

Deno.test("assinatura, SECURITY DEFINER e search_path continuam os mesmos dos vigentes", () => {
  const cabecalhoConfirmar =
    "CREATE OR REPLACE FUNCTION public.confirmar_pagamento( p_order_id uuid, p_payment_id text, p_status text ) " +
    "RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $confirmar$";
  const cabecalhoRegistrar =
    "CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido( p_order_id uuid, p_recebido boolean ) " +
    "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$";
  for (const sql of [migration901, migration, rollback]) {
    assertStringIncludes(norm(sql), cabecalhoConfirmar);
  }
  for (const sql of [migration1020, migration, rollback]) {
    assertStringIncludes(norm(sql), cabecalhoRegistrar);
  }
  // Sem STRICT: STRICT devolveria NULL em silêncio para argumento NULL.
  assert(!/\bSTRICT\b/i.test(semComentarios(migration)), "STRICT presente");
  assert(!/RETURNS NULL ON NULL INPUT/i.test(semComentarios(migration)));
});

Deno.test("a migration e o rollback não repetem GRANT/REVOKE — ACL herdada do CREATE OR REPLACE", () => {
  for (const sql of [migration, rollback]) {
    const limpo = semComentarios(sql);
    assert(!/\bGRANT\b/i.test(limpo), "GRANT repetido");
    assert(!/\bREVOKE\b/i.test(limpo), "REVOKE repetido");
  }
});

Deno.test("nenhuma migration POSTERIOR redefine as duas funções (esta não ressuscita corpo velho)", () => {
  // Texto normalizado e em minúsculas: pega `CREATE FUNCTION` e `CREATE OR
  // REPLACE FUNCTION`, com ou sem `public.`, sem regex frágil.
  const definem = (nomeDaFuncao) =>
    [...Deno.readDirSync(PASTA)]
      .map((e) => e.name)
      .filter((n) => /^\d+_.*\.sql$/.test(n) && !n.startsWith("rollback-"))
      .filter((n) => {
        const texto = norm(semComentarios(ler(n))).toLowerCase();
        return (
          texto.includes(`function public.${nomeDaFuncao}(`) ||
          texto.includes(`function ${nomeDaFuncao}(`)
        );
      })
      .sort();
  assertEquals(definem("confirmar_pagamento"), [
    "20260808000000_confirmar_pagamento.sql",
    "20260810000000_confirmar_pagamento_guarda_status.sql",
    NOME_901,
    NOME,
  ]);
  // A 20261197000000 (o dinheiro exige o admin de agora) redefine
  // registrar_pagamento_recebido DEPOIS desta, de propósito: é o corpo desta
  // byte a byte + uma guarda de papel atual (provado no
  // tests/migration_dinheiro_exige_admin_atual_test.ts). Aqui basta que ela
  // não ressuscite o corpo velho: a recusa do NULL desta continua lá.
  const NOME_1197 = "20261197000000_dinheiro_exige_admin_atual.sql";
  assertEquals(definem("registrar_pagamento_recebido"), [NOME_1020, NOME, NOME_1197]);
  const recusaDoNulo =
    "    IF p_recebido IS NULL THEN\n" +
    "        RAISE EXCEPTION USING ERRCODE = '22004',\n" +
    "            MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).';\n" +
    "    END IF;\n";
  assertStringIncludes(migration, recusaDoNulo);
  assertStringIncludes(ler(NOME_1197), recusaDoNulo);
});

// --- A1: confirmar_pagamento ------------------------------------------------

Deno.test("A1: a ÚNICA diferença de confirmar_pagamento para o corpo da 20260901 é a guarda do 'recusado'", () => {
  assertEquals(
    confirmarVigenteSC.split(GUARDA_ANTIGA).length,
    2,
    "a guarda antiga tem de existir uma vez só no vigente",
  );
  assertEquals(
    confirmarNovaSC,
    confirmarVigenteSC.replace(GUARDA_ANTIGA, GUARDA_NOVA),
  );
  assert(!confirmarNovaSC.includes(GUARDA_ANTIGA), "guarda velha sobrou");
  // Comentários também intocados: o corpo todo (comentário incluso) só difere
  // na linha da guarda.
  assertEquals(
    corpoConfirmar(migration),
    corpoConfirmar(migration901).replace(GUARDA_ANTIGA, GUARDA_NOVA),
  );
});

Deno.test("A1: FOR UPDATE, divergente, estornado, pago e a guarda de 'pending' continuam no corpo novo", () => {
  for (const trecho of [
    "WHERE id = p_order_id FOR UPDATE;",
    "IF p_payment_id IS NULL OR v_pedido.gateway_payment_id IS NULL OR v_pedido.gateway_payment_id IS DISTINCT FROM p_payment_id THEN RETURN 'divergente';",
    "IF v_pedido.payment_status = 'aguardando' AND v_pedido.status = 'pending' THEN PERFORM public.devolver_estoque(p_order_id);",
    "IF v_pedido.status <> 'pending' THEN",
    "IF v_pedido.status = 'cancelled' THEN",
    "RETURN 'pago_apos_expirar';",
  ]) {
    assertStringIncludes(confirmarNovaSC, trecho);
  }
});

// --- A3: registrar_pagamento_recebido ---------------------------------------

Deno.test("A3: a ÚNICA diferença de registrar_pagamento_recebido para o corpo da 20261020 é o bloco do NULL", () => {
  assertStringIncludes(registrarVigenteSC, AUTORIZACAO);
  assertEquals(
    registrarNovaSC,
    registrarVigenteSC.replace(AUTORIZACAO, `${AUTORIZACAO} ${BLOCO_NULO}`),
  );
});

Deno.test("A3: o NULL é recusado DEPOIS da autorização e ANTES do lock e de qualquer escrita", () => {
  const codigo = registrarNovaSC;
  const iAdmin = codigo.indexOf("IF NOT public.is_admin()");
  const iNulo = codigo.indexOf("IF p_recebido IS NULL");
  const iLock = codigo.indexOf("FOR UPDATE");
  const iUpdate = codigo.indexOf("UPDATE public.marketplace_orders");
  const iInsert = codigo.indexOf("INSERT INTO");
  assert(iAdmin >= 0 && iNulo > iAdmin, "NULL antes da autorização");
  assert(iLock > iNulo, "NULL depois do SELECT ... FOR UPDATE");
  assert(iUpdate > iNulo && iInsert > iNulo, "NULL depois de uma escrita");
  assertStringIncludes(registrarNovaSC, "ERRCODE = '22004'");
  assertStringIncludes(
    registrarNovaSC,
    "MESSAGE = 'Informe se o pagamento foi recebido (true) ou desfeito (false).'",
  );
});

// --- rollback ---------------------------------------------------------------

Deno.test("o rollback restaura os dois corpos vigentes byte a byte, sem as mudanças", () => {
  assertEquals(confirmar(rollback).trimEnd(), confirmarVigente.trimEnd());
  assertEquals(registrar(rollback).trimEnd(), registrarVigente.trimEnd());
  assertEquals(
    md5(corpoConfirmar(rollback)),
    md5(corpoConfirmar(migration901)),
  );
  assertEquals(
    md5(corpoRegistrar(rollback)),
    md5(corpoRegistrar(migration1020)),
  );
  const limpo = norm(semComentarios(rollback));
  assertStringIncludes(limpo, GUARDA_ANTIGA);
  assert(!limpo.includes("IS DISTINCT FROM 'aguardando'"));
  assert(!limpo.includes("p_recebido IS NULL"));
  assert(!limpo.includes("22004"));
});

// --- preflight --------------------------------------------------------------

Deno.test("os quatro hashes do preflight são o md5 REAL dos corpos (vigentes e novos)", () => {
  const hashes = {
    confirmarVigente: md5(corpoConfirmar(migration901)),
    confirmarNovo: md5(corpoConfirmar(migration)),
    registrarVigente: md5(corpoRegistrar(migration1020)),
    registrarNovo: md5(corpoRegistrar(migration)),
  };
  for (const [nome, h] of Object.entries(hashes)) {
    assertStringIncludes(m, `'${h}'`, `hash de ${nome} fora do preflight`);
  }
  assert(hashes.confirmarVigente !== hashes.confirmarNovo);
  assert(hashes.registrarVigente !== hashes.registrarNovo);
  assertStringIncludes(m, "md5(replace(prosrc, E'\\r', ''))");
  // Hashes do preflight: exatamente estes quatro, em pares por função.
  const bloco = migration.slice(
    migration.indexOf("DO $preflight_20261195$\nDECLARE"),
    migration.indexOf("END $preflight_20261195$;"),
  );
  assertEquals((bloco.match(/'[0-9a-f]{32}'/g) || []).length, 4);
});

Deno.test("o preflight vem ANTES dos dois CREATE e recusa com B1_BASELINE_DIVERGENT", () => {
  // "DO $preflight_20261195$ DECLARE" (normalizado) só existe no BLOCO de
  // verdade — o cabeçalho cita o nome em prosa, sem DECLARE logo depois.
  const inicioPreflight = m.indexOf("DO $preflight_20261195$ DECLARE");
  const c1 = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.confirmar_pagamento(",
  );
  const c2 = m.indexOf(
    "CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido(",
  );
  assert(inicioPreflight >= 0, "bloco $preflight_20261195$ não encontrado");
  assert(
    c1 > inicioPreflight && c2 > inicioPreflight,
    "CREATE antes do preflight",
  );
  assertStringIncludes(m, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(
    m,
    "to_regprocedure('public.confirmar_pagamento(uuid,text,text)')",
  );
  assertStringIncludes(
    m,
    "to_regprocedure('public.registrar_pagamento_recebido(uuid,boolean)')",
  );
  // Um RAISE por função: o corpo divergente de QUALQUER uma recusa.
  assertEquals(
    (migration.match(/RAISE EXCEPTION 'B1_BASELINE_DIVERGENT/g) || []).length,
    2,
  );
});

Deno.test("o preflight não abre nem fecha transação (é um DO block, não BEGIN/COMMIT)", () => {
  const abertura = "DO $preflight_20261195$\nDECLARE";
  const fechamento = "END $preflight_20261195$;";
  const ini = migration.indexOf(abertura);
  const fim = migration.indexOf(fechamento, ini);
  assert(ini >= 0, "bloco real do preflight não encontrado");
  assert(fim > ini, "fechamento do preflight não encontrado");
  const trecho = migration.slice(ini, fim + fechamento.length);
  assertEquals(detectarTransacaoExplicita(removerRuido(trecho)).achados, []);
});

Deno.test("o cabeçalho declara dados existentes, idempotência, ordem, como aplicar, ficha e rollback", () => {
  const cabecalho = migration.slice(
    0,
    migration.indexOf("DO $preflight_20261195$\nDECLARE"),
  );
  for (const termo of [
    "DADOS EXISTENTES",
    "IDEMPOTÊNCIA",
    "ORDEM DE APLICAÇÃO",
    "20261192000000",
    "COMO APLICAR",
    "aplicar-migrations.yml",
    "FICHA DE VERIFICAÇÃO",
    "ROLLBACK MANUAL",
    "rollback-manual-20261195000000_recusado_e_recebido_recusam_nulo.sql",
    "NÃO é STRICT",
  ]) {
    assertStringIncludes(cabecalho, termo);
  }
});

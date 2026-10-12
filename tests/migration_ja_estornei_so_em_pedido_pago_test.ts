// @ts-nocheck
// "JÁ ESTORNEI" SÓ EM PEDIDO PAGO — prova offline do par 20261194000000 +
// rollback (dinheiro, 04/10/2026). O COMPORTAMENTO da recusa contra o banco
// (aguardando -> 22023; pago, pago_apos_expirar e recebido_na_entrega -> ok)
// é provado em tests/banco/financeiro-viva.cjs, no rpc-ci (Postgres efêmero,
// migrations do zero); aqui fica o que se prova só lendo o texto, no
// `npm run test:unit`.
//
// Cada asserção está amarrada a um risco: guarda ausente deixa o admin
// marcar estornado um pedido com PIX aberto e o pagamento que chega depois
// cai em 'ignorado' no confirmar_pagamento e some sem alerta; lista de
// status sem `recebido_na_entrega` trava a devolução do dinheiro em espécie
// (balcão e entrega); guarda DEPOIS de alguma escrita grava pela metade;
// guarda antes do "já estornado" quebra o clique repetido (idempotência);
// corpo que não é o da 20261189 + a guarda apaga em silêncio a trava da
// corrida com o cron; rollback que não volta byte a byte deixa a regra
// presa depois de "revertida"; hash de preflight que não é o md5 real recusa
// a migration num banco CORRETO (ou aceita corpo errado); e a recusa com
// outro SQLSTATE vira "Tente de novo" no painel.
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
const NOME = "20261194000000_ja_estornei_so_em_pedido_pago.sql";
const NOME_89 = "20261189000000_ja_estornei_fecha_a_corrida_com_o_cron.sql";

const lerArquivo = (rel) =>
  Deno.readTextFileSync(`${DIR}../${rel}`).replace(/\r\n/g, "\n");
const ler = (n) => lerArquivo(`supabase/migrations/${n}`);
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration89 = ler(NOME_89);

const norm = (s) => s.replace(/\s+/g, " ").trim();

const MARCADOR =
  "\nCREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid)";
// Da assinatura até o fechamento `$$;` — o texto da função.
const funcao = (sql) => {
  const i = sql.indexOf(MARCADOR);
  assert(i >= 0, "registrar_estorno_manual não encontrada");
  assertEquals(
    sql.indexOf(MARCADOR, i + 1),
    -1,
    "registrar_estorno_manual aparece 2x",
  );
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
};
// O corpo (o que o Postgres grava em prosrc): entre `AS $$` e `$$;`.
const corpo = (sql) => {
  const f = funcao(sql);
  return f.slice(f.indexOf("AS $$") + "AS $$".length, f.length - "$$;".length);
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");

// A guarda inteira (comentário + IF ... END IF;), exatamente como entra no
// corpo, com a linha em branco que a separa da releitura. Tirar ESTE bloco do
// corpo novo tem de devolver o corpo da 20261189.
const INICIO_GUARDA =
  "        -- Dinheiro que não entrou não se devolve (20261194).";
const FIM_GUARDA =
  "                USING ERRCODE = '22023';\n        END IF;\n\n";
const guarda = (() => {
  const f = funcao(migration);
  const i = f.indexOf(INICIO_GUARDA);
  assert(i >= 0, "a guarda de pagamento não está no corpo novo");
  const fim = f.indexOf(FIM_GUARDA, i);
  assert(fim > i, "a guarda não fecha com RAISE ... 22023 / END IF");
  return f.slice(i, fim + FIM_GUARDA.length);
})();
const codigoNovo = norm(semComentarios(funcao(migration)));

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

Deno.test("o ponto de partida é a 20261189: é a última definição de registrar_estorno_manual ANTES desta", () => {
  const nomes = [...Deno.readDirSync(`${DIR}../supabase/migrations`)]
    .filter((e) => e.isFile && /^\d+_.*\.sql$/.test(e.name))
    .map((e) => e.name)
    .filter(
      (n) =>
        n < NOME &&
        ler(n).includes("FUNCTION public.registrar_estorno_manual("),
    )
    .sort();
  assertEquals(nomes.at(-1), NOME_89);
});

Deno.test("assinatura, RETURNS, SECURITY DEFINER e search_path iguais aos da 20261189", () => {
  const cabecalho = (sql) =>
    norm(funcao(sql).slice(0, funcao(sql).indexOf("AS $$") + "AS $$".length));
  const esperado =
    "CREATE OR REPLACE FUNCTION public.registrar_estorno_manual(p_order_id uuid) " +
    "RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$";
  assertEquals(cabecalho(migration89), esperado);
  assertEquals(cabecalho(migration), esperado);
  assertEquals(cabecalho(rollback), esperado);
});

Deno.test("a migration e o rollback não repetem GRANT/REVOKE nem COMMENT — ACL e metadado herdados do CREATE OR REPLACE", () => {
  for (const sql of [migration, rollback]) {
    const limpo = semComentarios(sql);
    assert(!/\bGRANT\b/i.test(limpo), "GRANT repetido");
    assert(!/\bREVOKE\b/i.test(limpo), "REVOKE repetido");
    assert(!/\bCOMMENT\s+ON\b/i.test(limpo), "COMMENT ON novo");
  }
});

Deno.test("o corpo novo é o da 20261189 byte a byte + UMA guarda (nada mais muda)", () => {
  assertEquals(funcao(migration).replace(guarda, ""), funcao(migration89));
  assertEquals(
    funcao(migration).split(INICIO_GUARDA).length - 1,
    1,
    "a guarda entra uma vez só",
  );
});

Deno.test("a guarda: só pago, pago_apos_expirar e recebido_na_entrega passam; NULL e o resto recusam com 22023", () => {
  const g = norm(semComentarios(guarda));
  assertEquals(
    g,
    "IF NOT EXISTS ( SELECT 1 FROM public.marketplace_orders pedido " +
      "WHERE pedido.id = p_order_id " +
      "AND pedido.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega') ) " +
      "THEN RAISE EXCEPTION 'Este pedido não tem pagamento confirmado: não há dinheiro a devolver. " +
      "Registrar o estorno agora esconderia um pagamento que ainda pode chegar.' " +
      "USING ERRCODE = '22023'; END IF;",
  );
  // Nenhum dos três status aceitos pode sumir da lista (balcão/entrega em
  // espécie é `recebido_na_entrega`).
  for (const s of ["'pago'", "'pago_apos_expirar'", "'recebido_na_entrega'"])
    assertStringIncludes(g, s);
  // `NOT EXISTS` sobre a linha: payment_status NULL não casa o IN e RECUSA
  // (um `IF v NOT IN (...)` com v NULL avaliaria NULL e deixaria passar).
  assertStringIncludes(g, "IF NOT EXISTS (");
  // O apelido `pedido` não pode ser sombreado por variável PL/pgSQL.
  assert(
    !/\bpedido\b/.test(
      funcao(migration).slice(
        funcao(migration).indexOf("DECLARE"),
        funcao(migration).indexOf("BEGIN"),
      ),
    ),
    "variável chamada `pedido` sombrearia o apelido",
  );
});

Deno.test("a guarda vem DEPOIS do 'já estornado' (clique repetido segue ok) e ANTES de qualquer trava do ledger ou escrita", () => {
  const c = codigoNovo;
  const iTravaPedido = c.indexOf(
    "FROM public.marketplace_orders o WHERE o.id = p_order_id FOR UPDATE OF o;",
  );
  const iNaoEncontrado = c.indexOf(
    "RAISE EXCEPTION 'pedido nao encontrado' USING ERRCODE = 'P0002';",
  );
  const iJaEstornado = c.indexOf("IF NOT v_ja_estornado THEN");
  const iGuarda = c.indexOf(
    "IF NOT EXISTS ( SELECT 1 FROM public.marketplace_orders pedido",
  );
  const iReleitura = c.indexOf("FROM public.order_refunds releitura");
  const iEscritaLedger = c.indexOf("UPDATE public.order_refunds r");
  const iEscritaPedido = c.indexOf(
    "UPDATE public.marketplace_orders SET payment_status = 'estornado'",
  );
  assert(
    iTravaPedido >= 0 &&
      iNaoEncontrado > iTravaPedido &&
      iJaEstornado > iNaoEncontrado &&
      iGuarda > iJaEstornado &&
      iReleitura > iGuarda &&
      iEscritaLedger > iReleitura &&
      iEscritaPedido > iEscritaLedger,
    `ordem: ${[iTravaPedido, iNaoEncontrado, iJaEstornado, iGuarda, iReleitura, iEscritaLedger, iEscritaPedido]}`,
  );
  // Continua: pedido já estornado devolve ok sem passar pela guarda.
  assertStringIncludes(
    c,
    "RETURN json_build_object('ok'::text, true, 'payment_status'::text, 'estornado');",
  );
});

Deno.test("o rollback restaura o TEXTO da função da 20261189 byte a byte", () => {
  assertEquals(funcao(rollback), funcao(migration89));
  assertEquals(md5(corpo(rollback)), md5(corpo(migration89)));
  assert(
    !corpo(rollback).includes(INICIO_GUARDA.trim()),
    "o rollback ainda tem a guarda",
  );
});

Deno.test("os hashes dos preflights são o md5 REAL dos corpos (20261189 e desta migration)", () => {
  const hashAntigo = md5(corpo(migration89));
  const hashNovo = md5(corpo(migration));
  // O mesmo hash que a própria 20261189 declara como o corpo que ELA deixa.
  assertEquals(hashAntigo, "3632b8b804ecf913bd849879212ff1ba");
  assert(hashAntigo !== hashNovo, "a migration precisa mudar o corpo");
  const preflight = migration.slice(0, migration.indexOf(MARCADOR));
  assertStringIncludes(preflight, `'${hashAntigo}'`);
  assertStringIncludes(preflight, `'${hashNovo}'`);
  assertStringIncludes(preflight, "md5(replace(prosrc, E'\\r', ''))");
  const preflightRollback = rollback.slice(0, rollback.indexOf(MARCADOR));
  assertStringIncludes(preflightRollback, `IS DISTINCT FROM '${hashNovo}'`);
  assert(
    !preflightRollback.includes(`'${hashAntigo}'`),
    "o rollback só desfaz o corpo NOVO",
  );
  assertStringIncludes(preflightRollback, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("os preflights vêm ANTES do CREATE, apontam para a função certa e recusam com B1_BASELINE_DIVERGENT", () => {
  for (const [sql, bloco] of [
    [migration, "DO $preflight_20261194$\nDECLARE"],
    [rollback, "DO $preflight_rollback_20261194$\nDECLARE"],
  ]) {
    const ini = sql.indexOf(bloco);
    const create = sql.indexOf(MARCADOR);
    assert(ini >= 0 && create > ini, `${bloco} precisa vir antes do CREATE`);
    const trecho = sql.slice(ini, create);
    assertStringIncludes(
      trecho,
      "to_regprocedure('public.registrar_estorno_manual(uuid)')",
    );
    assertStringIncludes(
      trecho,
      "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT: corpo vivo de registrar_estorno_manual (hash %)",
    );
    assert(
      !/RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i.test(trecho),
      "preflight que só avisa não recusa",
    );
    assertEquals(detectarTransacaoExplicita(removerRuido(trecho)).achados, []);
  }
});

Deno.test("contrato com o painel: recusa 22023 do 'Já estornei' mostra o TEXTO do servidor ao lojista", () => {
  const tela = norm(lerArquivo("src/views/admin/AdminOrdersView.tsx"));
  assertStringIncludes(
    tela,
    'supabase.rpc("registrar_estorno_manual", { p_order_id: pedido.id, });',
  );
  assertStringIncludes(
    tela,
    '(error as { code?: string }).code === "22023" && typeof error.message === "string" && error.message.trim() !== "" ) { console.error("Estorno manual recusado pelo servidor:", error); toast.error(error.message);',
  );
});

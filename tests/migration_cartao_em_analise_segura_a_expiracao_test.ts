// @ts-nocheck
// O CARTÃO EM ANÁLISE SEGURA A EXPIRAÇÃO — prova offline do par
// 20261186000000 + rollback (dinheiro, 02/10/2026). A prova VIVA (a varredura
// de verdade, no Postgres efêmero) mora em tests/banco/cartao-online-viva.cjs,
// e a prova do comportamento da função em Postgres real (PGlite) foi feita à
// parte; aqui fica o que se prova só lendo o texto.
//
// Cada asserção está amarrada a um risco: predicado ausente devolve o estoque
// e cancela um pedido cujo cartão o banco ainda pode aprovar (dinheiro entra
// sem pedido); predicado que deixa o PIX entrar na exceção segura estoque de
// venda que ninguém vai pagar (e quebra o PIX do balcão, que depende da
// expiração para devolver a reserva); NOT de NULL faz o pedido sem
// `metodo_online` sumir da varredura para sempre; teto diferente da janela da
// reconciliação deixa o pedido preso sem ninguém olhando; hash do preflight
// que não é o md5 real do corpo recusa a migration num banco CORRETO (ou
// aceita um corpo errado); rollback que não bate byte a byte com o corpo da
// 20260901 deixa a exceção presa mesmo depois de "revertida".
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
const NOME = "20261186000000_cartao_em_analise_segura_a_expiracao.sql";
const NOME_901 = "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql";
const NOME_RECONCILIACAO =
  "20261010000000_reconciliacao_alcanca_o_pedido_vivo.sql";

const ler = (n) =>
  Deno.readTextFileSync(`${DIR}../supabase/migrations/${n}`).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migration901 = ler(NOME_901);
const migrationReconciliacao = ler(NOME_RECONCILIACAO);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const m = norm(migration);
const r = norm(rollback);

const MARCADOR = "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()";
// Da assinatura até o fechamento `$expirar$;` — o texto da função, sem
// cabeçalho nem preflight.
const RE_FUNCAO =
  /CREATE OR REPLACE FUNCTION public\.expirar_pedidos_vencidos\(\)[\s\S]*?\n\$expirar\$;/;
// O corpo (o que o Postgres grava em prosrc): entre `AS $expirar$` e o
// fechamento — começa em "\n" e termina em "END;\n".
const RE_CORPO =
  /CREATE OR REPLACE FUNCTION public\.expirar_pedidos_vencidos\(\)[\s\S]*?AS \$expirar\$([\s\S]*?)\$expirar\$;/;

const funcao = (sql) => {
  const x = sql.match(RE_FUNCAO);
  assert(x, "expirar_pedidos_vencidos não encontrada");
  return x[0];
};
const corpo = (sql) => {
  const x = sql.match(RE_CORPO);
  assert(x, "corpo de expirar_pedidos_vencidos não encontrado");
  return x[1];
};
const md5 = (s) => createHash("md5").update(s).digest("hex");
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

const funcaoNova = funcao(migration);
const funcaoNovaSemComentarios = norm(semComentarios(funcaoNova));

// O predicado novo, exatamente como deve aparecer (normalizado).
const PREDICADO =
  "AND ( expires_at <= now() - interval '24 hours' OR NOT COALESCE( gateway_payment_id LIKE 'verificando:%' OR ( gateway_payment_id IS NOT NULL AND metodo_online IN ('credito', 'debito') ), false ) )";

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

Deno.test("assinatura, SECURITY DEFINER e search_path continuam os mesmos da 20260901", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos() " +
    "RETURNS integer LANGUAGE plpgsql SECURITY DEFINER " +
    "SET search_path TO 'public' AS $expirar$";
  assertStringIncludes(norm(funcao(migration901)), cabecalho);
  assertStringIncludes(m, cabecalho);
  assertStringIncludes(r, cabecalho);
});

Deno.test("a migration e o rollback não repetem GRANT/REVOKE — ACL herdada do CREATE OR REPLACE", () => {
  for (const sql of [migration, rollback]) {
    const limpo = semComentarios(sql);
    assert(!/\bGRANT\b/i.test(limpo), "GRANT repetido");
    assert(!/\bREVOKE\b/i.test(limpo), "REVOKE repetido");
  }
});

Deno.test("o predicado novo existe, entre a exigência de vencido e o FOR UPDATE SKIP LOCKED", () => {
  assertStringIncludes(funcaoNovaSemComentarios, PREDICADO);
  const i = funcaoNovaSemComentarios.indexOf("AND expires_at < now()");
  const j = funcaoNovaSemComentarios.indexOf(PREDICADO);
  const k = funcaoNovaSemComentarios.indexOf("FOR UPDATE SKIP LOCKED");
  assert(i >= 0 && j > i && k > j, "ordem: vencido, predicado, SKIP LOCKED");
});

Deno.test("a ÚNICA diferença para o corpo da 20260901 é o predicado (o resto do código é idêntico)", () => {
  const antigaSemComentarios = norm(semComentarios(funcao(migration901)));
  const alvo = "AND expires_at < now() FOR UPDATE SKIP LOCKED";
  assertStringIncludes(antigaSemComentarios, alvo);
  const esperada = antigaSemComentarios.replace(
    alvo,
    `AND expires_at < now() ${PREDICADO} FOR UPDATE SKIP LOCKED`,
  );
  assertEquals(funcaoNovaSemComentarios, esperada);
});

Deno.test("o predicado é seguro com NULL: o COALESCE embrulha o teste inteiro (PIX, sem vaga e vaga liberada expiram sempre)", () => {
  // NOT de NULL é NULL e a linha SUMIRIA da varredura. O COALESCE(..., false)
  // transforma 'metodo_online NULL' em "não é cartão vivo" -> expira.
  assertStringIncludes(
    funcaoNovaSemComentarios,
    "NOT COALESCE( gateway_payment_id LIKE 'verificando:%' OR ( gateway_payment_id IS NOT NULL AND metodo_online IN ('credito', 'debito') ), false )",
  );
});

Deno.test("'pix' fica fora da exceção — o PIX do balcão continua expirando e devolvendo a reserva", () => {
  const codigo = funcaoNovaSemComentarios;
  assert(!/'pix'/i.test(codigo), "o literal 'pix' não pode aparecer no código");
  assert(!codigo.includes("'credito', 'debito', 'pix'"));
  assertStringIncludes(codigo, "metodo_online IN ('credito', 'debito')");
});

Deno.test("o teto é a MESMA janela de 24 h de pagamentos_a_reconciliar", () => {
  const rec = migrationReconciliacao.match(
    /FUNCTION public\.pagamentos_a_reconciliar\(\)[\s\S]*?AND expires_at > now\(\) - (interval '[^']+')/,
  );
  assert(rec, "janela de pagamentos_a_reconciliar não encontrada na 20261010");
  const intervaloReconciliacao = rec[1];
  assertEquals(intervaloReconciliacao, "interval '24 hours'");
  assertStringIncludes(
    funcaoNovaSemComentarios,
    `expires_at <= now() - ${intervaloReconciliacao}`,
  );
});

Deno.test("o rollback restaura o corpo da 20260901 byte a byte, sem a exceção", () => {
  const antiga = funcao(migration901);
  const iniRollback = rollback.indexOf(MARCADOR);
  assert(iniRollback >= 0, "função não encontrada no rollback");
  const funcaoRollback = rollback.slice(iniRollback).trimEnd();
  assertEquals(
    funcaoRollback,
    antiga.trimEnd(),
    "o rollback precisa restaurar o MESMO texto que a 20260901 deixou",
  );
  assert(!funcaoRollback.includes("verificando:"));
  assert(!funcaoRollback.includes("metodo_online"));
  assertEquals(md5(corpo(rollback)), md5(corpo(migration901)));
});

Deno.test("os hashes do preflight são o md5 REAL dos corpos (o da 20260901 e o desta migration)", () => {
  const hashAntigo = md5(corpo(migration901));
  const hashNovo = md5(corpo(migration));
  assertStringIncludes(m, `'${hashAntigo}'`);
  assertStringIncludes(m, `'${hashNovo}'`);
  assert(hashAntigo !== hashNovo, "a migration precisa mudar o corpo");
  assertStringIncludes(m, "md5(replace(prosrc, E'\\r', ''))");
});

Deno.test("o preflight vem ANTES do CREATE e recusa com B1_BASELINE_DIVERGENT", () => {
  // "DO $preflight_20261186$ DECLARE" (normalizado) só existe no BLOCO de
  // verdade — o cabeçalho cita o nome em prosa, sem DECLARE logo depois.
  const inicioPreflight = m.indexOf("DO $preflight_20261186$ DECLARE");
  const inicioCreate = m.indexOf(MARCADOR);
  assert(inicioPreflight >= 0, "bloco $preflight_20261186$ não encontrado");
  assert(inicioCreate >= 0, "CREATE não encontrado");
  assert(
    inicioPreflight < inicioCreate,
    "o preflight precisa vir ANTES do CREATE OR REPLACE FUNCTION",
  );
  assertStringIncludes(m, "column_name = 'metodo_online'");
  assertStringIncludes(m, "B1_BASELINE_DIVERGENT");
  assertStringIncludes(
    m,
    "to_regprocedure('public.expirar_pedidos_vencidos()')",
  );
});

Deno.test("o preflight não abre nem fecha transação (é um DO block, não BEGIN/COMMIT)", () => {
  const abertura = "DO $preflight_20261186$\nDECLARE";
  const fechamento = "END $preflight_20261186$;";
  const ini = migration.indexOf(abertura);
  const fim = migration.indexOf(fechamento, ini);
  assert(ini >= 0, "bloco real do preflight não encontrado");
  assert(fim > ini, "fechamento do preflight não encontrado");
  const trecho = migration.slice(ini, fim + fechamento.length);
  assertEquals(detectarTransacaoExplicita(removerRuido(trecho)).achados, []);
});

Deno.test("o cabeçalho declara a ordem de aplicação e o teto de 24 h", () => {
  const cabecalho = migration.slice(
    0,
    migration.indexOf("DO $preflight_20261186$\nDECLARE"),
  );
  assertStringIncludes(cabecalho, "20261176000000");
  assertStringIncludes(cabecalho, "independente");
  assertStringIncludes(cabecalho, "24 h");
  assertStringIncludes(cabecalho, "20261184");
});

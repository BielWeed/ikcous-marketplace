// @ts-nocheck
// REPETIR A DEVOLUCAO QUE FALHOU NAO PAGA DUAS VEZES — prova offline do par 20261399991000 + rollback (DINHEIRO).
// O COMPORTAMENTO (controle com o caminho antigo, duas conexoes reais na mesma falhada, bordas, permissao, mutantes, reaplicar, pre-voo,
// rollback que recusa com marca, conexao sem BEGIN e consultas 143a/143b) e' provado em
// tests/banco/repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so CRIA (a tabela order_refund_repeticao e a funcao solicitar_estorno_repetindo; nenhum DROP, nenhum DML, nenhum
// corpo existente muda); a funcao e' SECURITY DEFINER com EXECUTE so do authenticated; o valor sai da linha falhada e nunca do chamador; a
// checagem "ja repetida" vem DEPOIS das travas (ordem global: linhas do pedido por id, depois o pedido); o front chama a funcao nova.
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
const NOME =
  "20261399991000_repetir_a_devolucao_que_falhou_nao_paga_duas_vezes.sql";
const A =
  "143a-conferir-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-aplicado";
const B =
  "143b-antes-repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-ausente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_FUNCAO = "018d9480bacfc4776b6f3424d303a3ee";
const H_PODE_TER_SAIDO = "bdbb28b3d91588c8b10283d57bfb73d6";
const H_SALDO = "99741b4cdbf1e8d8340f80440e6da094";

function corpoDaFuncao(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(";
  assert.equal(sql.split(marca).length - 1, 1);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}

Deno.test("1399991: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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
  for (const sql of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf("DO $preflight"));
  }
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1399991: a migration so CRIA — nenhum DROP, nenhum UPDATE/DELETE, nenhum corpo existente redefinido; uma tabela e uma funcao novas", () => {
  const codigo = limpo(migration);
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  // (o ON DELETE CASCADE das chaves estrangeiras da tabela nova nao e DML)
  assert.doesNotMatch(
    codigo.replace(/ON DELETE CASCADE/g, ""),
    /\b(UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(codigo, /\bCREATE\s+(POLICY|INDEX)\b/i);
  assert.equal(
    (codigo.match(/\bCREATE OR REPLACE FUNCTION\b/g) ?? []).length,
    1,
    "uma so funcao: a nova",
  );
  assert.equal((codigo.match(/\bCREATE TABLE\b/g) ?? []).length, 1);
  assert.ok(
    migration.includes(
      "CREATE TABLE IF NOT EXISTS public.order_refund_repeticao (",
    ),
  );
  // o unico ALTER e' o que liga a RLS da tabela nova
  assert.deepEqual(migration.match(/^ALTER .*$/gm), [
    "ALTER TABLE public.order_refund_repeticao ENABLE ROW LEVEL SECURITY;",
  ]);
  // INSERT so dentro do corpo da funcao nova (nenhum dado e escrito ao aplicar)
  const semFuncao = migration.replace(corpoDaFuncao(migration), "");
  assert.doesNotMatch(limpo(semFuncao), /\bINSERT\s+INTO\b/i);
  // as chaves: PK em refund_id, UNIQUE em nova_refund_id, CASCADE nas duas, linhas diferentes
  assert.ok(
    migration.includes(
      "refund_id uuid PRIMARY KEY REFERENCES public.order_refunds (id) ON DELETE CASCADE",
    ),
  );
  assert.ok(
    migration.includes(
      "nova_refund_id uuid NOT NULL UNIQUE REFERENCES public.order_refunds (id) ON DELETE CASCADE",
    ),
  );
  assert.ok(migration.includes("CHECK (refund_id <> nova_refund_id)"));
  // a tabela e a funcao ficam FECHADAS: so o authenticated executa a funcao, ninguem toca a tabela
  assert.deepEqual(migration.match(/^(REVOKE|GRANT) .*$/gm), [
    "REVOKE ALL ON TABLE public.order_refund_repeticao FROM PUBLIC, anon, authenticated, service_role;",
    "REVOKE ALL ON FUNCTION public.solicitar_estorno_repetindo(uuid, text) FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION public.solicitar_estorno_repetindo(uuid, text) TO authenticated;",
  ]);
});

Deno.test("1399991: a funcao e' SECURITY DEFINER com search_path fixo; md5 conhecido citado no pre-voo, na conferencia, no rollback e na 143a; dependencias com o md5 da 20261241000000", () => {
  const corpo = corpoDaFuncao(migration);
  assert.equal(md5(corpo), H_FUNCAO);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE FUNCTION public.solicitar_estorno_repetindo(\n    p_refund_id uuid,\n    p_motivo text\n)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$",
    ),
  );
  assert.equal(
    migration.split(`'${H_FUNCAO}'`).length - 1,
    2,
    "pre-voo e conferencia",
  );
  assert.ok(rollback.includes(`'${H_FUNCAO}'`));
  assert.ok(
    lerRepo(`scripts/publicacao/consultas/${A}.sql`).includes(`'${H_FUNCAO}'`),
  );
  // as funcoes que o corpo chama: o pre-voo exige o corpo da 20261241000000 (e a 143b o confere)
  for (const h of [H_PODE_TER_SAIDO, H_SALDO]) {
    assert.ok(migration.includes(`'${h}'`), h);
    assert.ok(
      lerRepo(`scripts/publicacao/consultas/${B}.sql`).includes(`'${h}'`),
      h,
    );
  }
  const m241 = ler("20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql");
  assert.ok(m241.includes(H_PODE_TER_SAIDO) && m241.includes(H_SALDO));
});

Deno.test("1399991: a ORDEM do corpo — as duas portas de admin primeiro; as travas (linhas por id, depois o pedido) ANTES de ler 'ja repetida'; as recusas antes do saldo; o valor vem da linha", () => {
  const corpo = corpoDaFuncao(migration);
  const pos = (t) => {
    assert.equal(corpo.split(t).length - 1, 1, `${t} deve aparecer uma vez`);
    return corpo.indexOf(t);
  };
  const admin = pos("IF NOT public.is_admin() THEN");
  const adminAtual = pos("IF NOT public.is_admin_atual() THEN");
  const travaLinhas = pos("ORDER BY r.id\n        FOR UPDATE;");
  const travaPedido = pos("WHERE id = v_order_id\n       FOR UPDATE;");
  const releitura = pos(
    "SELECT * INTO v_r FROM public.order_refunds WHERE id = p_refund_id;",
  );
  const jaRepetida = pos(
    "FROM public.order_refund_repeticao\n     WHERE refund_id = p_refund_id;",
  );
  const sistema = pos("IF v_r.solicitado_por = 'sistema' THEN");
  const concluido = pos("IF v_r.status = 'concluido' THEN");
  const andamento = pos(
    "IF v_r.status IN ('solicitado', 'em_processamento') THEN",
  );
  const devolucao = pos(
    "IF EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.refund_id = v_r.id) THEN",
  );
  const marcas = pos(
    "pv.substituida_por_manual_em IS NOT NULL OR pv.por_fora_liberado_em IS NOT NULL",
  );
  const podeTerSaido = pos(
    "IF public.order_refund__pode_ter_saido(v_r.id) THEN",
  );
  const pago = pos(
    "OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN",
  );
  const cancelado = pos("IF v_status IS DISTINCT FROM 'cancelled' THEN");
  const voltou = pos(
    "IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN",
  );
  const saldoConta = pos(
    "v_saldo := public.pedido__saldo_a_estornar(v_order_id);",
  );
  const saldoRecusa = pos("IF v_r.amount > v_saldo THEN");
  const insere = pos(
    "INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por)",
  );
  const marca = pos(
    "INSERT INTO public.order_refund_repeticao (refund_id, nova_refund_id)",
  );
  const ordem = [
    admin,
    adminAtual,
    travaLinhas,
    travaPedido,
    releitura,
    jaRepetida,
    sistema,
    concluido,
    andamento,
    devolucao,
    marcas,
    podeTerSaido,
    pago,
    cancelado,
    voltou,
    saldoConta,
    saldoRecusa,
    insere,
    marca,
  ];
  assert.deepEqual(
    [...ordem].sort((a, b) => a - b),
    ordem,
    "a ordem do corpo mudou",
  );
  // o valor sai da linha falhada, nunca do chamador (a funcao nem recebe valor)
  assert.ok(corpo.includes("VALUES (v_order_id, v_r.amount,"));
  assert.doesNotMatch(corpo, /p_amount/);
  // a nova linha nasce 'lojista' e a marca liga as duas
  assert.ok(corpo.includes("'lojista')\n    RETURNING id INTO v_nova;"));
  // a resposta diz se foi repeticao nova ou a que ja existia
  assert.ok(corpo.includes("'ja_repetida', true"));
  assert.ok(corpo.includes("'ja_repetida', false"));
});

Deno.test("1399991: o rollback apaga so a funcao e a tabela NOVAS, RECUSA com marca, com pre-voo antes de apagar e a conferencia final", () => {
  assert.ok(
    rollback.includes(
      "DROP FUNCTION IF EXISTS public.solicitar_estorno_repetindo(uuid, text);",
    ),
  );
  assert.ok(
    rollback.includes("DROP TABLE IF EXISTS public.order_refund_repeticao;"),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 2);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399991000$");
  const iApaga = rollback.indexOf("\nDROP FUNCTION IF EXISTS");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399991000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  const pre = rollback.slice(iPre, iApaga);
  assert.ok(pre.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(pre.includes("v_marcas > 0"), "recusa se a tabela tiver marca");
  assert.ok(pre.includes("SELECT count(*) FROM public.order_refund_repeticao"));
});

Deno.test("1399991: o front chama a funcao nova no 'Tentar de novo' (com o id da linha) e o hook troca a RPC por ela", () => {
  const hook = lerRepo("src/hooks/useEstornosDoPedido.ts");
  assert.ok(hook.includes('"solicitar_estorno_repetindo"'));
  assert.ok(hook.includes("p_refund_id"));
  const card = lerRepo("src/components/admin/orders/EstornoCard.tsx");
  assert.ok(card.includes("pedirConfirmacaoEEnviar(linha.amount, linha.id)"));
  assert.ok(hook.includes("repetindo"));
  assert.doesNotMatch(card, /pedirConfirmacaoEEnviar\(linha\.amount\)/);
});

Deno.test("1399991: publicacao — lote unico (143a/143b), rol fechado, consultas so de catalogo, workflows, release, aplicador, portas e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261399991000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261399991000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [nome, itens] of [
    [A, 5],
    [B, 4],
  ]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+public\.(order_refunds|order_refund_repeticao|devolucoes|marketplace_orders)\b/i,
      "so catalogo: nao le dado de cliente",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, itens, nome);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
    assert.ok(
      lerRepo("scripts/frota/publicar-release.mjs").includes(`"${nome}"`),
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}\n`,
      ),
    );
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(`consultas/${nome}.sql`)
        .length - 1,
      2,
    );
  }
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "repetir-a-devolucao-que-falhou-nao-paga-duas-vezes-viva.cjs",
    ),
  );
  // a funcao nova e' porta do logado, registrada nas portas permitidas (EXECUTE so do authenticated)
  const portas = JSON.parse(
    lerRepo("tests/banco/portas-do-visitante-permitidas.json"),
  );
  const porta = portas.funcoes.filter((f) =>
    f.funcao.startsWith("public.solicitar_estorno_repetindo("),
  );
  assert.equal(porta.length, 1);
  assert.deepEqual(porta[0].executa, ["authenticated"]);
  assert.equal(porta[0].secdef, true);
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "solicitar_estorno_repetindo");
  const corpo = corpoDaFuncao(migration);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(corpo.split(texto).length - 1, vezes, texto);
});

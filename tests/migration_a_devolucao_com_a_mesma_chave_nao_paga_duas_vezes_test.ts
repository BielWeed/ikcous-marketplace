// @ts-nocheck
// A DEVOLUCAO COM A MESMA CHAVE NAO PAGA DUAS VEZES — prova offline do par 20261640000000 + rollbacks (DINHEIRO).
// O COMPORTAMENTO (controle com o caminho antigo, duas conexoes reais no mesmo pedido e em pedidos diferentes, bordas, permissao,
// mutantes, reaplicar, pre-voo, rollback comum que mantem as chaves, destrutivo so com o dono, conexao sem BEGIN, dado de antes e
// consultas 200a/200b) e' provado em tests/banco/a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva.cjs. Aqui fica o que se
// prova so lendo o texto.
//
// Riscos: a migration so CRIA (a coluna anulavel sem padrao, o indice unico parcial e a funcao nova; nenhum DROP, nenhum DML, nenhum
// corpo existente muda; solicitar_estorno fica como esta); a funcao e' SECURITY DEFINER com EXECUTE so do authenticated; a chave e'
// lida DEPOIS da trava do pedido e ANTES das recusas; a linha nasce com a chave; o front chama a funcao nova com a chave da intencao.
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
  "20261640000000_a_devolucao_com_a_mesma_chave_nao_paga_duas_vezes.sql";
const A =
  "200a-conferir-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-aplicado";
const B =
  "200b-antes-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-ausente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const destrutivo = ler(`rollback-manual-destrutivo-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_FUNCAO = "2021a69d46d49d227e4f1f206eb8df02";
const H_SALDO = "99741b4cdbf1e8d8340f80440e6da094";
const DEF_INDICE =
  "CREATE UNIQUE INDEX uq_order_refunds_chave_da_solicitacao ON public.order_refunds USING btree (chave_da_solicitacao) WHERE (chave_da_solicitacao IS NOT NULL)";

function corpoDaFuncao(sql) {
  const marca =
    "CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(";
  assert.equal(sql.split(marca).length - 1, 1);
  const ini = sql.indexOf(marca);
  const abre = sql.indexOf("AS $function$", ini) + "AS $function$".length;
  return sql.slice(abre, sql.indexOf("$function$;", abre));
}

Deno.test("1640: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT nos tres arquivos; LF; lock_timeout antes de tudo", () => {
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
  for (const [sql, primeiroDo] of [
    [migration, "DO $preflight"],
    [rollback, "DO $preflight"],
    [destrutivo, "DO $destrutivo"],
  ]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf(primeiroDo));
  }
  for (const n of [
    NOME,
    `rollback-manual-${NOME}`,
    `rollback-manual-destrutivo-${NOME}`,
  ])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1640: a migration so CRIA — nenhum DROP, nenhum DML fora do corpo, nenhum corpo existente redefinido; coluna anulavel SEM padrao, indice parcial e uma funcao nova", () => {
  const codigo = limpo(migration);
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  const semFuncao = migration.replace(corpoDaFuncao(migration), "");
  assert.doesNotMatch(
    limpo(semFuncao),
    /\b(INSERT\s+INTO|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
    "nenhum dado e' escrito ao aplicar",
  );
  assert.equal(
    (codigo.match(/\bCREATE OR REPLACE FUNCTION\b/g) ?? []).length,
    1,
    "uma so funcao: a nova",
  );
  assert.doesNotMatch(codigo, /\bCREATE\s+(TABLE|POLICY|TRIGGER|VIEW)\b/i);
  // a coluna: anulavel e SEM padrao (as linhas de antes ficam NULL; nada e' reescrito)
  assert.deepEqual(migration.match(/^ALTER .*$/gm), [
    "ALTER TABLE public.order_refunds",
  ]);
  assert.ok(
    migration.includes(
      "ALTER TABLE public.order_refunds\n  ADD COLUMN IF NOT EXISTS chave_da_solicitacao uuid;",
    ),
  );
  assert.doesNotMatch(codigo, /chave_da_solicitacao uuid (NOT NULL|DEFAULT)/i);
  // o indice: unico, parcial, global (a chave e' um UUID aleatorio)
  assert.ok(
    migration.includes(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_order_refunds_chave_da_solicitacao\n  ON public.order_refunds (chave_da_solicitacao)\n  WHERE chave_da_solicitacao IS NOT NULL;",
    ),
  );
  // pre-voo e conferencia citam a MESMA definicao que o pg_get_indexdef devolve
  assert.equal(migration.split(`'${DEF_INDICE}'`).length - 1, 2);
  // so o authenticated executa a funcao nova
  assert.deepEqual(migration.match(/^(REVOKE|GRANT) .*$/gm), [
    "REVOKE ALL ON FUNCTION public.solicitar_estorno_com_chave(uuid, numeric, text, uuid) FROM PUBLIC, anon, authenticated, service_role;",
    "GRANT EXECUTE ON FUNCTION public.solicitar_estorno_com_chave(uuid, numeric, text, uuid) TO authenticated;",
  ]);
  // solicitar_estorno nao e' tocada (o front antigo segue chamando a de 3 argumentos)
  assert.doesNotMatch(codigo, /FUNCTION public\.solicitar_estorno\(/);
});

Deno.test("1640: a funcao e' SECURITY DEFINER com search_path fixo e 4 argumentos SEM padrao; md5 citado no pre-voo, na conferencia, no rollback e na 200a; saldo com o md5 da 20261241000000", () => {
  const corpo = corpoDaFuncao(migration);
  assert.equal(md5(corpo), H_FUNCAO);
  assert.ok(
    migration.includes(
      "CREATE OR REPLACE FUNCTION public.solicitar_estorno_com_chave(\n    p_order_id uuid,\n    p_amount numeric,\n    p_motivo text,\n    p_chave uuid\n)\n RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'\nAS $function$",
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
  assert.ok(migration.includes(`'${H_SALDO}'`));
  assert.ok(
    lerRepo(`scripts/publicacao/consultas/${B}.sql`).includes(`'${H_SALDO}'`),
  );
  assert.ok(
    ler("20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql").includes(
      H_SALDO,
    ),
  );
  // a resposta tem as chaves de solicitar_estorno e diz se a linha ja existia
  assert.equal(corpo.split("'ja_registrada', true").length - 1, 1);
  assert.equal(corpo.split("'ja_registrada', false").length - 1, 1);
});

Deno.test("1640: a ORDEM do corpo — portas de admin, chave obrigatoria, trava do pedido, a MESMA chave (antes das recusas), as recusas de solicitar_estorno, o saldo, a linha nasce com a chave", () => {
  const corpo = corpoDaFuncao(migration);
  const pos = (t) => {
    assert.equal(corpo.split(t).length - 1, 1, `${t} deve aparecer uma vez`);
    return corpo.indexOf(t);
  };
  const ordem = [
    pos("IF NOT public.is_admin() THEN"),
    pos("IF NOT public.is_admin_atual() THEN"),
    pos("IF p_chave IS NULL THEN"),
    pos("     WHERE id = p_order_id\n       FOR UPDATE;"),
    pos("     WHERE chave_da_solicitacao = p_chave;"),
    pos(
      "        IF v_existente.order_id IS DISTINCT FROM p_order_id\n           OR v_existente.amount IS DISTINCT FROM round(p_amount, 2) THEN",
    ),
    pos("'ja_registrada', true"),
    pos("OR v_payment_status NOT IN ('pago', 'pago_apos_expirar') THEN"),
    pos("IF v_status IS DISTINCT FROM 'cancelled' THEN"),
    pos("IF v_cancelled_after_shipping AND v_returned_at IS NULL THEN"),
    pos("v_saldo := public.pedido__saldo_a_estornar(p_order_id);"),
    pos("IF p_amount IS NULL OR p_amount <= 0 THEN"),
    pos("IF p_amount > v_saldo THEN"),
    pos(
      "INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, chave_da_solicitacao)",
    ),
    pos(
      "ON CONFLICT (chave_da_solicitacao) WHERE chave_da_solicitacao IS NOT NULL DO NOTHING",
    ),
    pos("IF v_refund_id IS NULL THEN"),
    pos("'ja_registrada', false"),
  ];
  assert.deepEqual(
    [...ordem].sort((a, b) => a - b),
    ordem,
    "a ordem do corpo mudou",
  );
  assert.ok(corpo.includes("'lojista', p_chave)"), "a linha nasce com a chave");
});

Deno.test("1640: o rollback comum apaga SO a funcao e mantem coluna e indice; o destrutivo exige o dono, o comum antes e nenhuma funcao citando a coluna", () => {
  assert.ok(
    rollback.includes(
      "DROP FUNCTION IF EXISTS public.solicitar_estorno_com_chave(uuid, numeric, text, uuid);",
    ),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261640000000$");
  const iApaga = rollback.indexOf("\nDROP FUNCTION IF EXISTS");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261640000000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));

  const iTrava = destrutivo.indexOf("DO $destrutivo_20261640000000$");
  const iIndice = destrutivo.indexOf(
    "\nDROP INDEX IF EXISTS public.uq_order_refunds_chave_da_solicitacao;",
  );
  const iColuna = destrutivo.indexOf(
    "\nALTER TABLE public.order_refunds DROP COLUMN IF EXISTS chave_da_solicitacao;",
  );
  const iConfD = destrutivo.indexOf(
    "DO $conferencia_destrutivo_20261640000000$",
  );
  assert.ok(iTrava >= 0 && iTrava < iIndice && iIndice < iColuna);
  assert.ok(iColuna < iConfD);
  const trava = destrutivo.slice(iTrava, iIndice);
  assert.ok(
    trava.includes(
      "current_setting('app.confirmo_apagar_chave_da_solicitacao', true)",
    ),
  );
  assert.ok(trava.includes("CHAVE_DA_SOLICITACAO_ROLLBACK_COMUM_PRIMEIRO"));
  assert.ok(trava.includes("CHAVE_DA_SOLICITACAO_AINDA_CITADA"));
  assert.doesNotMatch(
    limpo(destrutivo),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO)\b)/i,
    "nenhuma linha de devolucao e' apagada",
  );
});

Deno.test("1640: o front chama a funcao nova com a chave da intencao; o 'Tentar de novo' segue na repetindo; ninguem mais chama solicitar_estorno", () => {
  const hook = lerRepo("src/hooks/useEstornosDoPedido.ts");
  assert.ok(hook.includes('"solicitar_estorno_com_chave"'));
  assert.ok(hook.includes("p_chave"));
  assert.ok(hook.includes('"solicitar_estorno_repetindo"'));
  assert.doesNotMatch(hook, /rpc\(\s*"solicitar_estorno",/);
  const tipos = lerRepo("src/types/database.types.ts");
  assert.ok(tipos.includes("solicitar_estorno_com_chave: {"));
  assert.ok(tipos.includes("chave_da_solicitacao: string | null;"));
});

Deno.test("1640: publicacao — lote unico (200a/200b), rol fechado, consultas so de catalogo, workflows, release, aplicador, portas, POSTERIORES_A_97 e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261640000000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261640000000"]);
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
      /\bFROM\s+public\.(order_refunds|devolucoes|marketplace_orders)\b/i,
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
      "run: node tests/banco/rodar-isolado.cjs tests/banco/a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-viva.cjs",
    ),
  );
  // a funcao nova e' porta do logado, registrada nas portas permitidas (EXECUTE so do authenticated)
  const portas = JSON.parse(
    lerRepo("tests/banco/portas-do-visitante-permitidas.json"),
  );
  const porta = portas.funcoes.filter((f) =>
    f.funcao.startsWith("public.solicitar_estorno_com_chave("),
  );
  assert.equal(porta.length, 1);
  assert.equal(
    porta[0].funcao,
    "public.solicitar_estorno_com_chave(p_order_id uuid, p_amount numeric, p_motivo text, p_chave uuid)",
  );
  assert.deepEqual(porta[0].executa, ["authenticated"]);
  assert.equal(porta[0].secdef, true);
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "solicitar_estorno_com_chave");
  const corpo = corpoDaFuncao(migration);
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(corpo.split(texto).length - 1, vezes, texto);
  // a funcao usa is_admin_atual(): as provas que desfazem a 97 a desfazem antes (fim de POSTERIORES_A_97)
  const {
    DEVOLUCAO_COM_CHAVE,
  } = require("./banco/a-devolucao-com-a-mesma-chave-posterior.cjs");
  assert.equal(DEVOLUCAO_COM_CHAVE.nome, NOME);
  for (const arq of [
    "tests/banco/admin-atual-viva.cjs",
    "tests/banco/pagamentos-rpc-viva.cjs",
  ]) {
    const t = lerRepo(arq);
    // estava no fim; a 1651 (A_ORDEM_DOS_BANNERS) entrou depois dela
    assert.ok(t.includes("  DEVOLUCAO_COM_CHAVE,\n"), arq);
  }
});

// @ts-nocheck
// O PIX PAGO NO ULTIMO MINUTO NAO PERDE O PEDIDO — prova offline do par 20261393000000 + rollback (dinheiro e
// estoque; cacada de 26/10/2026). O COMPORTAMENTO (PIX com cobranca na vaga so expira 10 minutos depois do
// vencimento do QR; PIX sem vaga, vaga liberada, sentinela e cartao como antes; o aviso tardio vira 'pago', nao
// 'pago_apos_expirar'; SKIP LOCKED; rollback; pre-voo; consultas 103a/103b) e' provado em
// tests/banco/o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261186000000 com SO o predicado declarado (predicado ausente devolve
// o estoque de um PIX pago no ultimo segundo; predicado sem COALESCE faz o PIX sem metodo sumir da varredura
// para sempre; predicado que pega o sentinela do cartao ou o cartao mexe na regra de 24 h); o corpo do rollback
// tem de ser o da 20261186000000 BYTE A BYTE; os atributos e a ACL nao podem mudar; o pre-voo vem antes da troca
// e a conferencia depois; sem BEGIN/COMMIT de nivel superior; a prova da release (verificar-pagamentos-ikcous)
// pina o corpo DESTA migration.
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
  "20261393000000_o_pix_pago_no_ultimo_minuto_nao_perde_o_pedido.sql";
const VIGENTE = "20261186000000_cartao_em_analise_segura_a_expiracao.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "4e6b4c105ee2eaaecd9c2e19a5c535af";
const H_NOVO = "463086667b8d20b327c37faac9a9b16f";
const FN = "public.expirar_pedidos_vencidos()";

/** O texto da funcao (do CREATE ao `$expirar$;`) e o corpo (entre as aspas de dolar). */
function funcaoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()";
  assert.equal(
    sql.split(marca).length - 1,
    1,
    "uma definicao de expirar_pedidos_vencidos",
  );
  const ini = sql.indexOf(marca);
  const fim = sql.indexOf("$expirar$;", ini) + "$expirar$;".length;
  return sql.slice(ini, fim);
}
const corpoDe = (sql) =>
  /AS \$expirar\$([\s\S]*?)\$expirar\$;/.exec(funcaoDe(sql))[1];
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// O ponto da troca (unico): depois do predicado do cartao, antes do FOR UPDATE SKIP LOCKED.
const DE = `                   )
              )
        FOR UPDATE SKIP LOCKED`;
const PREDICADO_PIX = `          AND (
                expires_at <= now() - interval '10 minutes'
                OR NOT COALESCE(
                     gateway_payment_id IS NOT NULL
                     AND gateway_payment_id NOT LIKE 'verificando:%'
                     AND metodo_online = 'pix',
                     false
                   )
              )
        FOR UPDATE SKIP LOCKED`;
const semComentarios = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*--/.test(l))
    .join("\n");

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

Deno.test("o corpo vigente e' o da 20261186000000 (md5 conhecido) e o corpo novo e' ele com SO o predicado declarado; desfazer a troca devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  assert.equal(
    CORPO_VIGENTE.split(DE).length - 1,
    1,
    "o ponto da troca existe UMA vez",
  );
  const comentarioEPredicado = CORPO_NOVO.slice(
    CORPO_NOVO.indexOf(
      "          -- PIX com cobranca na vaga ganha 10 minutos de folga",
    ),
    CORPO_NOVO.indexOf(PREDICADO_PIX) + PREDICADO_PIX.length,
  );
  const esperado = CORPO_VIGENTE.replace(
    DE,
    () => `                   )\n              )\n${comentarioEPredicado}`,
  );
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + o predicado");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  assert.notEqual(H_NOVO, H_VIGENTE);
  assert.equal(
    CORPO_NOVO.replace(
      comentarioEPredicado,
      () => "        FOR UPDATE SKIP LOCKED",
    ),
    CORPO_VIGENTE,
    "desfazer a troca devolve o vigente",
  );
});

Deno.test("o predicado novo: 10 minutos, PIX = id de gateway de verdade (nao o sentinela) e metodo 'pix', embrulhado em COALESCE (NULL expira no horario de sempre), entre o predicado do cartao e o SKIP LOCKED", () => {
  const codigo = norm(semComentarios(CORPO_NOVO));
  const PIX = norm(
    "AND ( expires_at <= now() - interval '10 minutes' OR NOT COALESCE( gateway_payment_id IS NOT NULL AND gateway_payment_id NOT LIKE 'verificando:%' AND metodo_online = 'pix', false ) )",
  );
  assert.ok(codigo.includes(PIX), "predicado novo ausente ou alterado");
  const iVencido = codigo.indexOf("AND expires_at < now()");
  const iCartao = codigo.indexOf("expires_at <= now() - interval '24 hours'");
  const iPix = codigo.indexOf(PIX);
  const iLock = codigo.indexOf("FOR UPDATE SKIP LOCKED");
  assert.ok(
    iVencido >= 0 && iCartao > iVencido && iPix > iCartao && iLock > iPix,
    "ordem: vencido, cartao, pix, SKIP LOCKED",
  );
  // so um predicado de PIX; o sentinela fica com o cartao (24 h); o literal 'pix' aparece uma vez no codigo
  assert.equal(codigo.split("interval '10 minutes'").length - 1, 1);
  assert.equal(codigo.split("'pix'").length - 1, 1);
  assert.equal(codigo.split("interval '24 hours'").length - 1, 1);
});

Deno.test("o que NAO muda: o laco, a ordem das travas, devolver_estoque, o UPDATE, o retorno, os atributos e a regra do cartao", () => {
  for (const trecho of [
    "FOR v_pedido IN",
    "WHERE payment_status = 'aguardando'",
    "AND status = 'pending'",
    "AND expires_at IS NOT NULL",
    "AND expires_at < now()",
    "gateway_payment_id LIKE 'verificando:%'\n                     OR (\n                          gateway_payment_id IS NOT NULL\n                          AND metodo_online IN ('credito', 'debito')\n                        ),",
    "FOR UPDATE SKIP LOCKED\n    LOOP",
    "PERFORM public.devolver_estoque(v_pedido.id);",
    "SET payment_status = 'expirado',\n               status         = 'cancelled',\n               updated_at     = now()",
    "WHERE id = v_pedido.id;",
    "v_expirados := v_expirados + 1;",
    "RETURN v_expirados;",
  ]) {
    assert.equal(
      CORPO_NOVO.split(trecho).length,
      CORPO_VIGENTE.split(trecho).length,
      `o trecho mudou de numero de ocorrencias: ${trecho}`,
    );
    assert.ok(CORPO_NOVO.includes(trecho), trecho);
  }
  // a varredura segue sem escrever em tabela alguma alem do pedido e sem trava nova
  assert.equal(CORPO_NOVO.split("FOR UPDATE").length - 1, 2); // 1 comentario + 1 codigo (como no vigente)
  assert.equal(CORPO_VIGENTE.split("FOR UPDATE").length - 1, 2);
  assert.doesNotMatch(semComentarios(CORPO_NOVO), /\bNOWAIT\b|\bLOCK TABLE\b/i);
});

const norm = (s) => s.replace(/\s+/g, " ").trim();

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261393000000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata 1 no corpo novo", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do proprio teste
  const entrada = VERIFICACOES[NOME];
  assert.ok(entrada, "sem entrada em VERIFICACOES");
  assert.equal(entrada.funcao, "expirar_pedidos_vencidos");
  assert.ok(entrada.esperado.length >= 6);
  for (const m of entrada.esperado) {
    const { texto, vezes } = typeof m === "string" ? { texto: m, vezes: 1 } : m;
    assert.equal(vezes ?? 1, 1, texto);
    assert.equal(CORPO_NOVO.split(texto).length - 1, 1, texto);
  }
  // o predicado novo NAO existe no corpo da 186: sem a troca, a entrada reprova
  assert.ok(!CORPO_VIGENTE.includes("interval '10 minutes'"));
});

Deno.test("o rollback recria o corpo VIGENTE (o da 20261186000000) byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(funcaoDe(rollback), funcaoDe(migrationVigente));
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  assert.equal(md5(corpoDe(rollback)), H_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
  assert.ok(!corpoDe(rollback).includes("interval '10 minutes'"));
});

Deno.test("so um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, search_path=public, retorno integer); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.expirar_pedidos_vencidos()\n" +
    "RETURNS integer\n" +
    "LANGUAGE plpgsql\n" +
    "SECURITY DEFINER\n" +
    "SET search_path TO 'public'\n" +
    "AS $expirar$";
  for (const sql of [migration, rollback]) {
    assert.equal(
      sql.split("\nCREATE OR REPLACE FUNCTION").length - 1,
      1,
      "uma funcao por arquivo",
    );
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(funcaoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  assert.ok(migrationVigente.includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca do corpo, aceita SO os dois corpos (o da 186 e o desta), exige as cinco colunas, confere atributos e recusa funcao aberta; a conferencia vem depois e recusa o resto", () => {
  const iPre = migration.indexOf("DO $preflight_20261393000000$");
  const fimPre = migration.indexOf("END $preflight_20261393000000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261393000000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `to_regprocedure('${FN}')`,
    "md5(replace(prosrc, E'\\r', ''))",
    `'${H_VIGENTE}'`,
    `'${H_NOVO}'`,
    "v_hash NOT IN (",
    "column_name IN ('payment_status', 'status', 'expires_at', 'gateway_payment_id', 'metodo_online')) <> 5",
    "p.prosecdef",
    "p.provolatile = 'v'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_arguments(p.oid) = ''",
    "pg_get_function_result(p.oid) = 'integer'",
    "<> 1",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "IF v_public OR v_anon OR v_auth THEN",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `v_hash IS DISTINCT FROM '${H_NOVO}'`,
    "p.prosecdef",
    "p.provolatile = 'v'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261393000000:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (aceita o corpo desta migration ou o da 186, atributos, funcao fechada) e conferencia (o corpo volta ao da 186); nunca da EXECUTE a ninguem", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261393000000$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261393000000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H_VIGENTE}'`) && pre.includes(`'${H_NOVO}'`));
  assert.ok(pre.includes("v_hash NOT IN ("));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`v_hash IS DISTINCT FROM '${H_VIGENTE}'`));
  assert.ok(conf.includes("g.grantee = 0"), "PUBLIC continua fechado");
  assert.doesNotMatch(
    limpo(rollback.replace(funcaoDe(rollback), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("o cabecalho declara a regra, o custo aceito, os dados existentes, a ordem de desfazer e o pino da prova da release", () => {
  for (const trecho of [
    "O DEFEITO MEDIDO",
    "10 minutos",
    "CUSTO ACEITO",
    "DADOS EXISTENTES",
    "ROLLBACK MANUAL",
    "ANTES de qualquer rollback da",
    "verificar-pagamentos-ikcous.cjs",
    "Sem BEGIN/COMMIT de",
  ])
    assert.ok(migration.includes(trecho), trecho);
  // o regex da prova da release acha o corpo desta migration (e nao um texto do cabecalho)
  assert.equal(
    (migration.match(/AS \$expirar\$/g) || []).length,
    1,
    "o marcador do corpo aparece so na definicao",
  );
});

Deno.test("depois da 20261186000000 so este par redefine expirar_pedidos_vencidos", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > VIGENTE.slice(0, 14) &&
      /create (?:or replace )?function (?:public\.)?expirar_pedidos_vencidos\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});

Deno.test("a prova somente leitura da release (verificar-pagamentos-ikcous.cjs) pina o corpo DESTA migration para expirar_pedidos_vencidos", () => {
  const {
    hashesEsperados,
  } = require("../scripts/publicacao/verificar-pagamentos-ikcous.cjs");
  assert.equal(hashesEsperados().expirar, H_NOVO);
  const script = Deno.readTextFileSync(
    new URL("scripts/publicacao/verificar-pagamentos-ikcous.cjs", DIR),
  );
  assert.ok(script.includes(NOME));
  assert.ok(!script.includes(VIGENTE));
});

Deno.test("as consultas 103a/103b existem, tem o rol fechado de 4 linhas, o md5 certo e estao registradas nos canais, no rpc-ci e no conferir-banco-da-loja", () => {
  const C103A =
    "103a-conferir-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-aplicado";
  const C103B =
    "103b-antes-o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-base-vigente";
  const sqlA = Deno.readTextFileSync(
    new URL(`scripts/publicacao/consultas/${C103A}.sql`, DIR),
  );
  const sqlB = Deno.readTextFileSync(
    new URL(`scripts/publicacao/consultas/${C103B}.sql`, DIR),
  );
  assert.ok(sqlA.includes(`'${H_NOVO}'`) && !sqlA.includes(H_VIGENTE));
  assert.ok(sqlB.includes(`'${H_VIGENTE}'`) && !sqlB.includes(H_NOVO));
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do proprio teste
  assert.equal(ROL_FECHADO_POR_CONSULTA[C103A].length, 4);
  assert.deepEqual(
    // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do proprio teste
    ROL_FECHADO_POR_CONSULTA[C103A],
    // eslint-disable-next-line security/detect-object-injection -- chave vinda de lista fixa do proprio teste
    ROL_FECHADO_POR_CONSULTA[C103B],
  );
  const canais = JSON.parse(
    Deno.readTextFileSync(new URL("scripts/frota/canais-de-backend.json", DIR)),
  );
  const prova = canais.provasDeObjetos.find((p) => p.consulta === C103A);
  assert.ok(prova, "103a nao esta nos canais");
  assert.deepEqual(prova.versoes, ["20261393000000"]);
  assert.equal(prova.ausenciaConfirmadaPor, C103B);
  const rpc = Deno.readTextFileSync(
    new URL(".github/workflows/rpc-ci.yml", DIR),
  );
  assert.equal(rpc.split(`consultas/${C103A}.sql`).length - 1, 2);
  assert.equal(rpc.split(`consultas/${C103B}.sql`).length - 1, 2);
  assert.ok(
    rpc.includes(
      "tests/banco/rodar-isolado.cjs tests/banco/o-pix-pago-no-ultimo-minuto-nao-perde-o-pedido-viva.cjs",
    ),
  );
  const conferir = Deno.readTextFileSync(
    new URL(".github/workflows/conferir-banco-da-loja.yml", DIR),
  );
  assert.ok(conferir.includes(`- ${C103A}`) && conferir.includes(`- ${C103B}`));
});

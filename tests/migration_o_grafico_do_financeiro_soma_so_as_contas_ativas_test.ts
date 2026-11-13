// @ts-nocheck
// O GRAFICO DO FINANCEIRO SOMA SO AS CONTAS ATIVAS — prova offline do par 20261399985000 + rollback (12/11/2026).
// O COMPORTAMENTO (serie[].variacao_saldo: o saldo ao fim de cada dia, reconstruido de saldo_total, bate com o de fin__saldos naquele dia;
// o resto do JSON nao muda; pre-voo, ACL, rollback, atomicidade e idempotencia) e' provado em
// tests/banco/o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o vigente (20261399300000) com UMA so troca (a CTE `variacao` e a chave `variacao_saldo` na serie); o
// corpo do rollback tem de ser o vigente BYTE A BYTE; atributos e ACL nao mudam (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a
// conferencia depois; sem BEGIN/COMMIT de nivel superior; fin_resumo alimenta o Financeiro de TODAS as lojas.
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
  "20261399985000_o_grafico_do_financeiro_soma_so_as_contas_ativas.sql";
const NOME_ANTES =
  "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H = {
  vigente: "a10e7f301eaf6b3edfac50bc87ff74bc",
  novo: "9e711b03cc63f610461915b850f2eb70",
  saldos: "5992ecf164d886110c21dbf93a5c607e",
};
const C141A =
  "141a-conferir-o-grafico-do-financeiro-soma-so-as-contas-ativas-aplicado";
const C141B =
  "141b-antes-o-grafico-do-financeiro-soma-so-as-contas-ativas-base-vigente";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo. */
function corpoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const VIGENTE = corpoDe(ler(NOME_ANTES), "fin_resumo");
const NOVO = corpoDe(migration, "fin_resumo");

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

Deno.test("o corpo vigente tem md5 conhecido e o novo e' o vigente com UMA troca (a CTE `variacao` e a chave `variacao_saldo` da serie), md5 do novo conhecido", () => {
  assert.equal(md5(VIGENTE), H.vigente);
  assert.equal(md5(NOVO), H.novo);
  const cte = "\n  ), variacao AS MATERIALIZED (";
  const fimCte = "\n  )\n  SELECT jsonb_build_object(";
  const i = NOVO.indexOf(cte);
  assert.ok(i > 0 && NOVO.split(cte).length - 1 === 1, "uma CTE variacao");
  const j = NOVO.indexOf(fimCte, i);
  assert.ok(j > i, "a CTE variacao fecha antes do SELECT");
  const chave =
    ",\n                 'variacao_saldo', COALESCE((SELECT sum(v.valor) FROM variacao v WHERE v.dia = d.dia::date), 0)";
  assert.equal(NOVO.split(chave).length - 1, 1, "uma chave variacao_saldo");
  // Tirando a CTE e a chave, o corpo novo e' o vigente, byte a byte (so comentarios e as duas trocas mudam).
  const semTroca = (NOVO.slice(0, i) + NOVO.slice(j)).replace(chave, "");
  assert.equal(
    semTroca,
    VIGENTE,
    "fin_resumo muda mais do que a CTE variacao e a chave nova",
  );
  // Dinheiro em numeric: nenhum ponto flutuante, nenhum arredondamento na variacao.
  const cteTexto = NOVO.slice(i, j);
  assert.doesNotMatch(
    cteTexto,
    /float|double|real\b|::int\b|::bigint|round\(/i,
  );
  // A conta repete a de fin__saldos: so conta ativa, so a partir do saldo_inicial_em, so ate hoje, transferencia nos dois lados.
  for (const trecho of [
    "JOIN public.fin_contas c ON c.ativa AND (m.conta_id = c.id OR m.conta_destino_id = c.id)",
    "WHERE m.data >= c.saldo_inicial_em AND m.data <= v_hoje",
    "WHEN m.tipo = 'entrada' AND m.conta_id = c.id THEN m.valor",
    "WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN -m.valor",
    "WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor",
    "WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor",
    "FROM periodo m",
  ])
    assert.equal(cteTexto.split(trecho).length - 1, 1, trecho);
  // E e' a MESMA do corpo de fin__saldos (a quem o saldo_total obedece).
  const saldos = ler("20261177000000_o_financeiro_da_loja_nasce.sql");
  for (const trecho of [
    "WHEN m.tipo = 'entrada' AND m.conta_id = c.id THEN m.valor",
    "WHEN m.tipo = 'saida' AND m.conta_id = c.id THEN -m.valor",
    "WHEN m.tipo = 'transferencia' AND m.conta_id = c.id THEN -m.valor",
    "WHEN m.tipo = 'transferencia' AND m.conta_destino_id = c.id THEN m.valor",
    "AND m.data >= c.saldo_inicial_em",
  ])
    assert.ok(saldos.includes(trecho), `fin__saldos: ${trecho}`);
  // O que de proposito NAO muda: as barras (entradas e saidas de TODAS as contas), o vencido sem estorno, as travas de admin.
  for (const trecho of [
    "'entradas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'entrada'), 0),",
    "'saidas', COALESCE((SELECT sum(valor) FROM periodo p WHERE p.data = d.dia::date AND p.tipo = 'saida'), 0),",
    "AND origem <> 'estorno'), 0),",
    "'saldo_total', COALESCE((SELECT sum(saldo) FROM saldos WHERE ativa), 0),",
  ])
    assert.equal(NOVO.split(trecho).length - 1, 1, trecho);
  assert.equal(NOVO.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(NOVO.split("IF NOT public.is_admin_atual() THEN").length - 1, 1);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399985000 (sem ela a migration sai PULADA, codigo 2), cada marcador com a contagem exata", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const entrada = VERIFICACOES[NOME];
  assert.ok(Array.isArray(entrada), "uma funcao = lista de uma checagem");
  assert.deepEqual(
    entrada.map((e) => e.funcao),
    ["fin_resumo"],
  );
  const [checagem] = entrada;
  assert.equal(avaliarChecagem(NOVO, checagem).situacao, "verificada");
  // O corpo vigente (sem a variacao) NAO passa; tirar qualquer marcador tambem reprova.
  assert.equal(avaliarChecagem(VIGENTE, checagem).situacao, "falhou");
  for (const marcador of checagem.esperado) {
    assert.equal(
      avaliarChecagem(NOVO.replace(marcador.texto, ""), checagem).situacao,
      "falhou",
      `tirar "${marcador.texto}" nao reprovou`,
    );
    assert.equal(
      NOVO.split(marcador.texto).length - 1,
      marcador.vezes,
      marcador.texto,
    );
  }
});

Deno.test("o rollback recria o corpo vigente byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback, "fin_resumo"), VIGENTE);
  assert.equal(md5(corpoDe(rollback, "fin_resumo")), H.vigente);
  for (const h of [H.vigente, H.novo]) {
    assert.ok(migration.includes(`'${h}'`), `migration: ${h}`);
    assert.ok(rollback.includes(`'${h}'`), `rollback: ${h}`);
  }
  // O rollback nao leva a variacao para lugar nenhum (so o texto do corpo vigente).
  assert.equal(
    rollback.split("variacao_saldo").length - 1,
    1,
    "so o comentario do cabecalho cita a chave",
  );
  assert.equal(corpoDe(rollback, "fin_resumo").includes("variacao"), false);
});

Deno.test("um CREATE OR REPLACE FUNCTION em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $$";
  for (const sql of [migration, rollback]) {
    assert.equal(sql.split("\nCREATE OR REPLACE FUNCTION").length - 1, 1);
    assert.ok(sql.includes(cabecalho));
    const fora = limpo(sql.replace(corpoDe(sql, "fin_resumo"), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(VOLATILE|IMMUTABLE|SECURITY INVOKER)\b/i);
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
  }
  // O cabecalho e' o da migration vigente.
  assert.ok(ler(NOME_ANTES).includes(cabecalho));
});

Deno.test("o pre-voo vem antes da troca, aceita SO os dois corpos, a ACL de hoje, confere atributos, dono, o corpo de fin__saldos, funcoes, tabelas e colunas que o corpo le e fotografa o registro; a conferencia vem depois", () => {
  const iPre = migration.indexOf("DO $preflight_20261399985$");
  const fimPre = migration.indexOf("END $preflight_20261399985$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261399985$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  assert.ok(
    migration.indexOf("SET LOCAL lock_timeout = '5s';") >= 0 &&
      migration.indexOf("SET LOCAL lock_timeout = '5s';") < iPre,
  );
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `('public.fin_resumo(date,date)', '${H.vigente}', '${H.novo}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "v_hash NOT IN (v_hash_vigente, v_hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))",
    "'p_inicio date, p_fim date'",
    "<> 1",
    `'${H.saldos}'`,
    "'public.fin__movimentos(date,date)'",
    "'public.fin__hoje()'",
    "'public.is_admin_atual()'",
    "'public.fin_contas'",
    "'ativa', 'saldo_inicial_em'",
    "'tipo', 'valor', 'data', 'conta_id', 'conta_destino_id'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "to_jsonb(p) - 'prosrc'",
    "set_config('ikcous.fin_resumo39985_atributos'",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const conf = migration.slice(iConf);
  for (const trecho of [
    `'${H.novo}'`,
    "v_hash IS DISTINCT FROM",
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.fin_resumo39985_atributos')::jsonb",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261399985:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (so aceita o corpo desta migration) e conferencia (volta ao vigente, atributos e ACL intactos); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399985$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399985$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(pre.includes(`'${H.novo}'`));
  assert.ok(pre.includes("v_hash IS DISTINCT FROM"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("a.grantee = 0"));
  const conf = rollback.slice(iConf);
  assert.ok(conf.includes(`'${H.vigente}'`));
  assert.ok(conf.includes("(to_jsonb(p) - 'prosrc') ="));
  assert.doesNotMatch(
    limpo(rollback.replace(corpoDe(rollback, "fin_resumo"), "")),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a cadeia esta declarada: a 8e e a 119a aceitam o corpo desta como sucessor, a lista de sucessoras da 99 a inclui, e os helpers de prova desfazem esta ANTES da 3993", () => {
  for (const trecho of ["ROLLBACK MANUAL", "20261399300000", "ANTES"])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRepo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(c8e.includes(`('fin_resumo', '${H.novo}', '20261399985000')`));
  assert.ok(c8e.includes(`('fin_resumo', '${H.vigente}', '20261399300000')`));
  const c119a = lerRepo(
    "scripts/publicacao/consultas/119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado.sql",
  );
  assert.ok(c119a.includes(`'${H.novo}'`) && c119a.includes(`'${H.vigente}'`));
  const c119b = lerRepo(
    "scripts/publicacao/consultas/119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente.sql",
  );
  assert.ok(
    !c119b.includes(`'${H.novo}'`),
    "a 119b (o ANTES) nunca cita a 39985",
  );
  const sucessoras = lerRepo("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  // O helper desta migration, e o da 3993 que o chama ANTES de desfazer a propria.
  const {
    GRAFICO_DO_FINANCEIRO,
  } = require("./banco/o-grafico-do-financeiro-posterior.cjs");
  assert.equal(GRAFICO_DO_FINANCEIRO.nome, NOME);
  assert.equal(GRAFICO_DO_FINANCEIRO.hashVigente, H.vigente);
  assert.equal(GRAFICO_DO_FINANCEIRO.hashDesta, H.novo);
  const posterior3993 = lerRepo(
    "tests/banco/o-estorno-em-andamento-posterior.cjs",
  );
  const i = posterior3993.indexOf("desfazerGraficoDoFinanceiroNaTransacao");
  assert.ok(i > 0);
  assert.ok(i < posterior3993.indexOf("rollback-manual-"));
});

Deno.test("so a baseline, a 20261199, a 20261399300000 e esta migration definem fin_resumo; depois da 3993 so esta a redefine", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > "20261399300000" &&
      /create (?:or replace )?function public\.fin_resumo\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});

Deno.test("publicacao: lote de apply normal 141a/141b, rol fechado de 5 linhas, consultas so leem catalogo e citam os md5 certos, registrado nos dois workflows, na lista de rol fechado e no rpc-ci", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261399985000"),
  );
  assert.equal(lote.length, 1, "UM lote para a 20261399985000");
  assert.deepEqual(lote[0].versoes, ["20261399985000"]);
  assert.equal(lote[0].consulta, C141A);
  assert.equal(lote[0].ausenciaConfirmadaPor, C141B);
  assert.ok(!("backfillLedger" in lote[0]) && !("nuncaAplicar" in lote[0]));
  const a = lerRepo(`scripts/publicacao/consultas/${C141A}.sql`);
  const b = lerRepo(`scripts/publicacao/consultas/${C141B}.sql`);
  assert.ok(a.includes(`'${H.novo}'`) && !b.includes(`'${H.novo}'`));
  assert.ok(b.includes(`'${H.vigente}'`) && !a.includes(`'${H.vigente}'`));
  for (const sql of [a, b]) {
    assert.ok(
      sql.includes(`'${H.saldos}'`),
      "o corpo de fin__saldos e' conferido nas duas",
    );
    const semComentarios = limpo(sql);
    assert.doesNotMatch(
      semComentarios,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      semComentarios,
      /\bFROM\s+(public\.)?(marketplace_orders|fin_lancamentos|fin_contas|order_refunds|profiles|produtos)\b/i,
    );
    assert.doesNotMatch(
      semComentarios,
      /\bfin_resumo\s*\(\s*['\d]/i,
      "nao chama fin_resumo",
    );
    assert.ok(sql.includes("md5(replace(p.prosrc, chr(13), ''))"));
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [C141A, C141B]) {
    // eslint-disable-next-line security/detect-object-injection -- `nome` vem de constantes literais deste arquivo.
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    assert.equal(rol.length, 5, `${nome}: rol fechado de 5 linhas`);
    for (const item of rol)
      assert.ok(
        (nome.startsWith("141a") ? a : b).includes(`'${item}'`),
        `${nome}: item "${item}" fora do .sql`,
      );
  }
  const publicar = lerRepo("scripts/frota/publicar-release.mjs");
  assert.ok(publicar.includes(`"${C141A}"`) && publicar.includes(`"${C141B}"`));
  for (const wf of [
    ".github/workflows/conferir-banco-da-loja.yml",
    ".github/workflows/rpc-ci.yml",
  ]) {
    const yaml = lerRepo(wf);
    assert.ok(yaml.includes(C141A), `${wf}: falta a 141a`);
    assert.ok(yaml.includes(C141B), `${wf}: falta a 141b`);
  }
  const rpc = lerRepo(".github/workflows/rpc-ci.yml");
  assert.equal(
    rpc.split(
      "node tests/banco/rodar-isolado.cjs tests/banco/o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs",
    ).length - 1,
    1,
    "o rpc-ci roda a prova viva da 39985, uma vez",
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-grafico-do-financeiro-soma-so-as-contas-ativas-viva.cjs",
    ),
  );
});

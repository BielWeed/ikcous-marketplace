// @ts-nocheck
// O ESTORNO EM ANDAMENTO NAO E CONTA VENCIDA — prova offline do par 20261399300000 + rollback (rodada 7, 04/11/2026).
// O COMPORTAMENTO (estorno 'solicitado'/'em_processamento' com vencimento no passado sai de painel_inicio.contas_vencidas e de
// fin_resumo.a_pagar.vencido; a conta lancada pela lojista segue; a_pagar_7d e o resto do JSON nao mudam; as duas telas concordam;
// pre-voo, ACL, rollback, atomicidade e idempotencia) e' provado em tests/banco/o-estorno-em-andamento-nao-e-conta-vencida-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: cada corpo novo tem de ser o vigente (painel_inicio: 20261398000000; fin_resumo: 20261199000000) com UMA so troca
// (`AND origem <> 'estorno'` no contas_vencidas / no a_pagar.vencido, mais comentarios); o corpo do rollback tem de ser o vigente BYTE A BYTE
// para as DUAS funcoes; atributos e ACL nao mudam (nenhum GRANT/REVOKE); o pre-voo vem antes das duas trocas e a conferencia depois das duas;
// sem BEGIN/COMMIT de nivel superior; as duas funcoes alimentam a tela inicial e o Financeiro de TODAS as lojas.
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
const NOME = "20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql";
const NOME_PAINEL =
  "20261398000000_o_inicio_compara_o_mes_anterior_ate_a_mesma_hora.sql";
const NOME_RESUMO = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
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
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

const H = {
  painelVigente: "01d29aedf98b7f95851c1a1001b5c7ca",
  painelNovo: "8d58e15e7410afe0d254f37f38251df4",
  resumoVigente: "410668ed931d89e0a16a568b35df7973",
  resumoNovo: "a10e7f301eaf6b3edfac50bc87ff74bc",
};

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo. */
function corpoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const PAINEL_VIGENTE = corpoDe(ler(NOME_PAINEL), "painel_inicio");
const RESUMO_VIGENTE = corpoDe(ler(NOME_RESUMO), "fin_resumo");
const PAINEL_NOVO = corpoDe(migration, "painel_inicio");
const RESUMO_NOVO = corpoDe(migration, "fin_resumo");
const SEM_COMENTARIO = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
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

Deno.test("os corpos vigentes tem md5 conhecido e cada corpo novo e' o vigente com UMA troca (`AND origem <> 'estorno'` na linha do vencido), md5 dos novos conhecido", () => {
  assert.equal(md5(PAINEL_VIGENTE), H.painelVigente);
  assert.equal(md5(RESUMO_VIGENTE), H.resumoVigente);
  assert.equal(md5(PAINEL_NOVO), H.painelNovo);
  assert.equal(md5(RESUMO_NOVO), H.resumoNovo);
  // painel_inicio: a UNICA troca de codigo e' a condicao de contas_vencidas.
  const trocaPainel = [
    "'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje),",
    "'contas_vencidas', (SELECT count(*) FROM prev WHERE tipo = 'saida' AND venc < v_hoje AND origem <> 'estorno'),",
  ];
  assert.equal(PAINEL_VIGENTE.split(trocaPainel[0]).length - 1, 1);
  assert.equal(PAINEL_NOVO.split(trocaPainel[1]).length - 1, 1);
  assert.equal(
    SEM_COMENTARIO(PAINEL_NOVO.replace(trocaPainel[1], trocaPainel[0])),
    SEM_COMENTARIO(PAINEL_VIGENTE),
    "painel_inicio muda mais do que a condicao de contas_vencidas",
  );
  // fin_resumo: a UNICA troca de codigo e' a condicao de a_pagar.vencido.
  const trocaResumo = [
    "'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje), 0),",
    "'vencido', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida' AND venc < v_hoje AND origem <> 'estorno'), 0),",
  ];
  assert.equal(RESUMO_VIGENTE.split(trocaResumo[0]).length - 1, 1);
  assert.equal(RESUMO_NOVO.split(trocaResumo[1]).length - 1, 1);
  assert.equal(
    SEM_COMENTARIO(RESUMO_NOVO.replace(trocaResumo[1], trocaResumo[0])),
    SEM_COMENTARIO(RESUMO_VIGENTE),
    "fin_resumo muda mais do que a condicao de a_pagar.vencido",
  );
  // O que de proposito NAO muda: a_pagar_7d, a_receber_7d, a_pagar.total e proximos_7_dias (nenhum `<> 'estorno'` fora das duas linhas).
  assert.equal(PAINEL_NOVO.split("<> 'estorno'").length - 1, 1);
  assert.equal(RESUMO_NOVO.split("<> 'estorno'").length - 1, 1);
  assert.ok(
    PAINEL_NOVO.includes(
      "'a_pagar_7d', (SELECT COALESCE(sum(valor), 0) FROM prev WHERE tipo = 'saida' AND venc <= v_hoje + 7),",
    ),
  );
  assert.ok(
    RESUMO_NOVO.includes(
      "'total', COALESCE((SELECT sum(valor) FROM previstos WHERE tipo = 'saida'), 0),",
    ),
  );
  // As travas de admin, nas duas.
  for (const c of [PAINEL_NOVO, RESUMO_NOVO]) {
    assert.equal(c.split("IF NOT public.is_admin() THEN").length - 1, 1);
    assert.equal(c.split("IF NOT public.is_admin_atual() THEN").length - 1, 1);
  }
  // A exclusao e' da ORIGEM, que a fonte dos dois (fin__movimentos) fornece em toda linha e nunca nula (a comparacao `<>` com NULL
  // derrubaria a conta): lancamentos tem origem NOT NULL com CHECK; as demais linhas sao literais.
  const fonte = ler(
    "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql",
  );
  assert.ok(
    fonte.includes("SELECT 'estorno:' || r.id::text, 'estorno', 'saida',"),
  );
  const nasce = ler("20261177000000_o_financeiro_da_loja_nasce.sql");
  assert.ok(
    nasce.includes(
      "origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'sangria', 'suprimento', 'ajuste_caixa'))",
    ),
  );
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261399300000 (sem ela a migration sai PULADA, codigo 2), uma por funcao, cada marcador com a contagem exata", () => {
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const entrada = VERIFICACOES[NOME];
  assert.ok(Array.isArray(entrada), "duas funcoes = lista de checagens");
  assert.deepEqual(entrada.map((e) => e.funcao).sort(), [
    "fin_resumo",
    "painel_inicio",
  ]);
  const corpos = {
    painel_inicio: [PAINEL_NOVO, PAINEL_VIGENTE],
    fin_resumo: [RESUMO_NOVO, RESUMO_VIGENTE],
  };
  for (const checagem of entrada) {
    const [novo, vigente] = corpos[checagem.funcao];
    assert.equal(
      avaliarChecagem(novo, checagem).situacao,
      "verificada",
      checagem.funcao,
    );
    // O corpo vigente (sem a exclusao) NAO passa; tirar qualquer marcador tambem reprova.
    assert.equal(
      avaliarChecagem(vigente, checagem).situacao,
      "falhou",
      checagem.funcao,
    );
    for (const marcador of checagem.esperado)
      assert.equal(
        avaliarChecagem(novo.replace(marcador.texto, ""), checagem).situacao,
        "falhou",
        `${checagem.funcao}: tirar "${marcador.texto}" nao reprovou`,
      );
    for (const marcador of checagem.esperado)
      assert.equal(
        novo.split(marcador.texto).length - 1,
        marcador.vezes,
        `${checagem.funcao}: "${marcador.texto}"`,
      );
  }
});

Deno.test("o rollback recria os DOIS corpos vigentes byte a byte, com o mesmo md5 que o pre-voo e a conferencia declaram", () => {
  assert.equal(corpoDe(rollback, "painel_inicio"), PAINEL_VIGENTE);
  assert.equal(corpoDe(rollback, "fin_resumo"), RESUMO_VIGENTE);
  assert.equal(md5(corpoDe(rollback, "painel_inicio")), H.painelVigente);
  assert.equal(md5(corpoDe(rollback, "fin_resumo")), H.resumoVigente);
  for (const sql of [migration, rollback])
    for (const h of Object.values(H)) assert.ok(sql.includes(`'${h}'`), h);
  // O rollback nao leva a exclusao do estorno para lugar nenhum (so o texto dos corpos vigentes).
  assert.equal(rollback.split("<> 'estorno'").length - 1, 0);
});

Deno.test("um CREATE OR REPLACE FUNCTION por funcao em cada arquivo, com a MESMA assinatura e os MESMOS atributos (SECURITY DEFINER, plpgsql, STABLE, search_path=public); nada de GRANT, REVOKE, DROP, ALTER, DML nem tabela nova fora dos corpos", () => {
  const cabecalhos = [
    "CREATE OR REPLACE FUNCTION public.painel_inicio()\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $$",
    "CREATE OR REPLACE FUNCTION public.fin_resumo(p_inicio date, p_fim date)\n RETURNS jsonb\n LANGUAGE plpgsql\n STABLE SECURITY DEFINER\n SET search_path TO 'public'\nAS $$",
  ];
  for (const sql of [migration, rollback]) {
    assert.equal(sql.split("\nCREATE OR REPLACE FUNCTION").length - 1, 2);
    for (const cab of cabecalhos)
      assert.ok(sql.includes(cab), cab.slice(0, 60));
    const fora = limpo(
      sql
        .replace(corpoDe(sql, "painel_inicio"), "")
        .replace(corpoDe(sql, "fin_resumo"), ""),
    );
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
  // O cabecalho de cada funcao e o da migration vigente dela.
  assert.ok(ler(NOME_PAINEL).includes(cabecalhos[0]));
  assert.ok(ler(NOME_RESUMO).includes(cabecalhos[1]));
});

Deno.test("o pre-voo vem antes das DUAS trocas, aceita SO os dois corpos de cada funcao, a ACL de hoje, confere atributos, dono, funcoes e tabelas que os corpos leem e fotografa o registro inteiro de cada uma; a conferencia vem depois das duas", () => {
  const iPre = migration.indexOf("DO $preflight_20261399300$");
  const fimPre = migration.indexOf("END $preflight_20261399300$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iUltima = migration.lastIndexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261399300$");
  assert.ok(
    iPre >= 0 &&
      fimPre > iPre &&
      fimPre < iCria &&
      iCria < iUltima &&
      iUltima < iConf,
  );
  assert.ok(
    migration.indexOf("SET LOCAL lock_timeout = '5s';") >= 0 &&
      migration.indexOf("SET LOCAL lock_timeout = '5s';") < iPre,
  );
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    `('public.painel_inicio()', '${H.painelVigente}', '${H.painelNovo}')`,
    `('public.fin_resumo(date,date)', '${H.resumoVigente}', '${H.resumoNovo}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "v_hash NOT IN (r.hash_vigente, r.hash_desta)",
    "p.prosecdef",
    "p.provolatile = 's'",
    "NOT p.proretset",
    "p.proconfig = ARRAY['search_path=public']::text[]",
    "pg_get_function_result(p.oid) = 'jsonb'",
    "p.proowner = (SELECT proowner FROM pg_proc WHERE oid = to_regprocedure('public.is_admin_atual()'))",
    "<> 1",
    "'public.fin__movimentos(date,date)'",
    "'public.fin__hoje()'",
    "'public.fin_dre(date,date)'",
    "'public.crm__vendas(timestamptz)'",
    "'public.is_admin_atual()'",
    "'public.marketplace_orders'",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "to_jsonb(p) - 'prosrc'",
    "set_config('ikcous.' || r.nome || '3993_atributos'",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
  // A ACL: painel_inicio exige tambem o service_role (medido na 398); fin_resumo nao.
  assert.ok(pre.includes("(v_servico OR r.nome <> 'painel_inicio')"));
  const conf = migration.slice(iConf);
  for (const trecho of [
    `('public.painel_inicio()', '${H.painelNovo}')`,
    `('public.fin_resumo(date,date)', '${H.resumoNovo}')`,
    "v_hash IS DISTINCT FROM r.hash_desta",
    "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.' || r.nome || '3993_atributos')::jsonb",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_oid, 'EXECUTE')",
    "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
    "RAISE EXCEPTION 'conferencia 20261399300:",
  ])
    assert.ok(conf.includes(trecho), trecho);
});

Deno.test("o rollback tem pre-voo (so aceita os corpos desta migration, os DOIS) e conferencia (os dois voltam ao vigente, atributos e ACL intactos); nunca da EXECUTE a anon ou PUBLIC", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261399300$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261399300$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = rollback.slice(iPre, iCria);
  assert.ok(
    pre.includes(`'${H.painelNovo}'`) && pre.includes(`'${H.resumoNovo}'`),
  );
  assert.ok(pre.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  assert.ok(pre.includes("RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:"));
  assert.ok(pre.includes("g.grantee = 0") || pre.includes("a.grantee = 0"));
  const conf = rollback.slice(iConf);
  assert.ok(
    conf.includes(`'${H.painelVigente}'`) &&
      conf.includes(`'${H.resumoVigente}'`),
  );
  assert.ok(conf.includes("(to_jsonb(p) - 'prosrc') ="));
  assert.doesNotMatch(
    limpo(
      rollback
        .replace(corpoDe(rollback, "painel_inicio"), "")
        .replace(corpoDe(rollback, "fin_resumo"), ""),
    ),
    /GRANT|REVOKE/i,
  );
});

Deno.test("a cadeia esta declarada: a 8e, a 17a, a 30a, a 97a e a 116a aceitam os corpos desta como sucessores, a lista de sucessoras da 99 a inclui (duas entradas), e os helpers de prova desfazem esta ANTES", () => {
  for (const trecho of [
    "ROLLBACK MANUAL",
    "20261398000000",
    "20261199000000",
    "ANTES",
  ])
    assert.ok(migration.includes(trecho), trecho);
  const c8e = lerRepo(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    c8e.includes(`('painel_inicio', '${H.painelNovo}', '20261399300000')`),
  );
  assert.ok(
    c8e.includes(`('fin_resumo', '${H.resumoNovo}', '20261399300000')`),
  );
  const sucessoras = lerRepo("tests/banco/sucessoras-da-99.cjs");
  assert.ok(sucessoras.includes(NOME));
  assert.ok(sucessoras.includes(`["${NOME}", 2]`));
  const shasPainel = [
    sha256(PAINEL_NOVO),
    sha256(PAINEL_NOVO.replace(/\n/g, "\r\n")),
  ];
  const c17a = lerRepo(
    "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
  );
  for (const h of shasPainel)
    assert.equal(
      c17a.split(`'${h}'`).length - 1,
      1,
      "17a cita o hash do painel uma vez",
    );
  for (const antes of [
    "scripts/publicacao/consultas/17b-antes-estoque-do-painel-corpos-vigentes.sql",
    "scripts/publicacao/consultas/30b-antes-numeros-do-painel-corpos-vigentes.sql",
    "scripts/publicacao/consultas/97b-antes-o-lucro-do-inicio-conta-o-mes-inteiro-base-vigente.sql",
  ]) {
    const b = lerRepo(antes);
    for (const h of [...shasPainel, H.painelNovo])
      assert.ok(!b.includes(h), `${antes}: nunca cita a 3993`);
  }
  for (const [arq, h] of [
    [
      "scripts/publicacao/consultas/30a-conferir-numeros-do-painel-aplicado.sql",
      H.painelNovo,
    ],
    [
      "scripts/publicacao/consultas/97a-conferir-o-lucro-do-inicio-conta-o-mes-inteiro-aplicado.sql",
      H.painelNovo,
    ],
    [
      "scripts/publicacao/consultas/116a-conferir-o-inicio-compara-o-mes-anterior-ate-a-mesma-hora-aplicado.sql",
      H.painelNovo,
    ],
  ])
    assert.ok(
      lerRepo(arq).includes(`'${h}'`),
      `${arq}: aceita o corpo da 3993`,
    );
  // O helper desta migration, e o da 398 que o chama antes de desfazer a propria.
  const {
    ESTORNO_FORA_DO_VENCIDO,
  } = require("./banco/o-estorno-em-andamento-posterior.cjs");
  assert.equal(ESTORNO_FORA_DO_VENCIDO.nome, NOME);
  assert.ok(ESTORNO_FORA_DO_VENCIDO.noAr.includes(H.painelNovo));
  const posterior398 = lerRepo(
    "tests/banco/o-inicio-compara-o-mes-anterior-posterior.cjs",
  );
  const i = posterior398.indexOf("desfazerEstornoForaDoVencidoNaTransacao");
  assert.ok(i > 0);
  assert.ok(i < posterior398.indexOf("rollback-manual-"));
});

Deno.test("so a baseline, a 20261199 (e o par que a redefine) e esta migration definem fin_resumo; depois da 20261199 so esta a redefine", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const posteriores = [];
  for (const n of todas)
    if (
      n.replace(/^rollback-manual-/, "").slice(0, 14) > "20261199000000" &&
      /create (?:or replace )?function public\.fin_resumo\b/.test(
        limpo(ler(n)).toLowerCase(),
      )
    )
      posteriores.push(n);
  assert.deepEqual(posteriores.sort(), [NOME, `rollback-manual-${NOME}`]);
});

Deno.test("publicacao: lote de apply normal 119a/119b (junto com a 20261399200000), rol fechado de 10 linhas, consultas so leem catalogo e citam os md5 certos, registrado nos dois workflows e na lista de rol fechado", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261399300000"),
  );
  assert.equal(lote.length, 1, "UM lote para a 20261399300000");
  // A 3992 (busca) e esta, na ordem de aplicacao, no MESMO lote.
  assert.deepEqual(lote[0].versoes, ["20261399200000", "20261399300000"]);
  assert.equal(
    lote[0].consulta,
    "119a-conferir-a-busca-por-palavras-e-o-estorno-fora-do-vencido-aplicado",
  );
  assert.equal(
    lote[0].ausenciaConfirmadaPor,
    "119b-antes-a-busca-por-palavras-e-o-estorno-fora-do-vencido-base-vigente",
  );
  assert.ok(!("backfillLedger" in lote[0]) && !("nuncaAplicar" in lote[0]));
  const a = lerRepo(`scripts/publicacao/consultas/${lote[0].consulta}.sql`);
  const b = lerRepo(
    `scripts/publicacao/consultas/${lote[0].ausenciaConfirmadaPor}.sql`,
  );
  for (const h of [H.painelNovo, H.resumoNovo])
    assert.ok(a.includes(`'${h}'`) && !b.includes(`'${h}'`));
  for (const h of [H.painelVigente, H.resumoVigente])
    assert.ok(b.includes(`'${h}'`) && !a.includes(`'${h}'`));
  for (const sql of [a, b]) {
    const semComentarios = limpo(sql);
    assert.doesNotMatch(
      semComentarios,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      semComentarios,
      /\bFROM\s+(public\.)?(marketplace_orders|fin_lancamentos|order_refunds|profiles|produtos)\b/i,
    );
    assert.ok(sql.includes("md5(replace(p.prosrc, chr(13), ''))"));
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [lote[0].consulta, lote[0].ausenciaConfirmadaPor]) {
    // eslint-disable-next-line security/detect-object-injection -- `nome` vem do lote literal lido do JSON do repositorio.
    const rol = ROL_FECHADO_POR_CONSULTA[nome];
    assert.equal(rol.length, 10, `${nome}: rol fechado de 10 linhas`);
    for (const item of rol)
      assert.ok(
        (nome.startsWith("119a") ? a : b).includes(`'${item}'`),
        `${nome}: item "${item}" fora do .sql`,
      );
  }
  const publicar = lerRepo("scripts/frota/publicar-release.mjs");
  assert.ok(publicar.includes(`"${lote[0].consulta}"`));
  assert.ok(publicar.includes(`"${lote[0].ausenciaConfirmadaPor}"`));
  for (const wf of [
    ".github/workflows/conferir-banco-da-loja.yml",
    ".github/workflows/rpc-ci.yml",
  ]) {
    const yaml = lerRepo(wf);
    assert.ok(yaml.includes(lote[0].consulta), `${wf}: falta a 119a`);
    assert.ok(
      yaml.includes(lote[0].ausenciaConfirmadaPor),
      `${wf}: falta a 119b`,
    );
  }
  const rpc = lerRepo(".github/workflows/rpc-ci.yml");
  assert.equal(
    rpc.split(
      "node tests/banco/rodar-isolado.cjs tests/banco/o-estorno-em-andamento-nao-e-conta-vencida-viva.cjs",
    ).length - 1,
    1,
    "o rpc-ci roda a prova viva da 3993, uma vez",
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-estorno-em-andamento-nao-e-conta-vencida-viva.cjs",
    ),
  );
});

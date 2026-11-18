// @ts-nocheck
// O INICIO MOSTRA O DINHEIRO A DEVOLVER E A MARGEM DO FINANCEIRO — prova offline do par 20261402000000 + rollback.
// O COMPORTAMENTO (a conta de `dinheiro_a_devolver` bate com a lista "Devolver agora" da tela de Pedidos, a receita liquida e a do fin_dre,
// o JSON fora das duas chaves novas e identico ao do corpo anterior, pre-voo, ACL, rollback, atomicidade e idempotencia) e' provado em
// tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o vigente (painel_inicio da 20261399300000) mais SO as adicoes declaradas; o corpo do rollback tem de ser o
// vigente BYTE A BYTE; atributos e ACL nao mudam (nenhum GRANT/REVOKE); o pre-voo vem antes da troca e a conferencia depois; sem BEGIN/COMMIT
// de nivel superior; painel_inicio alimenta a tela inicial de TODAS as lojas.
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
  "20261402000000_o_inicio_mostra_o_dinheiro_a_devolver_e_a_margem_do_financeiro.sql";
const NOME_VIGENTE =
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
  vigente: "8d58e15e7410afe0d254f37f38251df4",
  novo: "b4c3665bd806ae8fe8960e5f6d9dde29",
};
const A = "154a-conferir-o-inicio-mostra-o-dinheiro-a-devolver-aplicado";
const B = "154b-antes-o-inicio-mostra-o-dinheiro-a-devolver-base-vigente";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.<nome>(` do arquivo. */
function corpoDe(sql, nome) {
  const marca = `CREATE OR REPLACE FUNCTION public.${nome}(`;
  assert.equal(sql.split(marca).length - 1, 1, `uma definicao de ${nome}`);
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const VIGENTE = corpoDe(ler(NOME_VIGENTE), "painel_inicio");
const NOVO = corpoDe(migration, "painel_inicio");

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

Deno.test("os md5 conhecidos sao os dos corpos REAIS: o vigente (20261399300000) e o novo", () => {
  assert.equal(md5(VIGENTE), H.vigente);
  assert.equal(md5(NOVO), H.novo);
});

Deno.test("o corpo novo e o vigente com SO as adicoes declaradas (v_dre unico, receita_liquida em mes, dinheiro_a_devolver) e todo o resto igual", () => {
  // Tirando cada adicao, o texto volta a ser o vigente, byte a byte (as linhas novas sao comentarios, declaracoes e a CTE).
  let voltando = NOVO;
  const tira = (de, para) => {
    assert.equal(
      voltando.split(de).length - 1,
      1,
      `trecho unico: ${de.slice(0, 60)}`,
    );
    voltando = voltando.replace(de, () => para);
  };
  tira("  v_receita_liquida numeric;\n  v_dre jsonb;\n", "");
  tira(
    / {2}-- Uma leitura so[\s\S]*?v_receita_liquida := \(v_dre ->> 'receita_liquida'\)::numeric;\n/.exec(
      voltando,
    )[0],
    "  v_lucro := (public.fin_dre(v_mes_inicio, v_mes_fim) ->> 'lucro_liquido')::numeric;\n",
  );
  tira(
    / {2}\), a_devolver AS \([\s\S]*? {5}WHERE b\.centavos > 0\n/.exec(
      voltando,
    )[0],
    "",
  );
  tira(
    "      'lucro_estimado', v_lucro,\n      'receita_liquida', v_receita_liquida\n",
    "      'lucro_estimado', v_lucro\n",
  );
  tira(
    / {4}-- Dinheiro a devolver \(20261402000000\)[\s\S]*? {6}'pedidos', \(SELECT count\(\*\) FROM a_devolver WHERE resto > 0\)\n {4}\),\n/.exec(
      voltando,
    )[0],
    "",
  );
  assert.equal(voltando, VIGENTE);
});

Deno.test("a conta nova le so o que a lista Devolver agora le: pedido cancelado e pago, devolucoes concluidas manuais, order_refunds; nada e escrito", () => {
  const sem = NOVO.replace(/\s+/g, " ");
  for (const trecho of [
    "o.status = 'cancelled'",
    "o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega')",
    "NOT (COALESCE(o.cancelled_after_shipping, false) AND o.returned_to_seller_at IS NULL)",
    "dv.status = 'concluida' AND dv.reembolso_manual",
    "r.status IN ('solicitado', 'em_processamento')",
    "r.status = 'concluido'",
  ])
    assert.ok(sem.includes(trecho), `falta ${trecho}`);
  assert.doesNotMatch(
    limpo(NOVO),
    /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/i,
  );
});

Deno.test("so aditiva: sem DROP, ALTER, GRANT, REVOKE nem escrita fora do CREATE OR REPLACE da funcao e dos DO de pre-voo e conferencia", () => {
  const semComentarios = limpo(migration);
  assert.doesNotMatch(
    semComentarios,
    /\b(DROP|ALTER|TRUNCATE|GRANT|REVOKE|INSERT INTO|DELETE FROM|UPDATE public)\b/i,
  );
  const codigo = migration
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.equal(codigo.split("CREATE OR REPLACE FUNCTION").length - 1, 1);
  assert.ok(
    codigo.indexOf("$preflight_20261402$") <
      codigo.indexOf("CREATE OR REPLACE FUNCTION"),
  );
  assert.ok(
    codigo.indexOf("CREATE OR REPLACE FUNCTION") <
      codigo.indexOf("$conferencia_20261402$"),
  );
});

Deno.test("o rollback devolve o corpo da 20261399300000 BYTE A BYTE, exige o corpo desta e confere o vigente depois", () => {
  assert.equal(corpoDe(rollback, "painel_inicio"), VIGENTE);
  assert.equal(md5(corpoDe(rollback, "painel_inicio")), H.vigente);
  assert.ok(
    rollback.includes(`IS DISTINCT FROM '${H.novo}'`),
    "o pre-voo do rollback exige o corpo novo",
  );
  assert.ok(
    rollback.includes(`IS DISTINCT FROM '${H.vigente}'`),
    "a conferencia do rollback exige o vigente",
  );
  // O CREATE OR REPLACE do rollback e' o MESMO texto da migration anterior (cabecalho incluso).
  const marca = "CREATE OR REPLACE FUNCTION public.painel_inicio()";
  const doVigente = ler(NOME_VIGENTE);
  const fim = "\n$$;\n";
  const ini = doVigente.indexOf(marca);
  const funcao = doVigente.slice(ini, doVigente.indexOf(fim, ini) + fim.length);
  assert.ok(
    rollback.includes(funcao),
    "o rollback nao carrega a funcao da 20261399300000 inteira",
  );
});

Deno.test("o pre-voo cita (vigente, desta), recusa por conteudo, atributos e ACL, e exige fin_dre com as duas chaves", () => {
  assert.ok(migration.includes(`', '${H.vigente}', '${H.novo}')`));
  for (const marca of [
    "B1_BASELINE_DIVERGENT: corpo vivo de painel_inicio",
    "B1_BASELINE_DIVERGENT: atributos de painel_inicio",
    "B1_BASELINE_DIVERGENT: ACL de painel_inicio",
    "B1_BASELINE_DIVERGENT: o fin_dre vivo nao devolve lucro_liquido e receita_liquida",
    "'public.order_refunds'",
    "'devolucoes.reembolso_manual'",
  ])
    assert.ok(migration.includes(marca), `falta ${marca}`);
});

Deno.test("scripts/db-apply.cjs tem entrada NOVA para a 20261402000000, e cada marcador aparece UMA vez no corpo novo", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.ok(
    entrada,
    "sem entrada em VERIFICACOES o apply da migration nao confere o corpo",
  );
  assert.equal(entrada.length, 1);
  assert.equal(entrada[0].funcao, "painel_inicio");
  for (const m of entrada[0].esperado)
    assert.equal(
      NOVO.split(m.texto).length - 1,
      m.vezes,
      `marcador: ${m.texto}`,
    );
});

Deno.test("publicacao: lote de apply normal 154a/154b, rol fechado de 5 linhas, so catalogo, cita os md5 certos, registrado nos dois workflows e na lista de rol fechado", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261402000000"),
  );
  assert.equal(lote.length, 1, "UM lote para a 20261402000000");
  assert.deepEqual(lote[0].versoes, ["20261402000000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  assert.ok(!("backfillLedger" in lote[0]) && !("nuncaAplicar" in lote[0]));
  const a = lerRepo(`scripts/publicacao/consultas/${A}.sql`);
  const b = lerRepo(`scripts/publicacao/consultas/${B}.sql`);
  assert.ok(a.includes(`'${H.novo}'`) && !b.includes(`'${H.novo}'`));
  assert.ok(b.includes(`'${H.vigente}'`) && !a.includes(`'${H.vigente}'`));
  for (const sql of [a, b]) {
    const semComentarios = limpo(sql);
    assert.doesNotMatch(
      semComentarios,
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      semComentarios,
      /\bFROM\s+(public\.)?(marketplace_orders|devolucoes|order_refunds|fin_lancamentos|profiles|produtos)\b/i,
    );
    assert.ok(sql.includes("md5(replace(p.prosrc, chr(13), ''))"));
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [A, B]) {
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 5, `${nome}: rol fechado de 5 linhas`);
    for (const item of rol)
      assert.ok(
        (nome.startsWith("154a") ? a : b).includes(`'${item}'`),
        `${nome}: falta a linha ${item}`,
      );
  }
  for (const wf of [
    ".github/workflows/conferir-banco-da-loja.yml",
    ".github/workflows/rpc-ci.yml",
  ])
    for (const nome of [A, B])
      assert.ok(lerRepo(wf).includes(nome), `${wf} nao registra ${nome}`);
  const liberacao = lerRepo("scripts/frota/publicar-release.mjs");
  assert.ok(liberacao.includes(`"${A}"`) && liberacao.includes(`"${B}"`));
  const rpc = lerRepo(".github/workflows/rpc-ci.yml");
  assert.ok(
    rpc.includes("tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs"),
    "o rpc-ci nao roda a prova viva",
  );
  // Um passo so por prova (o job do dinheiro cobra uma execucao por nome); os mutantes rodam DENTRO da rodada padrao da prova.
  assert.equal(
    rpc.split("tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs").length - 1,
    1,
    "a prova tem de ter UM passo no rpc-ci",
  );
  assert.ok(
    lerRepo("tests/banco/o-inicio-dinheiro-a-devolver-viva.cjs").includes(
      "await rodarMutantes(cliente, nomesDosMutantes)",
    ),
    "a rodada padrao da prova nao roda os mutantes",
  );
});

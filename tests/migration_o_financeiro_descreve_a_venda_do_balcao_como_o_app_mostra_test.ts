// @ts-nocheck
// O FINANCEIRO DESCREVE A VENDA DO BALCAO COMO O APP MOSTRA — prova offline do par 20261391200000 + rollback (cacada de 26/10/2026).
// O COMPORTAMENTO (as descricoes de 9 pedidos contra um oraculo; todas as outras colunas e as somas iguais as do corpo anterior;
// mutantes; reaplicar; rollback byte a byte; pre-voo; consultas 100a/100b) e' provado em
// tests/banco/o-financeiro-descreve-a-venda-do-balcao-viva.cjs e na venda anulada de verdade em tests/banco/anular-venda-viva.cjs.
// Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corpo novo tem de ser o da 20261177000000 com SO as tres trocas declaradas, todas DENTRO da coluna descricao (nada de
// valor, sinal, data, filtro ou join); o corpo do rollback tem de ser o da 20261177000000 BYTE A BYTE; atributos e ACL nao mudam
// (nenhum GRANT/REVOKE); sem BEGIN/COMMIT de nivel superior; a funcao alimenta o extrato, o resultado e o Inicio de TODAS as lojas.
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
  "20261391200000_o_financeiro_descreve_a_venda_do_balcao_como_o_app_mostra.sql";
const VIGENTE = "20261177000000_o_financeiro_da_loja_nasce.sql";
const A = "100a-conferir-o-financeiro-descreve-a-venda-do-balcao-aplicado";
const B = "100b-antes-o-financeiro-descreve-a-venda-do-balcao-base-vigente";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const migrationVigente = ler(VIGENTE);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

const H_VIGENTE = "ec01f5e2eff4f132aaf075951484ea8a";
const H_NOVO = "26473edd94ad6547d95de43433088304";

/** O corpo (entre as aspas de dolar) do UM `CREATE OR REPLACE FUNCTION public.fin__movimentos(` do arquivo. */
function corpoDe(sql) {
  const marca = "CREATE OR REPLACE FUNCTION public.fin__movimentos(";
  assert.equal(
    sql.split(marca).length - 1,
    1,
    "uma definicao de fin__movimentos",
  );
  const ini = sql.indexOf(marca);
  const m = /\bAS (\$\w*\$)/.exec(sql.slice(ini));
  const abre = ini + m.index + m[0].length;
  return sql.slice(abre, sql.indexOf(m[1], abre));
}
const CORPO_VIGENTE = corpoDe(migrationVigente);
const CORPO_NOVO = corpoDe(migration);

// As tres trocas, todas na expressao da coluna descricao: o corpo novo e' EXATAMENTE o vigente com elas.
const TROCAS = [
  [
    "           CASE WHEN v.canal = 'presencial' THEN 'Venda no balcão' ELSE 'Pedido' END\n" +
      "             || ' #' || upper(left(v.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(v.customer_name), ''), ''),\n",
    "           -- O número é o que o app mostra: os 6 ÚLTIMOS caracteres do id, em maiúsculas\n" +
      "           -- (src/lib/numero-do-pedido.ts). A venda do balcão sem cliente nasce com\n" +
      "           -- customer_name = 'Venda no balcão' e não repete o nome (20261391200000).\n" +
      "           CASE WHEN v.canal = 'presencial'\n" +
      "                THEN 'Venda no balcão #' || upper(right(v.id::text, 6))\n" +
      "                     || COALESCE(' · ' || NULLIF(NULLIF(btrim(v.customer_name), ''), 'Venda no balcão'), '')\n" +
      "                ELSE 'Pedido #' || upper(right(v.id::text, 6))\n" +
      "                     || COALESCE(' · ' || NULLIF(btrim(v.customer_name), ''), '') END,\n",
  ],
  [
    "           'Estorno do pedido #' || upper(left(o.id::text, 8)) || COALESCE(' · ' || NULLIF(btrim(r.motivo), ''), ''),\n",
    "           'Estorno do pedido #' || upper(right(o.id::text, 6)) || COALESCE(' · ' || NULLIF(btrim(r.motivo), ''), ''),\n",
  ],
  [
    "           'Estorno registrado fora do app · pedido #' || upper(left(v.id::text, 8)),\n",
    "           -- A venda do balcão anulada PELO APP (anular_venda_presencial, 20261204000000) deixa\n" +
      "           -- no histórico do pagamento a marca 'desfeito' de recebido_na_entrega para estornado:\n" +
      "           -- não é estorno feito fora do app. Só o texto muda (20261391200000).\n" +
      "           CASE WHEN v.canal = 'presencial' AND EXISTS (\n" +
      "                  SELECT 1 FROM public.marketplace_order_payment_history h\n" +
      "                   WHERE h.order_id = v.id AND h.acao = 'desfeito'\n" +
      "                     AND h.payment_status_antes = 'recebido_na_entrega'\n" +
      "                     AND h.payment_status_depois = 'estornado')\n" +
      "                THEN 'Venda do balcão anulada · #' || upper(right(v.id::text, 6))\n" +
      "                ELSE 'Estorno registrado fora do app · pedido #' || upper(right(v.id::text, 6)) END,\n",
  ],
];

Deno.test("1391200: avaliarFase0 nao recusa o par migration+rollback, e nenhum dos dois abre ou fecha transacao", () => {
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
  for (const sql of [migration, rollback])
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), `${n}: CRLF quebra o md5`);
});

Deno.test("1391200: o corpo vigente e' o da 20261177 (md5 conhecido) e o novo e' ele com SO as tres trocas; desfaze-las devolve o vigente byte a byte", () => {
  assert.equal(md5(CORPO_VIGENTE), H_VIGENTE);
  let esperado = CORPO_VIGENTE;
  for (const [de, para] of TROCAS) {
    assert.equal(
      esperado.split(de).length - 1,
      1,
      `o trecho antigo existe UMA vez: ${de.slice(0, 60)}`,
    );
    esperado = esperado.replace(de, () => para);
  }
  assert.equal(CORPO_NOVO, esperado, "corpo novo = vigente + as tres trocas");
  assert.equal(md5(CORPO_NOVO), H_NOVO);
  let volta = CORPO_NOVO;
  for (const [de, para] of [...TROCAS].reverse())
    volta = volta.replace(para, () => de);
  assert.equal(volta, CORPO_VIGENTE);
});

Deno.test("1391200: as tres trocas so mexem em TEXTO — cada uma e' uma expressao de descricao (termina em ',' de coluna) sem coluna de valor, data, status ou conta", () => {
  for (const [de, para] of TROCAS) {
    const codigo = para
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    assert.ok(codigo.trimEnd().endsWith(","), "uma expressao de coluna");
    assert.doesNotMatch(
      codigo,
      /\b(total|valor|valor_estornado|paid_at|created_at|data|status|payment_status\b(?!_)|conta_id|forma_pagamento|vencimento)\b/,
      "a troca nao pode ler coluna de dinheiro, data ou conta",
    );
    // o trecho antigo tambem era so texto
    assert.doesNotMatch(de, /\b(valor|total|paid_at|conta_id)\b/);
  }
  // As linhas de dinheiro que a 1b confere para a 20261177 continuam UMA vez no corpo novo.
  for (const marcador of [
    "AND o.payment_status IN ('pago', 'pago_apos_expirar', 'recebido_na_entrega', 'estornado')",
    "(v.total - COALESCE(v.valor_estornado, 0) - COALESCE(dm.valor, 0))::numeric,",
  ]) {
    assert.equal(CORPO_NOVO.split(marcador).length - 1, 1, marcador);
    assert.ok(
      lerRepo(
        "scripts/publicacao/consultas/1b-conferir-marcadores.sql",
      ).includes(marcador),
    );
  }
  // O numero do pedido sai como o app mostra (6 ultimos, maiuscula) em TODA descricao; nao sobra o formato antigo.
  assert.ok(!CORPO_NOVO.includes("left(v.id::text, 8)"));
  assert.ok(!CORPO_NOVO.includes("left(o.id::text, 8)"));
  assertNumeroDoApp();
});

function assertNumeroDoApp() {
  const ts = lerRepo("src/lib/numero-do-pedido.ts");
  assert.match(ts, /slice\(-6\)/, "o app mostra os 6 ultimos caracteres");
  assert.match(ts, /toUpperCase\(\)/, "o app mostra em maiuscula");
}

Deno.test("1391200: o rollback recria o corpo VIGENTE byte a byte; os dois arquivos citam os dois md5", () => {
  assert.equal(corpoDe(rollback), CORPO_VIGENTE);
  for (const sql of [migration, rollback])
    for (const h of [H_VIGENTE, H_NOVO]) assert.ok(sql.includes(`'${h}'`), h);
});

Deno.test("1391200: uma funcao por arquivo, com a MESMA assinatura e os MESMOS atributos da 20261177; nada de GRANT, REVOKE, DROP, ALTER nem DML fora do corpo", () => {
  const cabecalho =
    "CREATE OR REPLACE FUNCTION public.fin__movimentos(p_inicio date, p_fim date)\n" +
    "RETURNS TABLE (\n" +
    "  id text, origem text, tipo text, status text, valor numeric, data date,\n" +
    "  conta_id uuid, conta_destino_id uuid, categoria_id uuid, descricao text,\n" +
    "  forma_pagamento text, pedido_id uuid, vencimento date, data_competencia date,\n" +
    "  editavel boolean, canal text, caixa_sessao_id uuid, parcela smallint, parcelas smallint\n" +
    ")\n" +
    "LANGUAGE sql STABLE SET search_path = public\n" +
    "AS $$";
  assert.ok(migrationVigente.includes(cabecalho));
  for (const sql of [migration, rollback]) {
    assert.ok(sql.includes(cabecalho), "assinatura e atributos de sempre");
    const fora = limpo(sql.replace(corpoDe(sql), ""));
    assert.doesNotMatch(fora, /\b(GRANT|REVOKE)\b/i);
    assert.doesNotMatch(
      fora,
      /\b(DROP|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
    );
    assert.doesNotMatch(
      fora,
      /\bCREATE\s+(TABLE|POLICY|INDEX|TRIGGER|VIEW)\b/i,
    );
    assert.doesNotMatch(fora, /\b(VOLATILE|IMMUTABLE|SECURITY DEFINER)\b/i);
  }
});

Deno.test("1391200: o pre-voo vem antes da troca e a conferencia depois; o pre-voo aceita SO os dois corpos e confere atributos e ACL", () => {
  const iPre = migration.indexOf("DO $preflight_20261391200000$");
  const fimPre = migration.indexOf("END $preflight_20261391200000$;");
  const iCria = migration.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConf = migration.indexOf("DO $conferencia_20261391200000$");
  assert.ok(iPre >= 0 && fimPre > iPre && fimPre < iCria && iCria < iConf);
  const iLock = migration.indexOf("SET LOCAL lock_timeout = '5s';");
  assert.ok(iLock >= 0 && iLock < iPre);
  const pre = migration.slice(iPre, fimPre);
  for (const trecho of [
    "md5(replace(",
    `'${H_VIGENTE}'`,
    `'${H_NOVO}'`,
    "B1_BASELINE_DIVERGENT",
    "to_jsonb(p) - 'prosrc'",
  ])
    assert.ok(pre.includes(trecho), trecho);
  const iPreR = rollback.indexOf("DO $preflight_rollback_20261391200000$");
  const iCriaR = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  const iConfR = rollback.indexOf("DO $conferencia_rollback_20261391200000$");
  assert.ok(iPreR >= 0 && iPreR < iCriaR && iCriaR < iConfR);
  assert.ok(rollback.slice(iPreR, iCriaR).includes(`'${H_NOVO}'`));
  assert.ok(rollback.slice(iPreR, iCriaR).includes("B1_BASELINE_DIVERGENT"));
  assert.ok(rollback.slice(iConfR).includes(`'${H_VIGENTE}'`));
});

Deno.test("1391200: so a 20261177 e este par definem fin__movimentos", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const definem = todas.filter((n) =>
    /create (?:or replace )?function public\.fin__movimentos\b/.test(
      limpo(ler(n)).toLowerCase(),
    ),
  );
  assert.deepEqual(
    definem.sort(),
    [VIGENTE, NOME, `rollback-manual-${NOME}`].sort(),
  );
});

Deno.test("1391200: publicacao — lote unico (100a/100b), rol fechado de 4 linhas, consultas so de catalogo com os md5 certos, workflows, release, aplicador e prova viva", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261391200000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261391200000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const a = lerRepo(`scripts/publicacao/consultas/${A}.sql`);
  const b = lerRepo(`scripts/publicacao/consultas/${B}.sql`);
  assert.ok(a.includes(`'${H_NOVO}'`) && !a.includes(`'${H_VIGENTE}'`));
  assert.ok(b.includes(`'${H_VIGENTE}'`) && !b.includes(`'${H_NOVO}'`));
  for (const sql of [a, b]) {
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bfin__movimentos\s*\(/i,
      "a consulta nao executa a funcao",
    );
  }
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const [nome, sql] of [
    [A, a],
    [B, b],
  ]) {
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 4, nome);
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
  for (const viva of [
    "tests/banco/o-financeiro-descreve-a-venda-do-balcao-viva.cjs",
    "tests/banco/anular-venda-viva.cjs",
  ])
    assert.ok(
      lerRepo(".github/workflows/rpc-ci.yml").includes(
        `run: node tests/banco/rodar-isolado.cjs ${viva}`,
      ),
    );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-financeiro-descreve-a-venda-do-balcao-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = new Map(Object.entries(VERIFICACOES)).get(NOME);
  assert.equal(entrada.funcao, "fin__movimentos");
  for (const { texto, vezes } of entrada.esperado)
    assert.equal(CORPO_NOVO.split(texto).length - 1, vezes, texto);
});

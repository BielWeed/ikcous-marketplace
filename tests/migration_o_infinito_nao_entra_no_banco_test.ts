// @ts-nocheck
// O INFINITO NAO ENTRA NO BANCO — prova offline do par 20261560000000 + rollback (fecha o "+Infinity fica para outra frente" da
// 20261400000000, secao 4). O COMPORTAMENTO (Infinity e -Infinity recusados com 23514 em todas as portas; finitos, zero e NULL de
// variacao aceitos; NaN segue recusado pela 400; linha antiga infinita faz a migration se recusar; mutantes; reaplicar; rollback;
// pre-voo; consultas 193a/193b) e' provado em tests/banco/o-infinito-nao-entra-no-banco-viva.cjs. Aqui fica o que se prova so
// lendo o texto.
//
// Riscos: a migration so CRIA tres restricoes novas (nenhum dado escrito, nenhuma restricao antiga tocada); as colunas cobertas
// tem de ser EXATAMENTE as numeric SEM precisao entre as quatro da 400 (numeric(p,s) ja recusa infinito no proprio tipo).
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const VERSAO = "20261560000000";
const NOME = `${VERSAO}_o_infinito_nao_entra_no_banco.sql`;
const NOME_400 = "20261400000000_valores_negativos_nao_entram_no_banco.sql";
const A = "193a-conferir-o-infinito-nao-entra-no-banco-aplicado";
const B = "193b-antes-o-infinito-nao-entra-no-banco-ausente";
const PROVA_VIVA = "tests/banco/o-infinito-nao-entra-no-banco-viva.cjs";
// As SUCESSORAS: migrations que nasceram depois desta (em ordem), cada uma com o seu lote no canais. Uma migration
// nova depois da 1560 entra aqui de proposito, nunca por afrouxar o "e' a maior da raiz".
const SUCESSORAS = [
  // 20261570000000: o endereco antigo encaminha para o novo (a troca de dominio).
  {
    versao: "20261570000000",
    consulta: "194a-conferir-o-endereco-antigo-encaminha-aplicado",
  },
  // 20261590000000: a loja guarda o dia da pausa do teste (PR do aviso de teste encerrado).
  {
    versao: "20261590000000",
    consulta: "195a-conferir-a-loja-guarda-o-dia-da-pausa-do-teste-aplicado",
  },
  // 20261600000000: a loja pausa o pedido novo (lote 1 da pausa de vendas).
  {
    versao: "20261600000000",
    consulta: "196a-conferir-a-loja-pausa-o-pedido-novo-aplicado",
  },
  // 20261610000000: o catalogo e a configuracao chegam ao vivo em toda loja (a publicacao do realtime).
  {
    versao: "20261610000000",
    consulta: "197a-conferir-o-catalogo-chega-ao-vivo-aplicado",
  },
  // 20261620000000: a soma das categorias fecha com o faturamento no centavo (vendas por categoria).
  {
    versao: "20261620000000",
    consulta: "198a-conferir-a-soma-das-categorias-fecha-no-centavo-aplicado",
  },
  // 20261630000000: a loja ja suspensa tambem pausa (sucessora da marca da 20261600000000).
  {
    versao: "20261630000000",
    consulta: "199a-conferir-a-loja-ja-suspensa-tambem-pausa-aplicado",
  },
  // 20261640000000: a devolucao com a mesma chave nao paga duas vezes (solicitar_estorno_com_chave).
  {
    versao: "20261640000000",
    consulta:
      "200a-conferir-a-devolucao-com-a-mesma-chave-nao-paga-duas-vezes-aplicado",
  },
];
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
/** O SQL sem os comentarios de linha, mas COM o corpo dos blocos DO (os ALTER moram dentro de um). */
const codigo = (s) =>
  s
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");

// A regra de cada coluna, como o Postgres a devolve em pg_get_constraintdef (a mesma em pre-voo, conferencia, rollback e 193a).
const ALVOS = [
  {
    tabela: "store_config",
    coluna: "local_delivery_fee",
    ck: "store_config_local_delivery_fee_finito",
    regra:
      "local_delivery_fee <> 'Infinity'::numeric AND local_delivery_fee <> '-Infinity'::numeric",
    def: "CHECK (((local_delivery_fee <> 'Infinity'::numeric) AND (local_delivery_fee <> '-Infinity'::numeric)))",
  },
  {
    tabela: "product_variants",
    coluna: "price_override",
    ck: "product_variants_price_override_finito",
    regra:
      "price_override IS NULL OR (price_override <> 'Infinity'::numeric AND price_override <> '-Infinity'::numeric)",
    def: "CHECK (((price_override IS NULL) OR ((price_override <> 'Infinity'::numeric) AND (price_override <> '-Infinity'::numeric))))",
  },
  {
    tabela: "coupons",
    coluna: "value",
    ck: "coupons_value_finito",
    regra: "value <> 'Infinity'::numeric AND value <> '-Infinity'::numeric",
    def: "CHECK (((value <> 'Infinity'::numeric) AND (value <> '-Infinity'::numeric)))",
  },
];
// No literal SQL (dentro de '...'), a aspa simples vem dobrada.
const emLiteral = (s) => s.replaceAll("'", "''");

Deno.test("1560: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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

Deno.test("1560: depois dela so as SUCESSORAS conhecidas, em ordem", () => {
  const versoes = [];
  for (const e of Deno.readDirSync(new URL("supabase/migrations/", DIR)))
    if (e.isFile && /^\d{14}_.+\.sql$/.test(e.name))
      versoes.push(e.name.slice(0, 14));
  versoes.sort();
  // Sucessoras conhecidas (cada uma com o proprio teste): so elas podem vir depois, e todas, na ordem.
  assert.deepEqual(
    versoes.slice(versoes.indexOf(VERSAO) + 1),
    SUCESSORAS.map((s) => s.versao),
  );
  assert.equal(versoes.filter((v) => v === VERSAO).length, 1);
});

Deno.test("1560: cobre EXATAMENTE as colunas numeric SEM precisao das quatro da 400 (numeric(p,s) ja recusa infinito no tipo)", () => {
  // As quatro colunas da 400 saem do proprio texto dela (pre-voo), nao de uma lista copiada aqui.
  const m400 = ler(NOME_400);
  const pre400 = m400.slice(
    m400.indexOf("DO $preflight_20261400000000$"),
    m400.indexOf("END $preflight_20261400000000$"),
  );
  const colunas400 = [
    ...pre400.matchAll(/\('(\w+)', '(\w+)', '\w+_nao_negativo',/g),
  ].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual(colunas400.sort(), [
    "coupons.value",
    "product_variants.price_override",
    "produtos.preco_venda",
    "store_config.local_delivery_fee",
  ]);
  // O tipo de cada uma no baseline; nenhuma migration viva mudou o tipo delas depois.
  const baseline = ler("20260806000000_baseline_do_schema_vivo.sql");
  const tipoNoBaseline = (tabela, coluna) => {
    const ini = baseline.indexOf(`CREATE TABLE public.${tabela} (`);
    assert.ok(ini >= 0, tabela);
    const corpo = baseline.slice(ini, baseline.indexOf("\n);", ini));
    const linha = corpo
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(`${coluna} `));
    assert.ok(linha, `${tabela}.${coluna} nao achada no baseline`);
    // "coluna tipo[ DEFAULT ...][ NOT NULL]," -> o segundo pedaco e' o tipo (numeric ou numeric(p,s))
    const tipo = linha.replace(/,$/, "").split(" ")[1];
    assert.ok(
      tipo.startsWith("numeric"),
      `${tabela}.${coluna}: tipo nao e numeric (${linha})`,
    );
    return tipo;
  };
  const semPrecisao = colunas400
    .filter((tc) => {
      const [t, c] = tc.split(".");
      return tipoNoBaseline(t, c) === "numeric";
    })
    .sort();
  assert.deepEqual(
    semPrecisao,
    ALVOS.map((a) => `${a.tabela}.${a.coluna}`).sort(),
  );
  assert.equal(tipoNoBaseline("produtos", "preco_venda"), "numeric(10,2)");
  for (const e of Deno.readDirSync(new URL("supabase/migrations/", DIR))) {
    if (!e.isFile || !e.name.endsWith(".sql")) continue;
    const sql = codigo(ler(e.name));
    assert.doesNotMatch(
      sql,
      /ALTER COLUMN (local_delivery_fee|price_override|preco_venda|value) (SET DATA )?TYPE/i,
      `${e.name} muda o tipo de uma coluna de dinheiro: revise a cobertura da 1560`,
    );
  }
  // e o pre-voo exige que preco_venda continue com precisao (se perder, a 1560 tem de cobri-la e recusa aplicar)
  const pre = migration.slice(
    migration.indexOf(`DO $preflight_${VERSAO}$`),
    migration.indexOf(`END $preflight_${VERSAO}$`),
  );
  assert.ok(pre.includes("public.produtos.preco_venda"));
  assert.ok(pre.includes("a.atttypmod <> -1"));
});

Deno.test("1560: a migration so CRIA as tres restricoes novas, validadas — sem DROP, DML, GRANT/REVOKE, CREATE, VALIDATE nem NOT VALID; nao toca nas da 400", () => {
  const c = codigo(migration);
  // sem os literais de texto (a mensagem da guarda fala em "UPDATE dela", e isso nao e' comando)
  const semTexto = c.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(semTexto, /\bDROP\b/i);
  assert.doesNotMatch(
    semTexto,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(c, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(c, /\bVALIDATE\b/i);
  assert.doesNotMatch(c, /\bCREATE\b/i);
  assert.doesNotMatch(c, /NOT VALID\s*;/i);
  assert.doesNotMatch(
    c,
    /_nao_negativo/,
    "as restricoes da 400 sao intocaveis",
  );
  assert.equal((c.match(/\bALTER TABLE\b/g) ?? []).length, ALVOS.length);
  let ultimo = -1;
  for (const a of ALVOS) {
    const alter = `ALTER TABLE public.${a.tabela} ADD CONSTRAINT ${a.ck} CHECK (${a.regra});`;
    const i = c.indexOf(alter);
    assert.ok(i >= 0, `falta: ${alter}`);
    // ordem de trava da compra: store_config, variacoes, cupons
    assert.ok(i > ultimo, `fora de ordem: ${a.ck}`);
    ultimo = i;
    // so cria se ainda nao existe (reaplicar e' no-op)
    assert.ok(
      c.includes(
        `c.conrelid = 'public.${a.tabela}'::regclass AND c.conname = '${a.ck}') THEN ${alter}`,
      ),
      a.ck,
    );
  }
});

Deno.test("1560: pre-voo, guarda, criacao e conferencia nessa ordem; a mesma regra no pre-voo, na conferencia, no rollback e na 193a", () => {
  const iPre = migration.indexOf(`DO $preflight_${VERSAO}$`);
  const iGuarda = migration.indexOf(`DO $guarda_${VERSAO}$`);
  const iCria = migration.indexOf(`DO $restricoes_${VERSAO}$`);
  const iConf = migration.indexOf(`DO $conferencia_${VERSAO}$`);
  assert.ok(iPre >= 0 && iPre < iGuarda && iGuarda < iCria && iCria < iConf);
  const pre = migration.slice(iPre, iGuarda);
  const guarda = migration.slice(iGuarda, iCria);
  const conf = migration.slice(iConf);
  assert.ok(pre.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(guarda.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(conf.includes(`conferencia ${VERSAO}`));
  const a193 = lerRepo(`scripts/publicacao/consultas/${A}.sql`);
  for (const a of ALVOS) {
    const def = emLiteral(a.def);
    for (const [nome, trecho] of [
      ["pre-voo", pre],
      ["conferencia", conf],
      ["rollback", rollback],
      ["193a", a193],
    ])
      assert.ok(trecho.includes(`'${def}'`), `${nome}: ${a.ck}`);
    // a guarda conta a mesma expressao da restricao (NULL nao conta)
    assert.ok(
      guarda.includes(`FROM public.${a.tabela} WHERE NOT (${a.regra})`),
      `guarda: ${a.ck}`,
    );
  }
  // o cabecalho traz a medicao previa, so leitura, para rodar a mao em cada loja
  for (const a of ALVOS)
    assert.ok(
      migration.includes(
        `--     (SELECT count(*) FROM public.${a.tabela} WHERE NOT (${a.regra}))`,
      ),
      a.tabela,
    );
});

Deno.test("1560: o rollback tira so as tres restricoes NOVAS, com pre-voo antes de apagar e conferencia final", () => {
  const c = codigo(rollback);
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, ALVOS.length);
  for (const a of ALVOS)
    assert.ok(
      c.includes(
        `ALTER TABLE public.${a.tabela} DROP CONSTRAINT IF EXISTS ${a.ck};`,
      ),
      a.ck,
    );
  assert.doesNotMatch(c, /_nao_negativo/, "o rollback nao toca nas da 400");
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf(`DO $preflight_rollback_${VERSAO}$`);
  const iApaga = rollback.indexOf("\nALTER TABLE public.store_config DROP");
  const iConf = rollback.indexOf(`DO $conferencia_rollback_${VERSAO}$`);
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1560: publicacao — lote unico (193a/193b), rol fechado, consultas so de catalogo, workflows, release e prova viva no job do dinheiro", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    (p.versoes ?? []).includes(VERSAO),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, [VERSAO]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  // lotes novos vao no fim, sem reordenar: depois deste so os das SUCESSORAS, na ordem delas
  assert.deepEqual(
    canais.provasDeObjetos
      .slice(-(SUCESSORAS.length + 1))
      .map((p) => p.consulta),
    [A, ...SUCESSORAS.map((s) => s.consulta)],
  );
  const politica = JSON.parse(lerRepo("scripts/frota/politica.json"));
  assert.ok(
    !politica.migrationsForaDaRelease.some((m) => m.versao === VERSAO),
    "estar no lote e fora da release daria duas decisoes",
  );
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const rpcCi = lerRepo(".github/workflows/rpc-ci.yml");
  for (const nome of [A, B]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+public\.(store_config|product_variants|coupons|produtos)\b/i,
      "so catalogo: nao le dado da loja",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.ok(rol, nome);
    assert.equal(new Set(rol).size, rol.length, `${nome}: item repetido`);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
    assert.ok(
      lerRepo("scripts/frota/publicar-release.mjs").includes(`"${nome}"`),
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}\n`,
      ),
    );
    assert.equal(rpcCi.split(`consultas/${nome}.sql`).length - 1, 2);
  }
  // a prova viva roda no job do dinheiro, num clone proprio, e esta na lista por nome e no LEIA-ME
  const inicio = rpcCi.indexOf("\n  contrato-dinheiro:\n");
  const fim = rpcCi.indexOf("\n  provas-informacionais:\n");
  assert.ok(
    rpcCi
      .slice(inicio, fim)
      .includes(`run: node tests/banco/rodar-isolado.cjs ${PROVA_VIVA}`),
  );
  assert.ok(
    lerRepo(
      "tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts",
    ).includes(`"${PROVA_VIVA}"`),
  );
  assert.ok(lerRepo("tests/banco/LEIA-ME.md").includes(PROVA_VIVA.slice(12)));
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  assert.equal(new Map(Object.entries(VERIFICACOES)).get(NOME), undefined);
});

// A medicao 193m: quantos valores infinitos JA ESTAO guardados nas tres colunas, em cada loja, ANTES do apply (a guarda da
// migration recusaria a loja). Rol fechado com `ok` (contagem = 0), so contagens, a mesma regra da guarda; NAO e' portao.
const M = "193m-medir-infinitos-guardados";
const ITENS_193M = [
  "controle: a RLS nao vale para quem leu em store_config, product_variants e coupons (a contagem e da loja inteira)",
  "store_config.local_delivery_fee: linhas com Infinity ou -Infinity ja guardado",
  "product_variants.price_override: linhas com Infinity ou -Infinity ja guardado (NULL nao conta)",
  "coupons.value: linhas com Infinity ou -Infinity ja guardado",
];
Deno.test("1560: a medicao 193m — rol fechado so de contagens, a mesma regra da guarda, no menu e no rpc-ci, fora dos lotes", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    contarStatements,
    listarConsultas,
    veredictoDaConsulta,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    new URL("scripts/frota/publicar-release.mjs", DIR).href
  );
  assert.ok(listarConsultas().includes(M), `falta a consulta ${M}`);
  const sql = lerRepo(`scripts/publicacao/consultas/${M}.sql`);
  const semComentario = codigo(sql);
  assert.equal(contarStatements(sql), 1);
  assert.match(semComentario.trim(), /^WITH\b/);
  assert.doesNotMatch(
    limpo(sql),
    /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK|SET|BEGIN|COMMIT|INTO)\b/i,
  );
  // rol fechado: o mesmo rol no conferir-banco e no portao, item por item no texto
  assert.deepEqual(
    new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(M),
    ITENS_193M,
  );
  assert.ok(CONSULTAS_DE_ROL_FECHADO.has(M));
  for (const item of ITENS_193M) assert.ok(sql.includes(`'${item}'`), item);
  // so contagens: toda leitura de tabela da loja e' um count(*) com a regra EXATA da guarda (NULL, NaN e finito nao contam)
  const guarda = migration.slice(
    migration.indexOf(`DO $guarda_${VERSAO}$`),
    migration.indexOf(`DO $restricoes_${VERSAO}$`),
  );
  assert.equal(
    (semComentario.match(/\bFROM\s+public\./gi) ?? []).length,
    ALVOS.length,
  );
  for (const a of ALVOS) {
    const leitura = `(SELECT count(*) FROM public.${a.tabela} WHERE NOT (${a.regra}))::text`;
    assert.ok(semComentario.includes(leitura), `193m: ${a.tabela}`);
    assert.ok(
      guarda.includes(`FROM public.${a.tabela} WHERE NOT (${a.regra})`),
      `guarda: ${a.tabela}`,
    );
  }
  assert.doesNotMatch(
    semComentario,
    /\b(code|id|nome|name|store_name|description)\b\s*(,|FROM|::)/i,
  );
  assert.ok(semComentario.includes("COALESCE(vivo = esperado, false) AS ok"));
  // o veredito: tudo 0 = ok_false=0 com rol=ok; uma coluna com 1 = ok_false=1, ainda rol=ok (a resposta veio inteira)
  const linhas = ITENS_193M.map((item, i) => ({
    item,
    esperado: i === 0 ? "sim" : "0",
    vivo: i === 0 ? "sim" : "0",
    ok: true,
  }));
  const veredito = (l) =>
    veredictoDaConsulta({
      consulta: M,
      ref: "aaaaaaaaaaaaaaaaaaaa",
      linhas: l,
    });
  assert.ok(
    veredito(linhas).endsWith("linhas=4 ok_false=0 ok_nao_booleano=0 rol=ok"),
  );
  const comUm = linhas.map((l, i) =>
    i === 1 ? { ...l, vivo: "1", ok: false } : l,
  );
  assert.ok(
    veredito(comUm).endsWith("linhas=4 ok_false=1 ok_nao_booleano=0 rol=ok"),
  );
  assert.ok(veredito(linhas.slice(1)).endsWith("rol=invalido"));
  // menu, rpc-ci (as duas listas de paths) e a prova viva que a EXECUTA
  assert.ok(
    lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
      `- ${M}\n`,
    ),
  );
  assert.equal(
    lerRepo(".github/workflows/rpc-ci.yml").split(
      `"scripts/publicacao/consultas/${M}.sql"`,
    ).length - 1,
    2,
  );
  assert.ok(lerRepo(PROVA_VIVA).includes(`"${M}"`));
  // medicao, nao portao: nenhum lote do canais-de-backend.json a cita (a decisao de tirar da release e' de quem le)
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  for (const p of canais.provasDeObjetos)
    assert.ok(
      ![
        p.consulta,
        p.ausenciaConfirmadaPor,
        ...(p.conferenciasAntesDoApply ?? []),
      ].includes(M),
      p.consulta,
    );
});

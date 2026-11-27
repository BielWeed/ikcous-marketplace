// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A PECA QUE VOLTA SEM TAMANHO ESPERA A LOJISTA — leitura do TEXTO da 20261642000000 e do rollback dela.
// O COMPORTAMENTO (o defeito com os corpos de antes, a matriz diferencial, a devolucao, a decisao idempotente, duas conexoes reais, o Salvar
// recusado pela versao, os mutantes, reaplicar, pre-voo, rollback e as consultas 201a/201b) e' provado no Postgres efemero por
// tests/banco/a-peca-que-volta-sem-tamanho-viva.cjs; aqui ficam as ancoras que se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM backfill;
//   - os dois corpos novos sao os vigentes (389 e 395) com SO a troca declarada, byte a byte;
//   - os md5 do pre-voo, do pos-voo, do rollback e das consultas sao os dos corpos que os arquivos carregam;
//   - o rollback devolve os blocos da 389 e da 395 BYTE A BYTE, passa a Fase 0 e nao apaga dado;
//   - as RPCs novas tem as portas do painel e a ordem global das travas; a tabela nasce fechada;
//   - a migration esta ligada na release (canais, consultas, conferir-banco, rpc-ci, db-apply, portas).
import { createHash } from "node:crypto";
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

const DIR = fromFileUrl(new URL(".", import.meta.url));
const RAIZ = `${DIR}..`;
const NOME = "20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql";
const NOME_389 =
  "20261389100000_o_estoque_que_volta_tranca_na_mesma_ordem_da_compra.sql";
const NOME_395 =
  "20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m389 = lerMig(NOME_389);
const m395 = lerMig(NOME_395);
const semComentario = (s: string) => s.replace(/--.*$/gm, "");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const bloco = (sql: string, inicio: string, fim: string) => {
  const i = sql.indexOf(inicio);
  assert(i >= 0, `bloco ausente: ${inicio}`);
  assertEquals(sql.indexOf(inicio, i + 1), -1, `bloco repetido: ${inicio}`);
  return sql.slice(i, sql.indexOf(fim, i) + fim.length);
};
const corpo = (b: string, tag: string) => {
  const a = b.indexOf(`AS ${tag}`) + `AS ${tag}`.length;
  return b.slice(a, b.indexOf(tag, a));
};
const DEV = [
  "CREATE OR REPLACE FUNCTION public.devolver_estoque(p_order_id uuid)",
  "\n$devolver$;",
];
const CONCL = [
  "CREATE OR REPLACE FUNCTION public.admin_devolucao_concluir(",
  "\n$$;",
];
const PEND = [
  "CREATE OR REPLACE FUNCTION public.pecas_sem_tamanho_pendentes(",
  "\n$pendentes$;",
];
const RES = [
  "CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(",
  "\n$resolver$;",
];

const dev389 = bloco(m389, DEV[0], DEV[1]);
const concl395 = bloco(m395, CONCL[0], CONCL[1]);
const devNovo = bloco(migration, DEV[0], DEV[1]);
const conclNovo = bloco(migration, CONCL[0], CONCL[1]);
const pend = bloco(migration, PEND[0], PEND[1]);
const res = bloco(migration, RES[0], RES[1]);

const H_DEV_389 = "943b226906e91013e7cccf4992617e35";
const H_CONCL_395 = "a152c8dcd7cf6d1e05e5aff128d6c45e";
const H_DEV = md5(corpo(devNovo, "$devolver$"));
const H_CONCL = md5(corpo(conclNovo, "$$"));
const H_PEND = md5(corpo(pend, "$pendentes$"));
const H_RES = md5(corpo(res, "$resolver$"));
const FORMA =
  "criada_em:timestamp with time zone:true,devolucao_item_id:uuid:false,id:uuid:true,order_id:uuid:false,order_item_id:uuid:false,origem:text:true,produto_id:uuid:true,resolucao:text:false,resolvida_em:timestamp with time zone:false,resolvida_por:uuid:false,variant_id:uuid:false";
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};

Deno.test("20261642: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, e passa a Fase 0", () => {
  for (const [rotulo, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const t = detectarTransacaoExplicita(removerRuido(sql));
    assertEquals(t.achados, [], `${rotulo}: ${t.achados.join("/")}`);
    assertStringIncludes(sql, "SET LOCAL lock_timeout = '5s';");
    assertStringIncludes(sql, "SET LOCAL statement_timeout = '30s';");
    assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"), rotulo);
  }
  for (const arq of [NOME, `rollback-manual-${NOME}`])
    assert(
      !Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).includes(
        "\r",
      ),
      `${arq}: LF`,
    );
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("20261642: os corpos de partida ainda sao os vigentes (389 e 395)", () => {
  assertEquals(md5(corpo(dev389, "$devolver$")), H_DEV_389);
  assertEquals(md5(corpo(concl395, "$$")), H_CONCL_395);
});

Deno.test("20261642: devolver_estoque novo = o da 389 com SO o ramo marcado, byte a byte (cabecalho igual)", () => {
  const ini = devNovo.indexOf(
    "        -- >>> a peca que volta sem tamanho (20261642000000)\n",
  );
  const marcaFim =
    "        -- <<< a peca que volta sem tamanho (20261642000000)\n";
  const fim = devNovo.indexOf(marcaFim) + marcaFim.length;
  assert(ini > 0 && fim > ini, "o ramo marcado nao foi achado");
  assertEquals(devNovo.slice(0, ini) + devNovo.slice(fim), dev389);
  // o ramo fica ENTRE o da variacao e o do pai, e usa o MESMO predicado da compra (variacao ligada do mesmo produto)
  const ramo = devNovo.slice(ini, fim);
  assert(devNovo.indexOf("WHERE id = v_item.variant_id;") < ini);
  assert(
    devNovo.indexOf("        ELSE\n            UPDATE public.produtos", fim) ===
      fim,
  );
  assertStringIncludes(
    ramo,
    "ELSIF EXISTS (SELECT 1 FROM public.product_variants v\n                       WHERE v.product_id = v_item.product_id AND v.active = true) THEN",
  );
  assertStringIncludes(
    ramo,
    "INSERT INTO public.pecas_sem_tamanho (produto_id, order_id, order_item_id, origem)\n            SELECT v_item.product_id, p_order_id, v_item.id, 'pedido_desfeito'\n              FROM generate_series(1, v_credito);\n            CONTINUE;",
  );
  // a unica escrita nova e' no cantinho: o ramo nao mexe em produtos nem em variacoes
  assert(!/UPDATE\s+public\./i.test(semComentario(ramo)));
});

Deno.test("20261642: admin_devolucao_concluir novo = o da 395 com SO a variavel, o ramo marcado e o retorno, byte a byte", () => {
  const ini = conclNovo.indexOf(
    "      -- >>> a peca que volta sem tamanho (20261642000000)\n",
  );
  const marcaFim =
    "      -- <<< a peca que volta sem tamanho (20261642000000)\n";
  const fim = conclNovo.indexOf(marcaFim) + marcaFim.length;
  assert(ini > 0 && fim > ini, "o ramo marcado nao foi achado");
  const ramo = conclNovo.slice(ini, fim);
  let volta = conclNovo.slice(0, ini) + conclNovo.slice(fim);
  const decl =
    "  -- 20261642000000: unidades que foram para o cantinho das pecas sem tamanho (nao creditadas).\n  v_sem_tamanho integer := 0;\n";
  assertEquals(volta.split(decl).length, 2, "a variavel nova aparece 1x");
  volta = volta.replace(decl, "");
  const retornoNovo =
    "    'refund_id', v_refund_id, 'reembolso_manual', v_manual,\n    -- 20261642000000: 'reestocados' conta so o que voltou A VENDA; as do cantinho vao em 'sem_tamanho'.\n    'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho\n";
  assertEquals(volta.split(retornoNovo).length, 2, "o retorno novo aparece 1x");
  volta = volta.replace(
    retornoNovo,
    "    'refund_id', v_refund_id, 'reembolso_manual', v_manual, 'reestocados', v_reestocados\n",
  );
  assertEquals(volta, concl395);
  assertStringIncludes(
    ramo,
    "ELSIF v_di.product_id IS NOT NULL\n            AND EXISTS (SELECT 1 FROM public.product_variants v\n                         WHERE v.product_id = v_di.product_id AND v.active = true) THEN",
  );
  assertStringIncludes(
    ramo,
    "SELECT v_di.product_id, v_d.order_id, v_di.order_item_id, v_di.id, 'devolucao'\n          FROM generate_series(1, v_di.quantidade);",
  );
  assert(!/UPDATE\s+public\./i.test(semComentario(ramo)));
  // o carimbo do item segue DEPOIS do IF (a peca voltou): o cancelamento posterior a desconta (achado C)
  assert(
    conclNovo.indexOf(
      "UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;",
    ) > fim,
  );
});

Deno.test("20261642: ADITIVA - fora dos corpos, so cria (tabela fechada, indice, RPCs) e nada de DROP, DELETE, TRUNCATE nem escrita em dado", () => {
  let fora = migration;
  for (const b of [devNovo, conclNovo, pend, res]) fora = fora.replace(b, "");
  fora = semComentario(fora);
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
    /\bGRANT\b(?!\s+EXECUTE\s+ON\s+FUNCTION\s+public\.(pecas_sem_tamanho_pendentes|resolver_peca_sem_tamanho)\()/i,
  ])
    assert(!proibido.test(fora), `fora dos corpos: ${proibido}`);
  // o unico ALTER TABLE e' ligar o RLS da tabela nova
  assertEquals(
    [...fora.matchAll(/\bALTER\s+TABLE\s+([^;]+);/gi)].map((m) => m[1].trim()),
    ["public.pecas_sem_tamanho ENABLE ROW LEVEL SECURITY"],
  );
  assertEquals(
    [
      ...fora.matchAll(
        /\bCREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([a-z_.]+)/gi,
      ),
    ].map((m) => `${m[1] ? "IF NOT EXISTS " : ""}${m[2]}`),
    ["IF NOT EXISTS public.pecas_sem_tamanho"],
  );
  assertStringIncludes(
    migration,
    "REVOKE ALL ON TABLE public.pecas_sem_tamanho FROM PUBLIC, anon, authenticated, service_role;",
  );
  assert(
    !/GRANT[^;]+ON\s+(TABLE\s+)?public\.pecas_sem_tamanho\b/i.test(migration),
  );
  assert(!/CREATE\s+POLICY/i.test(migration), "RLS sem politica");
  // as quatro funcoes, e so elas
  assertEquals(
    [
      ...semComentario(migration).matchAll(
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi,
      ),
    ].map((m) => m[2]),
    [
      "public.devolver_estoque",
      "public.admin_devolucao_concluir",
      "public.pecas_sem_tamanho_pendentes",
      "public.resolver_peca_sem_tamanho",
    ],
  );
  // o CHECK da coerencia: pendente sem decisao; reposta com tamanho; descartada sem tamanho
  assertStringIncludes(
    migration,
    "CONSTRAINT pecas_sem_tamanho_resolucao_coerente CHECK (",
  );
});

Deno.test("20261642: as RPCs novas tem as portas do painel (admin de agora), EXECUTE so do authenticated e a ordem global das travas", () => {
  for (const [nome, b, assinatura] of [
    ["pendentes", pend, "public.pecas_sem_tamanho_pendentes(uuid)"],
    ["resolver", res, "public.resolver_peca_sem_tamanho(uuid, uuid)"],
  ]) {
    assertStringIncludes(
      b,
      "SECURITY DEFINER\nSET search_path TO 'public'",
      nome,
    );
    const c = corpo(b, nome === "pendentes" ? "$pendentes$" : "$resolver$");
    const iAdmin = c.indexOf("IF NOT public.is_admin() THEN");
    const iAtual = c.indexOf("IF NOT public.is_admin_atual() THEN");
    assert(
      iAdmin > 0 && iAtual > iAdmin,
      `${nome}: as duas portas, nesta ordem`,
    );
    assert(
      c.indexOf("FROM public.pecas_sem_tamanho") > iAtual,
      `${nome}: nada e' lido antes das portas`,
    );
    assertStringIncludes(
      migration,
      `REVOKE ALL ON FUNCTION ${assinatura} FROM PUBLIC, anon, authenticated, service_role;\nGRANT EXECUTE ON FUNCTION ${assinatura} TO authenticated;`,
    );
  }
  assertStringIncludes(pend, "LANGUAGE plpgsql\nSTABLE\nSECURITY DEFINER");
  const c = corpo(res, "$resolver$");
  // variacao -> produto -> peca (a mesma ordem global das outras rotinas de estoque)
  const iVar = c.indexOf(
    "FROM public.product_variants WHERE id = p_variant_id FOR NO KEY UPDATE;",
  );
  const iProd = c.indexOf(
    "PERFORM 1 FROM public.produtos WHERE id = v_produto FOR NO KEY UPDATE;",
  );
  const iPeca = c.indexOf(
    "FROM public.pecas_sem_tamanho WHERE id = p_peca_id FOR UPDATE;",
  );
  assert(iVar > 0 && iProd > iVar && iPeca > iProd, "ordem das travas");
  // a peca ja resolvida volta ANTES de qualquer credito, e o credito e' +1 numa variacao LIGADA do mesmo produto
  const iGuarda = c.indexOf("IF v_peca.resolvida_em IS NOT NULL THEN");
  const iCredito = c.indexOf(
    "SET stock_increment = COALESCE(stock_increment, 0) + 1",
  );
  assert(iGuarda > iPeca && iCredito > iGuarda);
  assert(c.indexOf("IF v_variante.active IS NOT TRUE THEN") < iCredito);
  assertStringIncludes(
    c,
    "IF NOT FOUND OR v_variante.product_id IS DISTINCT FROM v_produto THEN",
  );
  assertEquals(
    c.split("UPDATE public.product_variants").length,
    2,
    "um credito so",
  );
  assert(!/UPDATE\s+public\.produtos/i.test(semComentario(c)), "o pai nunca");
});

Deno.test("20261642: os md5 do pre-voo, do pos-voo, do rollback e das consultas sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261642000000");
  const pos = blocoDo(migration, "posvoo_20261642000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261642000000");
  const rbPos = blocoDo(rollback, "posvoo_rollback_20261642000000");
  assertStringIncludes(pre, `v_hash NOT IN ('${H_DEV_389}', '${H_DEV}')`);
  // a forma (assinatura, anterior, desta) que a 8e do ci_conferir_banco_test exige de cada sucessora
  assertStringIncludes(
    pre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_395}', '${H_CONCL}')`,
  );
  assertStringIncludes(pre, `IS DISTINCT FROM '${H_PEND}'`);
  assertStringIncludes(pre, `IS DISTINCT FROM '${H_RES}'`);
  assertStringIncludes(pre, `IS DISTINCT FROM '${FORMA}'`);
  for (const h of [H_DEV, H_CONCL, H_PEND, H_RES])
    assertStringIncludes(pos, `IS DISTINCT FROM '${h}'`);
  assert(
    !pos.includes(H_DEV_389) && !pos.includes(H_CONCL_395),
    "o pos-voo aceita so os corpos desta",
  );
  assertStringIncludes(pos, `IS DISTINCT FROM '${FORMA}'`);
  assertStringIncludes(rbPre, `v_hash NOT IN ('${H_DEV}', '${H_DEV_389}')`);
  assertStringIncludes(
    rbPre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_395}', '${H_CONCL}')`,
  );
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_DEV_389}'`);
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_CONCL_395}'`);
  assert(!rbPos.includes(H_DEV) && !rbPos.includes(H_CONCL));
  // o pre-voo vem ANTES de qualquer escrita; o pos-voo DEPOIS de tudo
  const iPre = migration.indexOf("DO $preflight_20261642000000$");
  assert(
    iPre >= 0 &&
      iPre <
        migration.indexOf(
          "CREATE TABLE IF NOT EXISTS public.pecas_sem_tamanho",
        ),
  );
  assert(
    migration.indexOf("DO $posvoo_20261642000000$") >
      migration.indexOf(
        "GRANT EXECUTE ON FUNCTION public.resolver_peca_sem_tamanho(uuid, uuid) TO authenticated;",
      ),
  );
  // a ancora da prova viva e das consultas
  const posterior = lerTexto(
    "tests/banco/a-peca-que-volta-sem-tamanho-posterior.cjs",
  );
  assertStringIncludes(posterior, `HASH_DEVOLVER_DESTA = "${H_DEV}"`);
  assertStringIncludes(posterior, `HASH_CONCLUIR_DESTA = "${H_CONCL}"`);
  const a = lerTexto(
    "scripts/publicacao/consultas/201a-conferir-a-peca-que-volta-sem-tamanho-aplicado.sql",
  );
  const b = lerTexto(
    "scripts/publicacao/consultas/201b-antes-a-peca-que-volta-sem-tamanho-base-vigente.sql",
  );
  for (const h of [H_DEV, H_CONCL, H_PEND, H_RES])
    assertStringIncludes(a, `'${h}'`);
  assertStringIncludes(a, FORMA);
  assertStringIncludes(b, `IN ('${H_DEV_389}', '${H_DEV}')`);
  assertStringIncludes(b, `IN ('${H_CONCL_395}', '${H_CONCL}')`);
  assertStringIncludes(b, FORMA);
});

Deno.test("20261642: o rollback devolve os blocos da 389 e da 395 BYTE A BYTE, tira so as RPCs e mantem a tabela", () => {
  assertEquals(
    rollback.split(dev389).length,
    2,
    "o bloco da 389 nao esta letra por letra",
  );
  assertEquals(
    rollback.split(concl395).length,
    2,
    "o bloco da 395 nao esta letra por letra",
  );
  let fora = rollback.replace(dev389, "").replace(concl395, "");
  fora = semComentario(fora);
  assertEquals(
    [...fora.matchAll(/\bDROP\s+([^;]+);/gi)].map((m) => m[1].trim()),
    [
      "FUNCTION IF EXISTS public.resolver_peca_sem_tamanho(uuid, uuid)",
      "FUNCTION IF EXISTS public.pecas_sem_tamanho_pendentes(uuid)",
    ],
  );
  for (const proibido of [
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\s+public\./i,
    /\bINSERT\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
  ])
    assert(!proibido.test(fora), `rollback: ${proibido}`);
  // o COMENTARIO de devolver_estoque nao muda nem na ida nem na volta
  assert(
    !/COMMENT\s+ON\s+FUNCTION\s+public\.devolver_estoque/i.test(
      semComentario(migration),
    ),
  );
  assert(!/COMMENT\s+ON\s+FUNCTION\s+public\.devolver_estoque/i.test(fora));
});

Deno.test("20261642: ligada na release - canais, consultas, conferir-banco, rpc-ci, db-apply e portas do visitante", () => {
  const canais = JSON.parse(lerTexto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261642000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(
    lote[0].consulta,
    "201a-conferir-a-peca-que-volta-sem-tamanho-aplicado",
  );
  assertEquals(
    lote[0].ausenciaConfirmadaPor,
    "201b-antes-a-peca-que-volta-sem-tamanho-base-vigente",
  );
  assertEquals(lote[0].versoes, ["20261642000000"]);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  assertEquals(
    ROL_FECHADO_POR_CONSULTA[
      "201a-conferir-a-peca-que-volta-sem-tamanho-aplicado"
    ].length,
    6,
  );
  assertEquals(
    ROL_FECHADO_POR_CONSULTA[
      "201b-antes-a-peca-que-volta-sem-tamanho-base-vigente"
    ].length,
    4,
  );
  for (const [consulta, rol] of Object.entries(ROL_FECHADO_POR_CONSULTA)) {
    if (!consulta.startsWith("201")) continue;
    const sql = lerTexto(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol)
      assertStringIncludes(sql, `'${item}'`, `${consulta}: ${item}`);
  }
  const rpc = lerTexto(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-que-volta-sem-tamanho-viva.cjs",
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  const corpos = {
    devolver_estoque: corpo(devNovo, "$devolver$"),
    admin_devolucao_concluir: corpo(conclNovo, "$$"),
    resolver_peca_sem_tamanho: corpo(res, "$resolver$"),
  };
  assertEquals(
    entrada.map((c) => c.funcao),
    Object.keys(corpos),
  );
  for (const { funcao, esperado } of entrada)
    for (const { texto, vezes } of esperado)
      assertEquals(
        corpos[funcao].split(texto).length - 1,
        vezes,
        `${funcao}: ${texto}`,
      );
  const portas = JSON.parse(
    lerTexto("tests/banco/portas-do-visitante-permitidas.json"),
  );
  const lista = portas.permitidas ?? portas.funcoes ?? portas;
  const nomes = JSON.stringify(lista);
  assertStringIncludes(
    nomes,
    "public.pecas_sem_tamanho_pendentes(p_produto_id uuid)",
  );
  assertStringIncludes(
    nomes,
    "public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid)",
  );
});

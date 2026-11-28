// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// A PECA DE PRODUTO EXCLUIDO FICA FORA DO ESTOQUE, E O VALE NAO E DINHEIRO NO RANKING — leitura do TEXTO da 20261659000000 e do
// rollback dela. O COMPORTAMENTO (o defeito com os corpos anteriores, a peca do produto excluido fora do estoque e do cantinho, o
// controle com produto nao excluido, o vale igual ao Financeiro, as duas conexoes, os mutantes, reaplicar, pre-voo, rollback e as
// consultas 215a/215b) e' provado no Postgres efemero por tests/banco/a-peca-de-produto-excluido-viva.cjs; aqui ficam as ancoras que
// se leem do arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM escrita em dado;
//   - os quatro corpos novos sao os vigentes (1657, 1657, 642, 3995) com SO as mudancas marcadas, byte a byte;
//   - os md5 do pre-voo, do pos-voo, do rollback, das consultas e do modulo posterior sao os dos corpos que os arquivos carregam;
//   - o rollback devolve os corpos anteriores BYTE A BYTE, passa a Fase 0 e nao apaga nada;
//   - a migration esta ligada na release (canais, consultas, conferir-banco, rpc-ci, db-apply) e as provas das antecessoras a desfazem.
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
const NOME =
  "20261659000000_a_peca_de_produto_excluido_fica_fora_e_o_vale_nao_e_dinheiro.sql";
const NOME_657 =
  "20261657000000_o_produto_todo_desligado_nao_volta_a_venda.sql";
const NOME_642 =
  "20261642000000_a_peca_que_volta_sem_tamanho_espera_a_lojista.sql";
const NOME_3995 =
  "20261399995000_o_lucro_do_ranking_casa_com_o_financeiro_pedido_a_pedido.sql";
const A215 =
  "215a-conferir-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-aplicado";
const B215 =
  "215b-antes-a-peca-de-produto-excluido-fica-fora-e-o-vale-nao-e-dinheiro-base-vigente";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m657 = lerMig(NOME_657);
const m642 = lerMig(NOME_642);
const m3995 = lerMig(NOME_3995);
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
const RES = [
  "CREATE OR REPLACE FUNCTION public.resolver_peca_sem_tamanho(p_peca_id uuid, p_variant_id uuid)",
  "\n$resolver$;",
];
const ANA = [
  "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(p_limit_days integer DEFAULT 90)",
  "\n$$;",
];
const devAnt = bloco(m657, DEV[0], DEV[1]);
const conclAnt = bloco(m657, CONCL[0], CONCL[1]);
const resAnt = bloco(m642, RES[0], RES[1]);
const anaAnt = bloco(m3995, ANA[0], ANA[1]);
const devNovo = bloco(migration, DEV[0], DEV[1]);
const conclNovo = bloco(migration, CONCL[0], CONCL[1]);
const resNovo = bloco(migration, RES[0], RES[1]);
const anaNovo = bloco(migration, ANA[0], ANA[1]);

const H_DEV_657 = "c98a1d49d63e0174f4bdd95dcffc54f4";
const H_CONCL_657 = "b55bf2488a1d5165afddaa4d103d3e18";
const H_RES_642 = "cac3d04d9be77c7d4004003bb70561c5";
const H_ANA_3995 = "4f8fb94f6cb0018e10d0ef71541f1cbf";
const H_DEV = md5(corpo(devNovo, "$devolver$"));
const H_CONCL = md5(corpo(conclNovo, "$$"));
const H_RES = md5(corpo(resNovo, "$resolver$"));
const H_ANA = md5(corpo(anaNovo, "$$"));

const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};
const ramo = (b: string, recuo: string) => {
  const ini = b.indexOf(
    `${recuo}-- >>> a peca de produto excluido (20261659000000)\n`,
  );
  const marcaFim = `${recuo}-- <<< a peca de produto excluido (20261659000000)\n`;
  const fim = b.indexOf(marcaFim) + marcaFim.length;
  assert(ini > 0 && fim > ini, "o bloco marcado nao foi achado");
  assertEquals(b.split(marcaFim).length, 2, "o bloco marcado aparece 1x");
  return { ini, fim, texto: b.slice(ini, fim) };
};
const semEscrita = (texto: string, onde: string) => {
  const sc = semComentario(texto);
  for (const proibido of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i])
    assert(!proibido.test(sc), `${onde}: ${proibido}`);
};
// O filtro do produto excluido: o produto do item OU o pai da variacao do item, com deleted_at preenchido.
const filtroExcluido = (recuo: string, alvo: string) =>
  `${recuo}IF EXISTS (SELECT 1 FROM public.produtos p\n${recuo}            WHERE p.deleted_at IS NOT NULL\n${recuo}              AND (p.id = ${alvo}.product_id\n${recuo}                   OR p.id = (SELECT v.product_id FROM public.product_variants v WHERE v.id = ${alvo}.variant_id))) THEN\n`;

Deno.test("20261659: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, e passa a Fase 0", () => {
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

Deno.test("20261659: os corpos de partida ainda sao os vigentes (1657, 1657, 642, 3995) e esta e' a ultima que redefine os quatro", () => {
  assertEquals(md5(corpo(devAnt, "$devolver$")), H_DEV_657);
  assertEquals(md5(corpo(conclAnt, "$$")), H_CONCL_657);
  assertEquals(md5(corpo(resAnt, "$resolver$")), H_RES_642);
  assertEquals(md5(corpo(anaAnt, "$$")), H_ANA_3995);
  const fontes = (re: RegExp) =>
    [...Deno.readDirSync(`${RAIZ}/supabase/migrations`)]
      .map((e) => e.name)
      .filter((n) => /^\d{14}_.*\.sql$/.test(n))
      .sort()
      .filter((n) => re.test(semComentario(lerMig(n))));
  for (const [re, antecessora] of [
    [
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.devolver_estoque\s*\(/i,
      NOME_657,
    ],
    [
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_devolucao_concluir\s*\(/i,
      NOME_657,
    ],
    [
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.resolver_peca_sem_tamanho\s*\(/i,
      NOME_642,
    ],
    [
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_admin_analytics_v2\s*\(/i,
      NOME_3995,
    ],
  ] as const) {
    const f = fontes(re);
    assertEquals(f.at(-1), NOME, `${re}: outra redefine depois desta`);
    assertEquals(f.at(-2), antecessora, `${re}: a antecessora`);
  }
});

Deno.test("20261659: devolver_estoque novo = o da 1657 com SO o bloco marcado, logo antes do bloco da variacao desligada, byte a byte", () => {
  const { ini, fim, texto } = ramo(devNovo, "        ");
  assertEquals(devNovo.slice(0, ini) + devNovo.slice(fim), devAnt);
  assertEquals(
    devNovo.indexOf(
      "        -- >>> a peca da variacao desligada (20261653000000)\n",
    ),
    fim,
    "o bloco fica antes do da 653 (com o sub-bloco da 1657 dentro; o excluido nunca vira peca sem tamanho)",
  );
  assert(devNovo.indexOf("IF v_credito = 0 THEN") < ini);
  assertStringIncludes(
    texto,
    `${filtroExcluido("        ", "v_item")}            CONTINUE;\n        END IF;\n`,
  );
  semEscrita(texto, "bloco do devolver_estoque");
});

Deno.test("20261659: admin_devolucao_concluir novo = o da 1657 com SO o bloco, a variavel e o retorno com fora_do_estoque, byte a byte", () => {
  const { ini, fim, texto } = ramo(conclNovo, "      ");
  const ancora = "    IF v_reestocar AND v_di.reestocado_em IS NULL THEN\n";
  assertEquals(conclNovo.indexOf(ancora) + ancora.length, ini);
  assertEquals(
    conclNovo.indexOf(
      "      -- >>> a peca da variacao desligada (20261653000000)\n",
    ),
    fim,
  );
  assertStringIncludes(
    texto,
    `${filtroExcluido("      ", "v_di")}        v_fora_do_estoque := v_fora_do_estoque + v_di.quantidade;\n        v_di.product_id := NULL;\n        v_di.variant_id := NULL;\n      END IF;\n`,
  );
  semEscrita(texto, "bloco da conclusao");
  const DECL =
    "  -- 20261659000000: unidades de produto EXCLUIDO (voltaram para a loja, mas nao para o estoque nem para o cantinho).\n  v_fora_do_estoque integer := 0;\n";
  const RET_NOVO =
    "    -- 20261659000000: as de produto excluido vao em 'fora_do_estoque' (voltaram para a loja, nao para a venda).\n    'reestocados', v_reestocados - v_sem_tamanho - v_fora_do_estoque, 'sem_tamanho', v_sem_tamanho,\n    'fora_do_estoque', v_fora_do_estoque\n";
  const RET_ANT =
    "    'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho\n";
  for (const t of [DECL, RET_NOVO])
    assertEquals(conclNovo.split(t).length, 2, `uma vez: ${t.slice(0, 60)}`);
  // A variavel nasce no DECLARE (antes do BEGIN do corpo).
  assert(
    conclNovo.indexOf(DECL) <
      corpo(conclNovo, "$$").indexOf("\nBEGIN\n") + conclNovo.indexOf("AS $$"),
  );
  const desfeito = (conclNovo.slice(0, ini) + conclNovo.slice(fim))
    .replace(DECL, "")
    .replace(RET_NOVO, RET_ANT);
  assertEquals(desfeito, conclAnt);
  // O carimbo do item e a conta seguem DEPOIS do bloco, iguais aos da 1657: a peca do excluido e' carimbada e soma em v_reestocados
  // (por isso o retorno a desconta).
  assert(
    conclNovo.indexOf(
      "UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;",
    ) > fim,
  );
});

Deno.test("20261659: resolver_peca_sem_tamanho novo = o da 642 com SO a recusa do produto excluido, dentro do ramo do tamanho, byte a byte", () => {
  const { ini, fim, texto } = ramo(resNovo, "    ");
  assertEquals(resNovo.slice(0, ini) + resNovo.slice(fim), resAnt);
  assert(
    resNovo.lastIndexOf("  IF p_variant_id IS NOT NULL THEN\n", ini) > 0,
    "a recusa vale so para POR num tamanho; 'nao tenho a peca' (NULL) segue aceito",
  );
  assertStringIncludes(
    texto,
    "    IF EXISTS (SELECT 1 FROM public.produtos p WHERE p.id = v_produto AND p.deleted_at IS NOT NULL) THEN\n      RAISE EXCEPTION 'Esse produto foi excluído, então a peça não volta ao estoque. Marque que você não tem a peça.' USING ERRCODE = '22023';\n    END IF;\n",
  );
  semEscrita(texto, "bloco do resolver");
});

Deno.test("20261659: get_admin_analytics_v2 novo = o da 3995 com SO o vale = 0 nas DUAS copias (ranking e grafico), byte a byte", () => {
  const CASE_ANT =
    "              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n";
  const CASE_NOVO =
    "              CROSS JOIN LATERAL (SELECT CASE WHEN dv.resolucao_final = 'vale' THEN 0\n                                              WHEN dv.resolucao_final = 'reembolso' AND dv.valor_reembolso IS NOT NULL\n";
  const COM_ANT =
    "            -- vale = o das pecas que voltaram (credito, nao e dinheiro de verdade; a venda da peca sai do lucro como sempre saiu).\n";
  const COM_NOVO =
    "            -- vale = 0 (20261659000000): o vale-troca e' credito na loja, nao dinheiro que saiu; como no Financeiro, a venda da peca fica no lucro\n            -- e as pecas do vale seguem na quantidade devolvida e no custo que volta (reestocadas). Antes era o valor das pecas que voltaram.\n";
  assertEquals(anaAnt.split(CASE_ANT).length, 3, "a 3995 tem duas copias");
  assertEquals(anaAnt.split(COM_ANT).length, 3);
  assertEquals(anaNovo.split(CASE_NOVO).length, 3, "as duas copias mudam");
  assertEquals(anaNovo.split(COM_NOVO).length, 3);
  assertEquals(anaNovo.split(CASE_ANT).length, 1, "nenhuma copia ficou velha");
  assertEquals(
    anaNovo.split(CASE_NOVO).join(CASE_ANT).split(COM_NOVO).join(COM_ANT),
    anaAnt,
  );
});

Deno.test("20261659: ADITIVA - fora dos quatro corpos, nada de DDL, escrita em dado, GRANT, REVOKE ou funcao nova", () => {
  const fora = semComentario(
    migration
      .replace(devNovo, "")
      .replace(conclNovo, "")
      .replace(resNovo, "")
      .replace(anaNovo, ""),
  );
  for (const proibido of [
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bTRUNCATE\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bCOMMENT\s+ON\b/i,
  ])
    assert(!proibido.test(fora), `fora dos corpos: ${proibido}`);
  assertEquals(
    [
      ...semComentario(migration).matchAll(
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_0-9.]+)/gi,
      ),
    ].map((m) => m[2]),
    [
      "public.devolver_estoque",
      "public.admin_devolucao_concluir",
      "public.resolver_peca_sem_tamanho",
      "public.get_admin_analytics_v2",
    ],
  );
});

Deno.test("20261659: os md5 do pre-voo, do pos-voo, do rollback, das consultas e do posterior sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261659000000");
  const pos = blocoDo(migration, "posvoo_20261659000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261659000000");
  const rbPos = blocoDo(rollback, "posvoo_rollback_20261659000000");
  const linhas = [
    ["public.devolver_estoque(uuid)", H_DEV_657, H_DEV],
    [
      "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)",
      H_CONCL_657,
      H_CONCL,
    ],
    ["public.resolver_peca_sem_tamanho(uuid,uuid)", H_RES_642, H_RES],
    ["public.get_admin_analytics_v2(integer)", H_ANA_3995, H_ANA],
  ];
  for (const [assin, ant, desta] of linhas) {
    // a forma (assinatura, anterior, desta) que a 8e do ci_conferir_banco_test exige de cada sucessora
    assertStringIncludes(pre, `('${assin}', '${ant}', '${desta}')`);
    assertStringIncludes(rbPre, `('${assin}', '${ant}', '${desta}')`);
    assertStringIncludes(pos, `('${assin}', '${desta}', `);
    assertStringIncludes(rbPos, `('${assin}', '${ant}', `);
    assert(!pos.includes(ant), `o pos-voo aceita so o corpo desta: ${assin}`);
    assert(!rbPos.includes(desta), `o rollback so aceita o anterior: ${assin}`);
  }
  // as colunas que os blocos leem
  assertStringIncludes(
    pre,
    "(a.attrelid = to_regclass('public.produtos') AND a.attname IN ('id', 'deleted_at'))",
  );
  assertStringIncludes(
    pre,
    "(a.attrelid = to_regclass('public.product_variants') AND a.attname IN ('id', 'product_id'))",
  );
  // o pre-voo vem ANTES de qualquer escrita; o pos-voo DEPOIS de tudo
  assert(
    migration.indexOf("DO $preflight_20261659000000$") <
      migration.indexOf(DEV[0]),
  );
  assert(
    migration.indexOf("DO $posvoo_20261659000000$") > migration.indexOf(ANA[0]),
  );
  // a ancora da prova viva e das consultas
  const posterior = lerTexto(
    "tests/banco/a-peca-de-produto-excluido-posterior.cjs",
  );
  for (const [nome, h] of [
    ["HASH_DEVOLVER_DESTA", H_DEV],
    ["HASH_CONCLUIR_DESTA", H_CONCL],
    ["HASH_RESOLVER_DESTA", H_RES],
    ["HASH_ANALYTICS_DESTA", H_ANA],
    ["HASH_DEVOLVER_657", H_DEV_657],
    ["HASH_CONCLUIR_657", H_CONCL_657],
    ["HASH_RESOLVER_642", H_RES_642],
    ["HASH_ANALYTICS_3995", H_ANA_3995],
  ])
    assertStringIncludes(posterior, `${nome} = "${h}"`);
  const a = semComentario(lerTexto(`scripts/publicacao/consultas/${A215}.sql`));
  const b = semComentario(lerTexto(`scripts/publicacao/consultas/${B215}.sql`));
  for (const [, ant, desta] of linhas) {
    assertStringIncludes(a, `'${desta}'`);
    assert(!a.includes(ant), `a 215a nao aceita o corpo anterior ${ant}`);
    assertStringIncludes(b, `'${ant}'`);
    assertStringIncludes(b, `'${desta}'`);
  }
  // as fichas das antecessoras aceitam o corpo desta como SUCESSORA (senao reprovam em toda loja depois do apply)
  for (const [ficha, h] of [
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_DEV],
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_CONCL],
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_RES],
    [
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
      H_DEV,
    ],
    [
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
      H_CONCL,
    ],
    [
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
      H_RES,
    ],
    ["96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado", H_DEV],
    [
      "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
      H_CONCL,
    ],
    ["43a-conferir-reembolso-em-duvida-aplicado", H_CONCL],
    ["67a-conferir-reembolso-manual-reserva-aplicado", H_CONCL],
    ["8e-conferir-92-a-202-aplicado", H_CONCL],
    [
      "213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado",
      H_DEV,
    ],
    [
      "213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado",
      H_CONCL,
    ],
    ["8e-conferir-92-a-202-aplicado", H_ANA],
    ["35a-conferir-lucro-so-com-custo-aplicado", H_ANA],
    ["45a-conferir-custo-do-dia-aplicado", H_ANA],
    ["48a-conferir-lucro-com-desconto-aplicado", H_ANA],
    ["53a-conferir-faturamento-potencial-aplicado", H_ANA],
    ["54a-conferir-lucro-do-estoque-aplicado", H_ANA],
    ["135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado", H_ANA],
    [
      "146a-conferir-o-item-que-nao-veio-fica-com-a-cliente-no-ranking-de-lucro-aplicado",
      H_ANA,
    ],
    [
      "147a-conferir-o-lucro-do-ranking-casa-com-o-financeiro-pedido-a-pedido-aplicado",
      H_ANA,
    ],
  ])
    assertStringIncludes(
      semComentario(lerTexto(`scripts/publicacao/consultas/${ficha}.sql`)),
      `'${h}'`,
      ficha,
    );
  // A 17a (o estoque do painel) confere o analytics por sha256 (LF e CRLF) e aceita o corpo desta logo depois do da 3995.
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const anaC = corpo(anaNovo, "$$");
  const ana3995C = corpo(anaAnt, "$$");
  assertStringIncludes(
    lerTexto(
      "scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql",
    ),
    `'${sha(ana3995C.replace(/\n/g, "\r\n"))}',\n                                            '${sha(anaC)}',\n                                            '${sha(anaC.replace(/\n/g, "\r\n"))}')`,
  );
});

Deno.test("20261659: o rollback devolve os quatro corpos anteriores BYTE A BYTE e nao apaga nem escreve nada", () => {
  for (const [rotulo, b] of [
    ["devolver_estoque da 1657", devAnt],
    ["admin_devolucao_concluir da 1657", conclAnt],
    ["resolver_peca_sem_tamanho da 642", resAnt],
    ["get_admin_analytics_v2 da 3995", anaAnt],
  ])
    assertEquals(
      rollback.split(b).length,
      2,
      `${rotulo}: nao esta letra por letra`,
    );
  const fora = semComentario(
    rollback
      .replace(devAnt, "")
      .replace(conclAnt, "")
      .replace(resAnt, "")
      .replace(anaAnt, ""),
  );
  for (const proibido of [
    /\bDROP\b/i,
    /\bDELETE\b/i,
    /\bTRUNCATE\b/i,
    /\bUPDATE\s+public\./i,
    /\bINSERT\b/i,
    /\bGRANT\b/i,
    /\bREVOKE\b/i,
    /\bALTER\b/i,
    /\bCREATE\b/i,
  ])
    assert(!proibido.test(fora), `rollback: ${proibido}`);
});

Deno.test("20261659: ligada na release - canais, consultas, conferir-banco, rpc-ci, db-apply e as provas das antecessoras a desfazem antes", () => {
  const canais = JSON.parse(lerTexto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261659000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, A215);
  assertEquals(lote[0].ausenciaConfirmadaPor, B215);
  assertEquals(lote[0].versoes, ["20261659000000"]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert(!(chave in lote[0]), `lote da 215a: ${chave} nao se aplica`);
  const ordem = canais.provasDeObjetos.map((p) => p.consulta);
  assert(
    ordem.indexOf(
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
    ) < ordem.indexOf(A215),
    "o lote da 215a vem depois do da 209a",
  );
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const consulta of [A215, B215]) {
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert(rol, `sem rol: ${consulta}`);
    const sql = lerTexto(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol)
      assertStringIncludes(sql, `'${item}'`, `${consulta}: ${item}`);
  }
  const rpc = lerTexto(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/a-peca-de-produto-excluido-viva.cjs",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  const corpos = {
    devolver_estoque: corpo(devNovo, "$devolver$"),
    admin_devolucao_concluir: corpo(conclNovo, "$$"),
    resolver_peca_sem_tamanho: corpo(resNovo, "$resolver$"),
    get_admin_analytics_v2: corpo(anaNovo, "$$"),
  };
  const anteriores = {
    devolver_estoque: corpo(devAnt, "$devolver$"),
    admin_devolucao_concluir: corpo(conclAnt, "$$"),
    resolver_peca_sem_tamanho: corpo(resAnt, "$resolver$"),
    get_admin_analytics_v2: corpo(anaAnt, "$$"),
  };
  assertEquals(
    entrada.map((c) => c.funcao),
    Object.keys(corpos),
  );
  for (const checagem of entrada) {
    const { funcao, esperado } = checagem;
    assertEquals(
      avaliarChecagem(corpos[funcao], checagem).situacao,
      "verificada",
      funcao,
    );
    assertEquals(
      avaliarChecagem(anteriores[funcao], checagem).situacao,
      "falhou",
      `${funcao}: o corpo anterior passaria`,
    );
    for (const { texto } of esperado)
      assertEquals(
        avaliarChecagem(corpos[funcao].replace(texto, "XX"), checagem).situacao,
        "falhou",
        `${funcao}: o marcador "${texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  // As provas que medem a 1657 (e a 653), a 642 ou a 3995 desfazem esta antes (os rollbacks delas recusam o corpo desta).
  const chamada = 'require("./a-peca-de-produto-excluido-posterior.cjs")';
  for (const arq of [
    "tests/banco/o-produto-todo-desligado-posterior.cjs",
    "tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-posterior.cjs",
    "tests/banco/o-produto-todo-desligado-nao-volta-a-venda-viva.cjs",
    "tests/banco/o-lucro-do-ranking-casa-com-o-financeiro-viva.cjs",
  ])
    assertStringIncludes(lerTexto(arq), chamada, arq);
  // A cadeia das 42 da 20261199 (o analytics e' uma delas) conhece esta: as quatro funcoes do pre-voo, cada uma (vigente, desta).
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  assertEquals(
    SUCESSORAS_DA_99.filter((s) => s.nome === NOME).map((s) => [
      s.assinatura,
      s.hashVigente,
      s.hashDesta,
    ]),
    [
      ["public.devolver_estoque(uuid)", H_DEV_657, H_DEV],
      [
        "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)",
        H_CONCL_657,
        H_CONCL,
      ],
      ["public.resolver_peca_sem_tamanho(uuid,uuid)", H_RES_642, H_RES],
      ["public.get_admin_analytics_v2(integer)", H_ANA_3995, H_ANA],
    ],
    "sucessoras-da-99: falta esta, ou os pares nao sao os do pre-voo",
  );
});

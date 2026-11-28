// @ts-nocheck
/* eslint-disable security/detect-object-injection -- o indice e' o nome fixo desta migration, nunca entrada de rede. */
/* eslint-disable security/detect-unsafe-regex -- as regexes leem o texto fixo e versionado de uma migration (sem entrada de fora), entao nao ha ReDoS possivel; mesma razao dos outros testes migration_*. */
// O PRODUTO TODO DESLIGADO NAO VOLTA A VENDA — leitura do TEXTO da 20261657000000 e do rollback dela.
// O COMPORTAMENTO (o defeito com os corpos da 20261653000000, a peca na propria variacao desligada quando nenhuma esta ligada, o pai que
// so recebe o produto sem variacao, o cantinho da 1653 igual, os mutantes, reaplicar, pre-voo, rollback e as consultas 213a/213b) e'
// provado no Postgres efemero por tests/banco/o-produto-todo-desligado-nao-volta-a-venda-viva.cjs; aqui ficam as ancoras que se leem do
// arquivo, sem banco:
//   - a migration e' ADITIVA, SEM transacao propria e SEM escrita em dado;
//   - os dois corpos novos sao os vigentes (os da 20261653000000) com SO o sub-bloco marcado no lugar da troca para "sem variacao";
//   - os md5 do pre-voo, do pos-voo, do rollback, das consultas e do modulo posterior sao os dos corpos que os arquivos carregam;
//   - o rollback devolve os blocos da 20261653000000 BYTE A BYTE, passa a Fase 0 e nao apaga nada;
//   - a migration esta ligada na release (canais, consultas, conferir-banco, rpc-ci, db-apply) e as provas da 1653 a desfazem antes.
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
const NOME = "20261657000000_o_produto_todo_desligado_nao_volta_a_venda.sql";
const NOME_1653 =
  "20261653000000_a_peca_da_variacao_desligada_espera_a_lojista.sql";
const A213 =
  "213a-conferir-o-produto-todo-desligado-nao-volta-a-venda-aplicado";
const B213 =
  "213b-antes-o-produto-todo-desligado-nao-volta-a-venda-base-vigente";
const lerMig = (arq: string) =>
  Deno.readTextFileSync(`${RAIZ}/supabase/migrations/${arq}`).replace(
    /\r/g,
    "",
  );
const lerTexto = (rel: string) =>
  Deno.readTextFileSync(`${RAIZ}/${rel}`).replace(/\r/g, "");
const migration = lerMig(NOME);
const rollback = lerMig(`rollback-manual-${NOME}`);
const m1653 = lerMig(NOME_1653);
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
const dev1653 = bloco(m1653, DEV[0], DEV[1]);
const concl1653 = bloco(m1653, CONCL[0], CONCL[1]);
const devNovo = bloco(migration, DEV[0], DEV[1]);
const conclNovo = bloco(migration, CONCL[0], CONCL[1]);

const H_DEV_1653 = "2913f3178498938d0a79e3b47a1084d1";
const H_CONCL_1653 = "d146dc7aefb07a0bf580ed7265d9453e";
const H_DEV = md5(corpo(devNovo, "$devolver$"));
const H_CONCL = md5(corpo(conclNovo, "$$"));
const blocoDo = (sql: string, marca: string) => {
  const i = sql.indexOf(`DO $${marca}$`);
  assert(i >= 0, `bloco ${marca} ausente`);
  return sql.slice(i, sql.indexOf(`END $${marca}$;`, i));
};
/** O sub-bloco marcado desta migration, com o recuo dado; aparece 1x. */
const subBloco = (b: string, recuo: string) => {
  const marcaIni = `${recuo}-- >>> o produto todo desligado (20261657000000)\n`;
  const marcaFim = `${recuo}-- <<< o produto todo desligado (20261657000000)\n`;
  const ini = b.indexOf(marcaIni);
  const fim = b.indexOf(marcaFim) + marcaFim.length;
  assert(ini > 0 && fim > ini, "o sub-bloco marcado nao foi achado");
  assertEquals(b.split(marcaIni).length, 2, "o sub-bloco aparece 1x");
  assertEquals(b.split(marcaFim).length, 2, "o sub-bloco fecha 1x");
  return { ini, fim, texto: b.slice(ini, fim) };
};

Deno.test("20261657: sem transacao propria, texto LF, lock_timeout de 5 s e statement_timeout de 30 s, e passa a Fase 0", () => {
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

Deno.test("20261657: os corpos de partida ainda sao os vigentes (os da 20261653000000) e esta e' a ultima que redefine os dois", () => {
  assertEquals(md5(corpo(dev1653, "$devolver$")), H_DEV_1653);
  assertEquals(md5(corpo(concl1653, "$$")), H_CONCL_1653);
  const fontes = (re: RegExp) =>
    [...Deno.readDirSync(`${RAIZ}/supabase/migrations`)]
      .map((e) => e.name)
      .filter((n) => /^\d{14}_.*\.sql$/.test(n))
      .sort()
      .filter((n) => re.test(semComentario(lerMig(n))));
  for (const re of [
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.devolver_estoque\s*\(/i,
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.admin_devolucao_concluir\s*\(/i,
  ]) {
    const f = fontes(re);
    assertEquals(f.at(-1), NOME, `${re}: outra redefine depois desta`);
    assertEquals(f.at(-2), NOME_1653, `${re}: a antecessora e' a 1653`);
  }
});

Deno.test("20261657: devolver_estoque novo = o da 20261653000000 com SO o sub-bloco no lugar da troca para sem variacao, byte a byte", () => {
  const { ini, fim, texto } = subBloco(devNovo, "            ");
  // Tirando o sub-bloco e pondo de volta a linha que ele envolve, sai o corpo da 1653 letra por letra.
  const linha = "            v_item.variant_id := NULL;\n";
  assertEquals(
    `${devNovo.slice(0, ini)}${linha}${devNovo.slice(fim)}`,
    dev1653,
  );
  // Fica DENTRO do bloco da 1653 (depois do produto herdado do pai da variacao) e antes do IF/ELSIF/ELSE do credito.
  const herda =
    "            v_item.product_id := COALESCE(v_item.product_id,\n                                          (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_item.variant_id));\n";
  assertEquals(devNovo.indexOf(herda) + herda.length, ini);
  assertEquals(
    devNovo.indexOf(
      "        END IF;\n        -- <<< a peca da variacao desligada (20261653000000)\n",
    ),
    fim,
  );
  // A troca so acontece com variacao LIGADA no produto do item: o MESMO predicado do ELSIF da 642 logo abaixo.
  assertStringIncludes(
    texto,
    "            IF EXISTS (SELECT 1 FROM public.product_variants v\n                        WHERE v.product_id = v_item.product_id AND v.active = true) THEN\n                v_item.variant_id := NULL;\n            END IF;\n",
  );
  assertStringIncludes(
    devNovo,
    "        ELSIF EXISTS (SELECT 1 FROM public.product_variants v\n                       WHERE v.product_id = v_item.product_id AND v.active = true) THEN",
  );
  // o sub-bloco NAO escreve em lugar nenhum e nao cria destino novo
  const sc = semComentario(texto);
  for (const proibido of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i])
    assert(!proibido.test(sc), `sub-bloco: ${proibido}`);
  assertEquals(
    devNovo.split("INSERT INTO public.pecas_sem_tamanho").length - 1,
    1,
  );
  assertEquals(devNovo.split("UPDATE public.product_variants").length - 1, 1);
  assertEquals(devNovo.split("UPDATE public.produtos").length - 1, 1);
});

Deno.test("20261657: admin_devolucao_concluir novo = o da 20261653000000 com SO o sub-bloco no lugar da troca para sem variacao, byte a byte", () => {
  const { ini, fim, texto } = subBloco(conclNovo, "        ");
  const linha = "        v_di.variant_id := NULL;\n";
  assertEquals(
    `${conclNovo.slice(0, ini)}${linha}${conclNovo.slice(fim)}`,
    concl1653,
  );
  const herda =
    "        v_di.product_id := COALESCE(v_di.product_id,\n                                    (SELECT v.product_id FROM public.product_variants v WHERE v.id = v_di.variant_id));\n";
  assertEquals(conclNovo.indexOf(herda) + herda.length, ini);
  assertEquals(
    conclNovo.indexOf(
      "      END IF;\n      -- <<< a peca da variacao desligada (20261653000000)\n",
    ),
    fim,
  );
  assertStringIncludes(
    texto,
    "        IF EXISTS (SELECT 1 FROM public.product_variants v\n                    WHERE v.product_id = v_di.product_id AND v.active = true) THEN\n          v_di.variant_id := NULL;\n        END IF;\n",
  );
  assertStringIncludes(
    conclNovo,
    "      ELSIF v_di.product_id IS NOT NULL\n            AND EXISTS (SELECT 1 FROM public.product_variants v\n                         WHERE v.product_id = v_di.product_id AND v.active = true) THEN",
  );
  const sc = semComentario(texto);
  for (const proibido of [/\bUPDATE\b/i, /\bINSERT\b/i, /\bDELETE\b/i])
    assert(!proibido.test(sc), `sub-bloco: ${proibido}`);
  // o carimbo do item e as contas seguem DEPOIS, iguais aos da 1653
  assert(
    conclNovo.indexOf(
      "UPDATE public.devolucao_itens SET reestocado_em = now() WHERE id = v_di.id;",
    ) > fim,
  );
  assertStringIncludes(
    conclNovo,
    "'reestocados', v_reestocados - v_sem_tamanho, 'sem_tamanho', v_sem_tamanho",
  );
});

Deno.test("20261657: ADITIVA - fora dos dois corpos, nada de DDL, escrita em dado, GRANT, REVOKE nem funcao nova", () => {
  const fora = semComentario(
    migration.replace(devNovo, "").replace(conclNovo, ""),
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
        /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([a-z_.]+)/gi,
      ),
    ].map((m) => m[2]),
    ["public.devolver_estoque", "public.admin_devolucao_concluir"],
  );
});

Deno.test("20261657: os md5 do pre-voo, do pos-voo, do rollback, das consultas e do posterior sao os dos corpos que os arquivos carregam", () => {
  const pre = blocoDo(migration, "preflight_20261657000000");
  const pos = blocoDo(migration, "posvoo_20261657000000");
  const rbPre = blocoDo(rollback, "preflight_rollback_20261657000000");
  const rbPos = blocoDo(rollback, "posvoo_rollback_20261657000000");
  assertStringIncludes(pre, `v_hash NOT IN ('${H_DEV_1653}', '${H_DEV}')`);
  // a forma (assinatura, anterior, desta) que a 8e do ci_conferir_banco_test exige de cada sucessora
  assertStringIncludes(
    pre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_1653}', '${H_CONCL}')`,
  );
  for (const h of [H_DEV, H_CONCL])
    assertStringIncludes(pos, `IS DISTINCT FROM '${h}'`);
  assert(
    !pos.includes(H_DEV_1653) && !pos.includes(H_CONCL_1653),
    "o pos-voo aceita so os corpos desta",
  );
  assertStringIncludes(rbPre, `v_hash NOT IN ('${H_DEV}', '${H_DEV_1653}')`);
  assertStringIncludes(
    rbPre,
    `('public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)', '${H_CONCL_1653}', '${H_CONCL}')`,
  );
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_DEV_1653}'`);
  assertStringIncludes(rbPos, `IS DISTINCT FROM '${H_CONCL_1653}'`);
  assert(!rbPos.includes(H_DEV) && !rbPos.includes(H_CONCL));
  // o pre-voo vem ANTES de qualquer escrita; o pos-voo DEPOIS de tudo
  assert(
    migration.indexOf("DO $preflight_20261657000000$") <
      migration.indexOf(DEV[0]),
  );
  assert(
    migration.indexOf("DO $posvoo_20261657000000$") >
      migration.indexOf(CONCL[0]),
  );
  // a ancora da prova viva e das consultas
  const posterior = lerTexto(
    "tests/banco/o-produto-todo-desligado-posterior.cjs",
  );
  assertStringIncludes(posterior, `HASH_DEVOLVER_DESTA = "${H_DEV}"`);
  assertStringIncludes(posterior, `HASH_CONCLUIR_DESTA = "${H_CONCL}"`);
  assertStringIncludes(posterior, `HASH_DEVOLVER_1653 = "${H_DEV_1653}"`);
  assertStringIncludes(posterior, `HASH_CONCLUIR_1653 = "${H_CONCL_1653}"`);
  const a = lerTexto(`scripts/publicacao/consultas/${A213}.sql`);
  const b = lerTexto(`scripts/publicacao/consultas/${B213}.sql`);
  for (const h of [H_DEV, H_CONCL]) assertStringIncludes(a, `'${h}'`);
  assert(
    !semComentario(a).includes(H_DEV_1653) &&
      !semComentario(a).includes(H_CONCL_1653),
    "a 213a nao aceita a 1653",
  );
  assertStringIncludes(b, `IN ('${H_DEV_1653}', '${H_DEV}')`);
  assertStringIncludes(b, `IN ('${H_CONCL_1653}', '${H_CONCL}')`);
  // as fichas das antecessoras aceitam o corpo desta como SUCESSORA (senao reprovam em toda loja depois do apply)
  for (const [ficha, h] of [
    [
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
      H_DEV,
    ],
    [
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
      H_CONCL,
    ],
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_DEV],
    ["202a-conferir-a-peca-que-volta-sem-tamanho-aplicado", H_CONCL],
    ["96a-conferir-o-estoque-que-volta-tranca-na-mesma-ordem-aplicado", H_DEV],
    [
      "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado",
      H_CONCL,
    ],
    ["43a-conferir-reembolso-em-duvida-aplicado", H_CONCL],
    ["67a-conferir-reembolso-manual-reserva-aplicado", H_CONCL],
    ["8e-conferir-92-a-202-aplicado", H_CONCL],
  ])
    assertStringIncludes(
      semComentario(lerTexto(`scripts/publicacao/consultas/${ficha}.sql`)),
      `'${h}'`,
      ficha,
    );
});

Deno.test("20261657: o rollback devolve os blocos da 20261653000000 BYTE A BYTE e nao apaga nem tira nada", () => {
  assertEquals(
    rollback.split(dev1653).length,
    2,
    "o bloco de devolver_estoque da 1653 nao esta letra por letra",
  );
  assertEquals(
    rollback.split(concl1653).length,
    2,
    "o bloco de admin_devolucao_concluir da 1653 nao esta letra por letra",
  );
  const fora = semComentario(
    rollback.replace(dev1653, "").replace(concl1653, ""),
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

Deno.test("20261657: ligada na release - canais, consultas, conferir-banco, rpc-ci, db-apply e as provas da 1653 a desfazem antes", () => {
  const canais = JSON.parse(lerTexto("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((l) =>
    (l.versoes ?? []).includes("20261657000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, A213);
  assertEquals(lote[0].ausenciaConfirmadaPor, B213);
  assertEquals(lote[0].versoes, ["20261657000000"]);
  for (const chave of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert(!(chave in lote[0]), `lote da 213a: ${chave} nao se aplica`);
  const ordem = canais.provasDeObjetos.map((p) => p.consulta);
  assert(
    ordem.indexOf(
      "209a-conferir-a-peca-da-variacao-desligada-espera-a-lojista-aplicado",
    ) < ordem.indexOf(A213),
    "o lote da 213a vem depois do da 209a",
  );
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const consulta of [A213, B213]) {
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert(rol, `sem rol: ${consulta}`);
    const sql = lerTexto(`scripts/publicacao/consultas/${consulta}.sql`);
    for (const item of rol)
      assertStringIncludes(sql, `'${item}'`, `${consulta}: ${item}`);
  }
  const rpc = lerTexto(".github/workflows/rpc-ci.yml");
  assertStringIncludes(
    rpc,
    "run: node tests/banco/rodar-isolado.cjs tests/banco/o-produto-todo-desligado-nao-volta-a-venda-viva.cjs",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[NOME];
  assert(entrada, "sem entrada no db-apply: a migration sairia PULADA");
  const corpos = {
    devolver_estoque: corpo(devNovo, "$devolver$"),
    admin_devolucao_concluir: corpo(conclNovo, "$$"),
  };
  const corpos1653 = {
    devolver_estoque: corpo(dev1653, "$devolver$"),
    admin_devolucao_concluir: corpo(concl1653, "$$"),
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
    // Sem o sub-bloco desta (o corpo da 1653) a verificacao reprova; e cada marcador, se some, tambem.
    assertEquals(
      avaliarChecagem(corpos1653[funcao], checagem).situacao,
      "falhou",
      `${funcao}: o corpo da 1653 passaria`,
    );
    for (const { texto } of esperado)
      assertEquals(
        avaliarChecagem(corpos[funcao].replace(texto, "XX"), checagem).situacao,
        "falhou",
        `${funcao}: o marcador "${texto.slice(0, 40)}" nao pega a regressao`,
      );
  }
  // As provas que medem a 20261653000000 desfazem esta antes (o pre-voo do rollback da 1653 recusa o corpo desta).
  assertStringIncludes(
    lerTexto("tests/banco/a-peca-da-variacao-desligada-posterior.cjs"),
    'require("./o-produto-todo-desligado-posterior.cjs").desfazerProdutoTodoDesligadoNaTransacao(',
  );
  assertStringIncludes(
    lerTexto("tests/banco/a-peca-da-variacao-desligada-viva.cjs"),
    'require("./o-produto-todo-desligado-posterior.cjs").desfazerProdutoTodoDesligadoNaTransacao(',
  );
});
